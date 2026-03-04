import Handlebars from "handlebars";
import type { JSONSchema7 } from "json-schema";
import { dispatchExecute } from "./dispatch.ts";
import { TemplateRuntimeError } from "./errors.ts";
import {
	canUseFastPath,
	coerceLiteral,
	extractExpressionIdentifier,
	extractPathSegments,
	getEffectiveBody,
	getEffectivelySingleBlock,
	getEffectivelySingleExpression,
	isRootPathTraversal,
	isRootSegments,
	isSingleExpression,
	isThisExpression,
	parse,
	ROOT_TOKEN,
} from "./parser.ts";
import type { TemplateInput } from "./types.ts";
import { LRUCache } from "./utils.ts";

// ─── Template Executor ───────────────────────────────────────────────────────
// Executes a Handlebars template with real data.
//
// Four execution modes (from fastest to most general):
//
// 1. **Single expression** (`{{value}}` or `  {{value}}  `) → returns the raw
//    value without converting to string. This preserves the original type
//    (number, boolean, object, array, null).
//
// 2. **Fast-path** (text + simple expressions, no blocks or helpers) →
//    direct concatenation without going through Handlebars.compile(). Up to
//    10-100x faster for simple templates like `Hello {{name}}`.
//
// 3. **Single block** (`{{#if x}}10{{else}}20{{/if}}` possibly surrounded
//    by whitespace) → rendered via Handlebars then intelligently coerced
//    (detecting number, boolean, null literals).
//
// 4. **Mixed template** (text + multiple blocks, helpers, …) →
//    delegates to Handlebars which always produces a string.
//
// ─── Caching ─────────────────────────────────────────────────────────────────
// Handlebars-compiled templates are cached in an LRU cache to avoid costly
// recompilation on repeated calls.
//
// Two cache levels:
// - **Global cache** (module-level) for standalone `execute()` calls
// - **Instance cache** for `Typebars` (passed via `ExecutorContext`)
//
// ─── Template Identifiers ────────────────────────────────────────────────────
// The `{{key:N}}` syntax allows resolving a variable from a specific data
// source, identified by an integer N. The optional `identifierData` parameter
// provides a mapping `{ [id]: { key: value, ... } }`.

// ─── Types ───────────────────────────────────────────────────────────────────

/** Optional context for execution (used by Typebars/CompiledTemplate) */
export interface ExecutorContext {
	/** Data by identifier `{ [id]: { key: value } }` */
	identifierData?: Record<number, Record<string, unknown>>;
	/** Pre-compiled Handlebars template (for CompiledTemplate) */
	compiledTemplate?: HandlebarsTemplateDelegate;
	/** Isolated Handlebars environment (for custom helpers) */
	hbs?: typeof Handlebars;
	/** Compilation cache shared by the engine */
	compilationCache?: LRUCache<string, HandlebarsTemplateDelegate>;
	/**
	 * Explicit coercion schema for the output value.
	 * When set with a primitive type, the execution result will be coerced
	 * to match the declared type instead of using auto-detection.
	 */
	coerceSchema?: JSONSchema7;
}

// ─── Global Compilation Cache ────────────────────────────────────────────────
// Used by the standalone `execute()` function and `renderWithHandlebars()`.
// `Typebars` instances use their own cache.
const globalCompilationCache = new LRUCache<string, HandlebarsTemplateDelegate>(
	128,
);

// ─── Public API (backward-compatible) ────────────────────────────────────────

/**
 * Executes a template with the provided data and returns the result.
 *
 * The return type depends on the template structure:
 * - Single expression `{{expr}}` → raw value (any)
 * - Single block → coerced value (number, boolean, null, or string)
 * - Mixed template → `string`
 *
 * @param template       - The template string
 * @param data           - The main context data
 * @param identifierData - (optional) Data by identifier `{ [id]: { key: value } }`
 */
export function execute(
	template: TemplateInput,
	data: unknown,
	identifierData?: Record<number, Record<string, unknown>>,
): unknown {
	return dispatchExecute(
		template,
		undefined,
		// String handler — parse and execute the AST
		(tpl) => {
			const ast = parse(tpl);
			return executeFromAst(ast, tpl, data, { identifierData });
		},
		// Recursive handler — re-enter execute() for child elements
		(child) => execute(child, data, identifierData),
	);
}

