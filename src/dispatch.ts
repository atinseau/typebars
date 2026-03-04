import type { JSONSchema7 } from "json-schema";
import { hasHandlebarsExpression } from "./parser.ts";
import { resolveSchemaPath } from "./schema-resolver.ts";
import type { AnalysisResult, TemplateInput } from "./types.ts";
import {
	inferPrimitiveSchema,
	isArrayInput,
	isLiteralInput,
	isObjectInput,
} from "./types.ts";
import {
	aggregateArrayAnalysis,
	aggregateArrayAnalysisAndExecution,
	aggregateObjectAnalysis,
	aggregateObjectAnalysisAndExecution,
} from "./utils.ts";

// ─── Template Input Dispatching ──────────────────────────────────────────────
// Factorized dispatching for recursive processing of `TemplateInput` values.
//
// Every method in the engine (`analyze`, `execute`, `analyzeAndExecute`,
// `compile`) follows the same recursive pattern:
//
//   1. If the input is an **array** → process each element recursively
//   2. If the input is an **object** → process each property recursively
//   3. If the input is a **literal** (number, boolean, null) → passthrough
//   4. If the input is a **string** → delegate to a template-specific handler
//
// This module extracts the common dispatching logic into generic functions
// that accept a callback for the string (template) case. This eliminates
// the duplication across `Typebars`, `CompiledTemplate`, and `analyzer.ts`.

// ─── Types ───────────────────────────────────────────────────────────────────

/** Options controlling recursive dispatching behavior */
export interface DispatchAnalyzeOptions {
	/** Schemas by template identifier */
	identifierSchemas?: Record<number, JSONSchema7>;
	/** Explicit coercion schema for static literal output type */
	coerceSchema?: JSONSchema7;
	/** When true, exclude entries containing Handlebars expressions */
	excludeTemplateExpression?: boolean;
}

/** Options controlling recursive execution dispatching */
export interface DispatchExecuteOptions {
	/** Explicit coercion schema for output type coercion */
	coerceSchema?: JSONSchema7;
}

// ─── Analysis Dispatching ────────────────────────────────────────────────────

/**
 * Dispatches a `TemplateInput` for analysis, handling the array/object/literal
 * cases generically and delegating the string (template) case to a callback.
 *
 * @param template       - The input to analyze
 * @param options        - Dispatching options (coerceSchema, excludeTemplateExpression)
 * @param analyzeString  - Callback for analyzing a string template.
 *                         Receives `(template, coerceSchema?)` and must return an `AnalysisResult`.
 * @param recurse        - Callback for recursively analyzing a child `TemplateInput`.
 *                         Receives `(child, options?)` and must return an `AnalysisResult`.
 *                         This allows callers (like `Typebars`) to rebind `this` or inject
 *                         additional context on each recursive call.
 * @returns An `AnalysisResult`
 */
export function dispatchAnalyze(
	template: TemplateInput,
	options: DispatchAnalyzeOptions | undefined,
	analyzeString: (
		template: string,
		coerceSchema?: JSONSchema7,
	) => AnalysisResult,
	recurse: (
		child: TemplateInput,
		options?: DispatchAnalyzeOptions,
	) => AnalysisResult,
): AnalysisResult {
	// ── Array ─────────────────────────────────────────────────────────────
	if (isArrayInput(template)) {
		const exclude = options?.excludeTemplateExpression === true;
		if (exclude) {
			const kept = template.filter(
				(item) => !shouldExcludeEntry(item as TemplateInput),
			);
			return aggregateArrayAnalysis(kept.length, (index) =>
				recurse(kept[index] as TemplateInput, options),
			);
		}
		return aggregateArrayAnalysis(template.length, (index) =>
			recurse(template[index] as TemplateInput, options),
		);
	}

	// ── Object ────────────────────────────────────────────────────────────
	if (isObjectInput(template)) {
		return dispatchObjectAnalysis(template, options, recurse);
	}

	// ── Literal (number, boolean, null) ───────────────────────────────────
	if (isLiteralInput(template)) {
		return {
			valid: true,
			diagnostics: [],
			outputSchema: inferPrimitiveSchema(template),
		};
	}

	// ── String template ──────────────────────────────────────────────────
	return analyzeString(template, options?.coerceSchema);
}

/**
 * Dispatches object analysis with `coerceSchema` propagation and
 * `excludeTemplateExpression` filtering.
 *
 * Extracted as a separate function because the object case is the most
 * complex (key filtering + per-key coerceSchema resolution).
 */
function dispatchObjectAnalysis(
	template: Record<string, TemplateInput>,
	options: DispatchAnalyzeOptions | undefined,
	recurse: (
		child: TemplateInput,
		options?: DispatchAnalyzeOptions,
	) => AnalysisResult,
): AnalysisResult {
	const coerceSchema = options?.coerceSchema;
	const exclude = options?.excludeTemplateExpression === true;

	const keys = exclude
		? Object.keys(template).filter(
				(key) => !shouldExcludeEntry(template[key] as TemplateInput),
			)
		: Object.keys(template);

	return aggregateObjectAnalysis(keys, (key) => {
		const childCoerceSchema = resolveChildCoerceSchema(coerceSchema, key);
		return recurse(template[key] as TemplateInput, {
			identifierSchemas: options?.identifierSchemas,
			coerceSchema: childCoerceSchema,
			excludeTemplateExpression: options?.excludeTemplateExpression,
		});
	});
}

// ─── Execution Dispatching ───────────────────────────────────────────────────

