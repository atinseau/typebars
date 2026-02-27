import Handlebars from "handlebars";
import { TemplateRuntimeError } from "./errors";
import {
	canUseFastPath,
	coerceLiteral,
	extractExpressionIdentifier,
	extractPathSegments,
	getEffectivelySingleBlock,
	getEffectivelySingleExpression,
	isSingleExpression,
	isThisExpression,
	parse,
} from "./parser";
import type { TemplateInput, TemplateInputObject } from "./types";
import { isLiteralInput, isObjectInput } from "./types";
import { LRUCache } from "./utils";

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
	data: Record<string, unknown>,
	identifierData?: Record<number, Record<string, unknown>>,
): unknown {
	if (isObjectInput(template)) {
		return executeObjectTemplate(template, data, identifierData);
	}
	if (isLiteralInput(template)) return template;
	const ast = parse(template);
	return executeFromAst(ast, template, data, { identifierData });
}

/**
 * Executes an object template recursively (standalone version).
 * Each property is executed individually and the result is an object
 * with the same structure but resolved values.
 */
function executeObjectTemplate(
	template: TemplateInputObject,
	data: Record<string, unknown>,
	identifierData?: Record<number, Record<string, unknown>>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(template)) {
		result[key] = execute(value, data, identifierData);
	}
	return result;
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
	data: Record<string, unknown>,
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
		return coerceLiteral(raw);
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
		return coerceLiteral(raw);
	}

	// ── Case 4: mixed template → string ──────────────────────────────────
	const merged = mergeDataWithIdentifiers(data, identifierData);
	return renderWithHandlebars(template, merged, ctx);
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
	data: Record<string, unknown>,
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
	data: Record<string, unknown>,
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

	// Extract the potential identifier from the last segment
	const { cleanSegments, identifier } = extractExpressionIdentifier(segments);

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
	data: Record<string, unknown>,
	identifierData?: Record<number, Record<string, unknown>>,
): Record<string, unknown> {
	if (!identifierData) return data;

	const merged: Record<string, unknown> = { ...data };

	for (const [id, idData] of Object.entries(identifierData)) {
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