// ─── Internal API (for Typebars / CompiledTemplate) ──────────────────────

/**
 * Executes a template from an already-parsed AST.
 *
 * This function is the core of execution. It is used by:
 * - `execute()` (backward-compatible wrapper)
 * - `CompiledTemplate.execute()` (with pre-parsed AST and cache)
 * - `Typebars.execute()` (with cache and helpers)
 *
 * @param ast       - The already-parsed Handlebars AST
 * @param template  - The template source (for Handlebars compilation if needed)
 * @param data      - The main context data
 * @param ctx       - Optional execution context
 */
export function executeFromAst(
	ast: hbs.AST.Program,
	template: string,
	data: unknown,
	ctx?: ExecutorContext,
): unknown {
	const identifierData = ctx?.identifierData;

	// ── Case 1: strict single expression `{{expr}}` ──────────────────────
	// Exclude helper calls (params > 0 or hash) because they must go
	// through Handlebars for correct execution.
	if (isSingleExpression(ast)) {
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		if (stmt.params.length === 0 && !stmt.hash) {
			return resolveExpression(stmt.path, data, identifierData);
		}
	}

	// ── Case 1b: single expression with surrounding whitespace `  {{expr}}  `
	const singleExpr = getEffectivelySingleExpression(ast);
	if (singleExpr && singleExpr.params.length === 0 && !singleExpr.hash) {
		return resolveExpression(singleExpr.path, data, identifierData);
	}

	// ── Case 1c: single expression with helper (params > 0) ──────────────
	// E.g. `{{ divide accountIds.length 10 }}` or `{{ math a "+" b }}`
	// The helper returns a typed value but Handlebars converts it to a
	// string. We render via Handlebars then coerce the result to recover
	// the original type (number, boolean, null).
	if (singleExpr && (singleExpr.params.length > 0 || singleExpr.hash)) {
		const merged = mergeDataWithIdentifiers(data, identifierData);
		const raw = renderWithHandlebars(template, merged, ctx);
		return coerceValue(raw, ctx?.coerceSchema);
	}

	// ── Case 2: fast-path for simple templates (text + expressions) ──────
	// If the template only contains text and simple expressions (no blocks,
	// no helpers with parameters), we can do direct concatenation without
	// going through Handlebars.compile().
	if (canUseFastPath(ast) && ast.body.length > 1) {
		return executeFastPath(ast, data, identifierData);
	}

	// ── Case 3: single block (possibly surrounded by whitespace) ─────────
	// Render via Handlebars then attempt to coerce the result to the
	// detected literal type (number, boolean, null).
	const singleBlock = getEffectivelySingleBlock(ast);
	if (singleBlock) {
		const merged = mergeDataWithIdentifiers(data, identifierData);
		const raw = renderWithHandlebars(template, merged, ctx);
		return coerceValue(raw, ctx?.coerceSchema);
	}

	// ── Case 4: mixed template ───────────────────────────────────────────
	// For purely static templates (only ContentStatements), coerce the
	// result to match the coerceSchema type or auto-detect the literal type.
	// For truly mixed templates (text + blocks + expressions), return string.
	const merged = mergeDataWithIdentifiers(data, identifierData);
	const raw = renderWithHandlebars(template, merged, ctx);

	const effective = getEffectiveBody(ast);
	const allContent = effective.every((s) => s.type === "ContentStatement");
	if (allContent) {
		return coerceValue(raw, ctx?.coerceSchema);
	}

	return raw;
}

// ─── Value Coercion ──────────────────────────────────────────────────────────
// Coerces a raw string from Handlebars rendering based on an optional
// coerceSchema. When no schema is provided, falls back to auto-detection
// via `coerceLiteral`.

/**
 * Coerces a raw string value based on an optional coercion schema.
 *
 * - If `coerceSchema` declares a primitive type (`string`, `number`,
 *   `integer`, `boolean`, `null`), the value is cast to that type.
 * - Otherwise, falls back to `coerceLiteral` (auto-detection).
 *
 * @param raw          - The raw string from Handlebars rendering
 * @param coerceSchema - Optional schema declaring the desired output type
 * @returns The coerced value
 */