/**
 * Dispatches a `TemplateInput` for execution, handling the array/object/literal
 * cases generically and delegating the string (template) case to a callback.
 *
 * @param template       - The input to execute
 * @param options        - Dispatching options (coerceSchema)
 * @param executeString  - Callback for executing a string template.
 *                         Receives `(template, coerceSchema?)` and must return the result.
 * @param recurse        - Callback for recursively executing a child `TemplateInput`.
 *                         Receives `(child, options?)` and must return the result.
 * @returns The execution result
 */
export function dispatchExecute(
	template: TemplateInput,
	options: DispatchExecuteOptions | undefined,
	executeString: (template: string, coerceSchema?: JSONSchema7) => unknown,
	recurse: (child: TemplateInput, options?: DispatchExecuteOptions) => unknown,
): unknown {
	// ── Array ─────────────────────────────────────────────────────────────
	if (isArrayInput(template)) {
		const result: unknown[] = [];
		for (const element of template) {
			result.push(recurse(element, options));
		}
		return result;
	}

	// ── Object ────────────────────────────────────────────────────────────
	if (isObjectInput(template)) {
		const coerceSchema = options?.coerceSchema;
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(template)) {
			const childCoerceSchema = resolveChildCoerceSchema(coerceSchema, key);
			result[key] = recurse(value, {
				...options,
				coerceSchema: childCoerceSchema,
			});
		}
		return result;
	}

	// ── Literal (number, boolean, null) ───────────────────────────────────
	if (isLiteralInput(template)) return template;

	// ── String template ──────────────────────────────────────────────────
	return executeString(template, options?.coerceSchema);
}

// ─── Analyze-and-Execute Dispatching ─────────────────────────────────────────

/** Options for combined analyze-and-execute dispatching */
export interface DispatchAnalyzeAndExecuteOptions {
	identifierSchemas?: Record<number, JSONSchema7>;
	identifierData?: Record<number, Record<string, unknown>>;
	coerceSchema?: JSONSchema7;
}

/**
 * Dispatches a `TemplateInput` for combined analysis and execution,
 * handling array/object/literal cases generically and delegating
 * the string case to a callback.
 *
 * @param template       - The input to process
 * @param options        - Options (identifierSchemas, identifierData, coerceSchema)
 * @param processString  - Callback for analyzing and executing a string template.
 *                         Receives `(template, coerceSchema?)` and must return
 *                         `{ analysis, value }`.
 * @param recurse        - Callback for recursively processing a child `TemplateInput`.
 * @returns `{ analysis, value }` where `value` is `undefined` if analysis fails
 */
export function dispatchAnalyzeAndExecute(
	template: TemplateInput,
	options: DispatchAnalyzeAndExecuteOptions | undefined,
	processString: (
		template: string,
		coerceSchema?: JSONSchema7,
	) => { analysis: AnalysisResult; value: unknown },
	recurse: (
		child: TemplateInput,
		options?: DispatchAnalyzeAndExecuteOptions,
	) => { analysis: AnalysisResult; value: unknown },
): { analysis: AnalysisResult; value: unknown } {
	// ── Array ─────────────────────────────────────────────────────────────
	if (isArrayInput(template)) {
		return aggregateArrayAnalysisAndExecution(template.length, (index) =>
			recurse(template[index] as TemplateInput, options),
		);
	}

	// ── Object ────────────────────────────────────────────────────────────
	if (isObjectInput(template)) {
		const coerceSchema = options?.coerceSchema;
		return aggregateObjectAnalysisAndExecution(Object.keys(template), (key) => {
			const childCoerceSchema = resolveChildCoerceSchema(coerceSchema, key);
			return recurse(template[key] as TemplateInput, {
				identifierSchemas: options?.identifierSchemas,
				identifierData: options?.identifierData,
				coerceSchema: childCoerceSchema,
			});
		});
	}

	// ── Literal (number, boolean, null) ───────────────────────────────────
	if (isLiteralInput(template)) {
		return {
			analysis: {
				valid: true,
				diagnostics: [],
				outputSchema: inferPrimitiveSchema(template),
			},
			value: template,
		};
	}

	// ── String template ──────────────────────────────────────────────────
	return processString(template, options?.coerceSchema);
}

// ─── Internal Utilities ──────────────────────────────────────────────────────

/**
 * Resolves the child `coerceSchema` for a given object key.
 *
 * When a `coerceSchema` is provided, navigates into its `properties`
 * to find the schema for the given key. This allows deeply nested
 * objects to propagate coercion at every level.
 *
 * @param coerceSchema - The parent coercion schema (may be `undefined`)
 * @param key          - The object property key
 * @returns The child coercion schema, or `undefined`
 */
export function resolveChildCoerceSchema(
	coerceSchema: JSONSchema7 | undefined,
	key: string,
): JSONSchema7 | undefined {
	return coerceSchema ? resolveSchemaPath(coerceSchema, [key]) : undefined;
}

/**
 * Determines whether a `TemplateInput` value should be excluded when
 * `excludeTemplateExpression` is enabled.
 *
 * A value is excluded if it is a string containing at least one Handlebars
 * expression (`{{…}}`). Literals (number, boolean, null), plain strings
 * without expressions, objects, and arrays are never excluded at the
 * entry level — objects and arrays are recursively filtered by the
 * dispatching functions themselves.
 *
 * @param input - The template input to check
 * @returns `true` if the input should be excluded
 */
export function shouldExcludeEntry(input: TemplateInput): boolean {
	return typeof input === "string" && hasHandlebarsExpression(input);
}
