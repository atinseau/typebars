import type { JSONSchema7 } from "json-schema";
import type { AnalysisResult, TemplateDiagnostic } from "./types.ts";

// ─── Utilities ───────────────────────────────────────────────────────────────
// Shared utility functions and classes used across the different modules
// of the template engine.

// ─── Deep Equality ───────────────────────────────────────────────────────────
// Deep structural comparison for JSON-compatible values.
// More robust than `JSON.stringify` because it is independent of key order
// and does not allocate intermediate strings.

/**
 * Recursively compares two JSON-compatible values.
 *
 * @param a - First value
 * @param b - Second value
 * @returns `true` if the two values are structurally identical
 *
 * @example
 * ```
 * deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }) // → true
 * deepEqual([1, 2], [1, 2])                   // → true
 * deepEqual({ a: 1 }, { a: 2 })               // → false
 * ```
 */
export function deepEqual(a: unknown, b: unknown): boolean {
	// Strict identity (covers primitives, same ref; NaN !== NaN is intentional)
	if (a === b) return true;

	// null is typeof "object" in JS — handle it separately
	if (a === null || b === null) return false;
	if (typeof a !== typeof b) return false;

	// ── Arrays ───────────────────────────────────────────────────────────────
	if (Array.isArray(a)) {
		if (!Array.isArray(b)) return false;
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!deepEqual(a[i], b[i])) return false;
		}
		return true;
	}

	// ── Objects ──────────────────────────────────────────────────────────────
	if (typeof a === "object") {
		const objA = a as Record<string, unknown>;
		const objB = b as Record<string, unknown>;
		const keysA = Object.keys(objA);
		const keysB = Object.keys(objB);

		if (keysA.length !== keysB.length) return false;

		for (const key of keysA) {
			if (!(key in objB) || !deepEqual(objA[key], objB[key])) return false;
		}
		return true;
	}

	// Different primitives (already covered by a === b at the top)
	return false;
}

// ─── LRU Cache ───────────────────────────────────────────────────────────────
// Fixed-capacity cache with Least Recently Used (LRU) eviction.
// Leverages `Map` insertion order to track access: the oldest entry
// is always in the first position.

/**
 * Simple fixed-capacity LRU cache.
 *
 * @example
 * ```
 * const cache = new LRUCache<string, number>(2);
 * cache.set("a", 1);
 * cache.set("b", 2);
 * cache.get("a");      // → 1 (marks "a" as recently used)
 * cache.set("c", 3);   // evicts "b" (least recently used)
 * cache.get("b");      // → undefined
 * ```
 */
export class LRUCache<K, V> {
	private readonly cache = new Map<K, V>();

	constructor(private readonly capacity: number) {
		if (capacity < 1) {
			throw new Error("LRUCache capacity must be at least 1");
		}
	}

	/**
	 * Retrieves a value from the cache. Returns `undefined` if absent.
	 * Marks the entry as recently used.
	 */
	get(key: K): V | undefined {
		if (!this.cache.has(key)) return undefined;

		// Move to the end of the Map (= most recently used)
		const value = this.cache.get(key) as V;
		this.cache.delete(key);
		this.cache.set(key, value);
		return value;
	}

	/**
	 * Inserts or updates a value in the cache.
	 * If the cache is full, evicts the least recently used entry.
	 */
	set(key: K, value: V): void {
		if (this.cache.has(key)) {
			this.cache.delete(key);
		} else if (this.cache.size >= this.capacity) {
			// Evict the first entry (the oldest one)
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey !== undefined) {
				this.cache.delete(oldestKey);
			}
		}
		this.cache.set(key, value);
	}

	/**
	 * Checks whether a key exists in the cache (without affecting LRU order).
	 */
	has(key: K): boolean {
		return this.cache.has(key);
	}

	/**
	 * Removes an entry from the cache.
	 * @returns `true` if the entry existed and was removed
	 */
	delete(key: K): boolean {
		return this.cache.delete(key);
	}

	/** Clears the entire cache. */
	clear(): void {
		this.cache.clear();
	}

	/** Number of entries currently in the cache. */
	get size(): number {
		return this.cache.size;
	}
}

// ─── Source Snippet Extraction ────────────────────────────────────────────────
// Used to enrich diagnostics with the template fragment that caused the error.

/**
 * Extracts a template fragment around a given position.
 *
 * @param template - The full template source
 * @param loc      - The position (line/column, 1-based) of the error
 * @returns The corresponding code fragment (trimmed)
 */