function coerceValue(raw: string, coerceSchema?: JSONSchema7): unknown {
	if (coerceSchema) {
		const targetType = coerceSchema.type;
		if (typeof targetType === "string") {
			if (targetType === "string") return raw;
			if (targetType === "number" || targetType === "integer")
				return Number(raw.trim());
			if (targetType === "boolean") return raw.trim() === "true";
			if (targetType === "null") return null;
		}
	}
	// No coerceSchema or non-primitive type → auto-detect
	return coerceLiteral(raw);
}

// ─── Fast-Path Execution ─────────────────────────────────────────────────────
// For templates consisting only of text and simple expressions (no blocks,
// no helpers), we bypass Handlebars and do direct concatenation.
// This is significantly faster.

/**
 * Executes a template via the fast-path (direct concatenation).
 *
 * Precondition: `canUseFastPath(ast)` must return `true`.
 *
 * @param ast            - The template AST (only ContentStatement and simple MustacheStatement)
 * @param data           - The context data
 * @param identifierData - Data by identifier (optional)
 * @returns The resulting string
 */
function executeFastPath(
	ast: hbs.AST.Program,
	data: unknown,
	identifierData?: Record<number, Record<string, unknown>>,
): string {
	let result = "";

	for (const stmt of ast.body) {
		if (stmt.type === "ContentStatement") {
			result += (stmt as hbs.AST.ContentStatement).value;
		} else if (stmt.type === "MustacheStatement") {
			const value = resolveExpression(
				(stmt as hbs.AST.MustacheStatement).path,
				data,
				identifierData,
			);
			// Handlebars converts values to strings for rendering.
			// We replicate this behavior: null/undefined → "", otherwise String(value).
			if (value != null) {
				result += String(value);
			}
		}
	}

	return result;
}

// ─── Direct Expression Resolution ────────────────────────────────────────────
// Used for single-expression templates and the fast-path, to return the raw
// value without going through the Handlebars engine.

/**
 * Resolves an AST expression by following the path through the data.
 *
 * If the expression contains an identifier (e.g. `meetingId:1`), resolution
 * is performed in `identifierData[1]` instead of `data`.
 *
 * @param expr           - The AST expression to resolve
 * @param data           - The main data context
 * @param identifierData - Data by identifier (optional)
 * @returns The raw value pointed to by the expression
 */
function resolveExpression(
	expr: hbs.AST.Expression,
	data: unknown,
	identifierData?: Record<number, Record<string, unknown>>,
): unknown {
	// this / . → return the entire context
	if (isThisExpression(expr)) {
		return data;
	}

	// Literals
	if (expr.type === "StringLiteral")
		return (expr as hbs.AST.StringLiteral).value;
	if (expr.type === "NumberLiteral")
		return (expr as hbs.AST.NumberLiteral).value;
	if (expr.type === "BooleanLiteral")
		return (expr as hbs.AST.BooleanLiteral).value;
	if (expr.type === "NullLiteral") return null;
	if (expr.type === "UndefinedLiteral") return undefined;

	// PathExpression — navigate through segments in the data object
	const segments = extractPathSegments(expr);
	if (segments.length === 0) {
		throw new TemplateRuntimeError(
			`Cannot resolve expression of type "${expr.type}"`,
		);
	}

	// Extract the potential identifier from the last segment BEFORE
	// checking for $root, so that both {{$root}} and {{$root:N}} are
	// handled uniformly.
	const { cleanSegments, identifier } = extractExpressionIdentifier(segments);

	// $root path traversal ($root.name) — not supported, return undefined
	// (the analyzer already rejects it with a diagnostic).
	if (isRootPathTraversal(cleanSegments)) {
		return undefined;
	}

	// $root → return the entire data context (or identifier data)
	if (isRootSegments(cleanSegments)) {
		if (identifier !== null && identifierData) {
			const source = identifierData[identifier];
			return source ?? undefined;
		}
		if (identifier !== null) {
			// Template uses an identifier but no identifierData was provided
			return undefined;
		}
		return data;
	}

	if (identifier !== null && identifierData) {
		const source = identifierData[identifier];
		if (source) {
			return resolveDataPath(source, cleanSegments);
		}
		// Source does not exist → undefined (like a missing key)
		return undefined;
	}

	if (identifier !== null && !identifierData) {
		// Template uses an identifier but no identifierData was provided
		return undefined;
	}

	return resolveDataPath(data, cleanSegments);
}

/**
 * Navigates through a data object by following a path of segments.
 *
 * @param data     - The data object
 * @param segments - The path segments (e.g. `["user", "address", "city"]`)
 * @returns The value at the end of the path, or `undefined` if an
 *          intermediate segment is null/undefined
 */