export function extractSourceSnippet(
	template: string,
	loc: {
		start: { line: number; column: number };
		end: { line: number; column: number };
	},
): string {
	const lines = template.split("\n");
	const startLine = loc.start.line - 1; // 0-based
	const endLine = loc.end.line - 1;

	if (startLine < 0 || startLine >= lines.length) return "";

	if (startLine === endLine) {
		// Same line — extract the portion between start.column and end.column
		const line = lines[startLine] ?? "";
		return line.trim();
	}

	// Multi-line — return the affected lines
	const clampedEnd = Math.min(endLine, lines.length - 1);
	return lines
		.slice(startLine, clampedEnd + 1)
		.map((l) => l.trimEnd())
		.join("\n")
		.trim();
}

// ─── Schema Properties ──────────────────────────────────────────────────────
// Utility for listing available properties in a schema, used to enrich
// error messages with suggestions.

/**
 * Lists the declared property names in a JSON Schema.
 * Returns an empty array if the schema has no `properties`.
 */
export function getSchemaPropertyNames(schema: JSONSchema7): string[] {
	const names = new Set<string>();

	// Direct properties
	if (schema.properties) {
		for (const key of Object.keys(schema.properties)) {
			names.add(key);
		}
	}

	// Properties within combinators
	for (const combinator of ["allOf", "anyOf", "oneOf"] as const) {
		const branches = schema[combinator];
		if (branches) {
			for (const branch of branches) {
				if (typeof branch === "boolean") continue;
				if (branch.properties) {
					for (const key of Object.keys(branch.properties)) {
						names.add(key);
					}
				}
			}
		}
	}

	return Array.from(names).sort();
}

// ─── Object Analysis Aggregation ─────────────────────────────────────────────
// Factorizes the common recursion pattern over template objects:
// iterate the keys, analyze each entry via a callback, accumulate
// diagnostics, and build the output object schema.
//
// Used by:
// - `analyzer.ts` (analyzeObjectTemplate)
// - `Typebars.analyzeObject()` (typebars.ts)
// - `CompiledTemplate.analyze()` in object mode (compiled-template.ts)

/**
 * Aggregates analysis results from a set of named entries into a single
 * `AnalysisResult` with an object-typed `outputSchema`.
 *
 * @param keys         - The keys of the object to analyze
 * @param analyzeEntry - Callback that analyzes an entry by its key
 * @returns An aggregated `AnalysisResult`
 *
 * @example
 * ```
 * aggregateObjectAnalysis(
 *   Object.keys(template),
 *   (key) => analyze(template[key], inputSchema),
 * );
 * ```
 */
export function aggregateObjectAnalysis(
	keys: string[],
	analyzeEntry: (key: string) => AnalysisResult,
): AnalysisResult {
	const allDiagnostics: TemplateDiagnostic[] = [];
	const properties: Record<string, JSONSchema7> = {};
	let allValid = true;

	for (const key of keys) {
		const child = analyzeEntry(key);
		if (!child.valid) allValid = false;
		allDiagnostics.push(...child.diagnostics);
		properties[key] = child.outputSchema;
	}

	return {
		valid: allValid,
		diagnostics: allDiagnostics,
		outputSchema: {
			type: "object",
			properties,
			required: keys,
		},
	};
}

/**
 * Aggregates both analysis **and** execution results from a set of named
 * entries. Returns the aggregated `AnalysisResult` and the object of
 * executed values (or `undefined` if at least one entry is invalid).
 *
 * @param keys         - The keys of the object
 * @param processEntry - Callback that analyzes and executes an entry by its key
 * @returns Aggregated `{ analysis, value }`
 */
export function aggregateObjectAnalysisAndExecution(
	keys: string[],
	processEntry: (key: string) => { analysis: AnalysisResult; value: unknown },
): { analysis: AnalysisResult; value: unknown } {
	const allDiagnostics: TemplateDiagnostic[] = [];
	const properties: Record<string, JSONSchema7> = {};
	const resultValues: Record<string, unknown> = {};
	let allValid = true;

	for (const key of keys) {
		const child = processEntry(key);
		if (!child.analysis.valid) allValid = false;
		allDiagnostics.push(...child.analysis.diagnostics);
		properties[key] = child.analysis.outputSchema;
		resultValues[key] = child.value;
	}

	const analysis: AnalysisResult = {
		valid: allValid,
		diagnostics: allDiagnostics,
		outputSchema: {
			type: "object",
			properties,
			required: keys,
		},
	};

	return {
		analysis,
		value: allValid ? resultValues : undefined,
	};
}