export function resolveDataPath(data: unknown, segments: string[]): unknown {
	let current: unknown = data;

	for (const segment of segments) {
		if (current === null || current === undefined) {
			return undefined;
		}

		if (typeof current !== "object") {
			return undefined;
		}

		current = (current as Record<string, unknown>)[segment];
	}

	return current;
}

// ─── Data Merging ────────────────────────────────────────────────────────────
// For Handlebars rendering (mixed templates / blocks), we cannot intercept
// resolution on a per-expression basis. Instead, we merge identifier data
// into the main object using the format `"key:N"`.
//
// Handlebars parses `{{meetingId:1}}` as a PathExpression with a single
// segment `"meetingId:1"`, so it looks up the key `"meetingId:1"` in the
// data object — which matches our flattened format exactly.

/**
 * Merges the main data with identifier data.
 *
 * @param data           - Main data
 * @param identifierData - Data by identifier
 * @returns A merged object where identifier data appears as `"key:N"` keys
 *
 * @example
 * ```
 * mergeDataWithIdentifiers(
 *   { name: "Alice" },
 *   { 1: { meetingId: "val1" }, 2: { meetingId: "val2" } }
 * )
 * // → { name: "Alice", "meetingId:1": "val1", "meetingId:2": "val2" }
 * ```
 */
function mergeDataWithIdentifiers(
	data: unknown,
	identifierData?: Record<number, Record<string, unknown>>,
): Record<string, unknown> {
	// Always include $root so that Handlebars can resolve {{$root}} in
	// mixed templates and block helpers (where we delegate to Handlebars
	// instead of resolving expressions ourselves).
	// When data is a primitive (e.g. number passed with {{$root}}), we
	// wrap it into an object so Handlebars can still function.
	const base: Record<string, unknown> =
		data !== null && typeof data === "object" && !Array.isArray(data)
			? (data as Record<string, unknown>)
			: {};
	const merged: Record<string, unknown> = { ...base, [ROOT_TOKEN]: data };

	if (!identifierData) return merged;

	for (const [id, idData] of Object.entries(identifierData)) {
		// Add `$root:N` so Handlebars can resolve {{$root:N}} in mixed/block
		// templates (where we delegate to Handlebars instead of resolving
		// expressions ourselves). The value is the entire identifier data object.
		merged[`${ROOT_TOKEN}:${id}`] = idData;

		for (const [key, value] of Object.entries(idData)) {
			merged[`${key}:${id}`] = value;
		}
	}

	return merged;
}

// ─── Handlebars Rendering ────────────────────────────────────────────────────
// For complex templates (blocks, helpers), we delegate to Handlebars.
// Compilation is cached to avoid costly recompilations.

/**
 * Compiles and executes a template via Handlebars.
 *
 * Uses a compilation cache (LRU) to avoid recompiling the same template
 * on repeated calls. The cache is either:
 * - The global cache (for the standalone `execute()` function)
 * - The instance cache provided via `ExecutorContext` (for `Typebars`)
 *
 * @param template - The template string
 * @param data     - The context data
 * @param ctx      - Optional execution context (cache, Handlebars env)
 * @returns Always a string
 */
function renderWithHandlebars(
	template: string,
	data: Record<string, unknown>,
	ctx?: ExecutorContext,
): string {
	try {
		// 1. Use the pre-compiled template if available (CompiledTemplate)
		if (ctx?.compiledTemplate) {
			return ctx.compiledTemplate(data);
		}

		// 2. Look up in the cache (instance or global)
		const cache = ctx?.compilationCache ?? globalCompilationCache;
		const hbs = ctx?.hbs ?? Handlebars;

		let compiled = cache.get(template);
		if (!compiled) {
			compiled = hbs.compile(template, {
				// Disable HTML-escaping by default — this engine is not
				// HTML-specific, we want raw values.
				noEscape: true,
				// Strict mode: throws if a path does not exist in the data.
				strict: false,
			});
			cache.set(template, compiled);
		}

		return compiled(data);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		throw new TemplateRuntimeError(message);
	}
}

/**
 * Clears the global Handlebars compilation cache.
 * Useful for tests or to free memory.
 */
export function clearCompilationCache(): void {
	globalCompilationCache.clear();
}
