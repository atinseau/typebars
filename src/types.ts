import type { JSONSchema7 } from "json-schema";
import type { FromSchema, JSONSchema } from "json-schema-to-ts";

// ─── Template Input ──────────────────────────────────────────────────────────
// The engine accepts primitive values in addition to template strings.
// When a non-string value is passed, it is treated as a literal passthrough:
// analysis returns the inferred type, and execution returns the value as-is.

/**
 * Object where each property is a `TemplateInput` (recursive).
 *
 * Allows passing an entire structure as a template:
 * ```
 * engine.analyze({
 *   userName: "{{name}}",
 *   userAge: "{{age}}",
 *   nested: { x: "{{foo}}" },
 * }, inputSchema);
 * ```
 */
export interface TemplateInputObject {
	[key: string]: TemplateInput;
}

/**
 * Array where each element is a `TemplateInput` (recursive).
 *
 * Allows passing an array as a template:
 * ```
 * engine.analyze(["{{name}}", "{{age}}"], inputSchema);
 * engine.execute(["{{name}}", 42], data);
 * ```
 */
export type TemplateInputArray = TemplateInput[];

/**
 * Input type accepted by the template engine.
 *
 * - `string`              → standard Handlebars template (parsed and executed)
 * - `number`              → numeric literal (passthrough)
 * - `boolean`             → boolean literal (passthrough)
 * - `null`                → null literal (passthrough)
 * - `TemplateInputArray`  → array where each element is a `TemplateInput`
 * - `TemplateInputObject` → object where each property is a `TemplateInput`
 */
export type TemplateInput =
	| string
	| number
	| boolean
	| null
	| TemplateInputArray
	| TemplateInputObject;

// ─── Template Data ───────────────────────────────────────────────────────────
// The data parameter accepted by `execute()` and `analyzeAndExecute()`.
// In most cases this is a `Record<string, unknown>` (object context), but
// primitives are also allowed — for example when using `{{$root}}` to
// reference the entire data value directly.

/**
 * Data type accepted by the template engine's execution methods.
 *
 * - `Record<string, unknown>` → standard object context (most common)
 * - `string`                  → primitive value (e.g. for `{{$root}}`)
 * - `number`                  → primitive value
 * - `boolean`                 → primitive value
 * - `null`                    → null value
 * - `unknown[]`               → array value
 */
export type TemplateData =
	| Record<string, unknown>
	| string
	| number
	| boolean
	| null
	| unknown[];

/**
 * Checks whether a value is a non-string primitive literal (number, boolean, null).
 * These values are treated as passthrough by the engine.
 *
 * Note: objects (`TemplateInputObject`) and arrays (`TemplateInputArray`) are NOT literals.
 */
export function isLiteralInput(
	input: TemplateInput,
): input is number | boolean | null {
	return (
		input === null || (typeof input !== "string" && typeof input !== "object")
	);
}

/**
 * Checks whether a value is a template array (`TemplateInputArray`).
 * Template arrays are processed recursively by the engine:
 * each element is analyzed/executed individually and the result is an array.
 */
export function isArrayInput(
	input: TemplateInput,
): input is TemplateInputArray {
	return Array.isArray(input);
}

/**
 * Checks whether a value is a template object (`TemplateInputObject`).
 * Template objects are processed recursively by the engine:
 * each property is analyzed/executed individually.
 *
 * Note: arrays are excluded — use `isArrayInput()` first.
 */
export function isObjectInput(
	input: TemplateInput,
): input is TemplateInputObject {
	return input !== null && typeof input === "object" && !Array.isArray(input);
}

/**
 * Infers the JSON Schema of a non-string primitive value.
 *
 * @param value - The primitive value (number, boolean, null)
 * @returns The corresponding JSON Schema
 *
 * @example
 * ```
 * inferPrimitiveSchema(42)    // → { type: "number" }
 * inferPrimitiveSchema(true)  // → { type: "boolean" }
 * inferPrimitiveSchema(null)  // → { type: "null" }
 * ```
 */
export function inferPrimitiveSchema(
	value: number | boolean | null,
): JSONSchema7 {
	if (value === null) return { type: "null" };
	if (typeof value === "boolean") return { type: "boolean" };
	if (typeof value === "number") {
		return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
	}
	// Exhaustiveness check — all branches are covered above.
	// If the type of `value` changes, TypeScript will raise an error here.
	value satisfies never;
	return { type: "null" };
}

// ─── Diagnostic Codes ────────────────────────────────────────────────────────
// Machine-readable codes for each error/warning type, enabling the frontend
// to react programmatically without parsing the human-readable message.

export type DiagnosticCode =
	/** The referenced property does not exist in the context schema */
	| "UNKNOWN_PROPERTY"
	/** Type mismatch (e.g. #each on a non-array) */
	| "TYPE_MISMATCH"
	/** A block helper is used without a required argument */
	| "MISSING_ARGUMENT"
	/** Unknown block helper (neither built-in nor registered) */
	| "UNKNOWN_HELPER"
	/** The expression cannot be statically analyzed */
	| "UNANALYZABLE"
	/** The {{key:N}} syntax is used but no identifierSchemas were provided */
	| "MISSING_IDENTIFIER_SCHEMAS"
	/** The identifier N does not exist in the provided identifierSchemas */
	| "UNKNOWN_IDENTIFIER"
	/** The property does not exist in the identifier's schema */
	| "IDENTIFIER_PROPERTY_NOT_FOUND"
	/** Syntax error in the template */
	| "PARSE_ERROR"
	/** The $root token is used with path traversal (e.g. $root.name) */
	| "ROOT_PATH_TRAVERSAL";

// ─── Diagnostic Details ──────────────────────────────────────────────────────
// Supplementary information to understand the exact cause of the error.
// Designed to be easily JSON-serializable and consumable by a frontend.

export interface DiagnosticDetails {
	/** Path of the expression that caused the error (e.g. `"user.name.foo"`) */
	path?: string;
	/** Name of the helper involved (for helper-related errors) */
	helperName?: string;
	/** What was expected (e.g. `"array"`, `"property to exist"`) */
	expected?: string;
	/** What was found (e.g. `"string"`, `"undefined"`) */
	actual?: string;
	/** Available properties in the current schema (for suggestions) */
	availableProperties?: string[];
	/** Template identifier number (for `{{key:N}}` errors) */
	identifier?: number;
}

// ─── Static Analysis Result ──────────────────────────────────────────────────

/** Diagnostic produced by the static analyzer */
export interface TemplateDiagnostic {
	/** "error" blocks execution, "warning" is informational */
	severity: "error" | "warning";

	/** Machine-readable code identifying the error type */
	code: DiagnosticCode;

	/** Human-readable message describing the problem */
	message: string;

	/** Position in the template source (if available from the AST) */
	loc?: {
		start: { line: number; column: number };
		end: { line: number; column: number };
	};

	/** Fragment of the template source around the error */
	source?: string;

	/** Structured information for debugging and frontend display */
	details?: DiagnosticDetails;
}

/** Complete result of the static analysis */
export interface AnalysisResult {
	/** true if no errors (warnings are tolerated) */
	valid: boolean;
	/** List of diagnostics (errors + warnings) */
	diagnostics: TemplateDiagnostic[];
	/** JSON Schema describing the template's return type */
	outputSchema: JSONSchema7;
}

/** Lightweight validation result (without output type inference) */
export interface ValidationResult {
	/** true if no errors (warnings are tolerated) */
	valid: boolean;
	/** List of diagnostics (errors + warnings) */
	diagnostics: TemplateDiagnostic[];
}

// ─── Public Engine Options ───────────────────────────────────────────────────

export interface TemplateEngineOptions {
	/**
	 * Capacity of the parsed AST cache. Each parsed template is cached
	 * to avoid costly re-parsing on repeated calls.
	 * @default 256
	 */
	astCacheSize?: number;

	/**
	 * Capacity of the compiled Handlebars template cache.
	 * @default 256
	 */
	compilationCacheSize?: number;

	/**
	 * Custom helpers to register during engine construction.
	 *
	 * Each entry describes a helper with its name, implementation,
	 * expected parameters, and return type.
	 *
	 * @example
	 * ```
	 * const engine = new Typebars({
	 *   helpers: [
	 *     {
	 *       name: "uppercase",
	 *       description: "Converts a string to uppercase",
	 *       fn: (value: string) => String(value).toUpperCase(),
	 *       params: [
	 *         { name: "value", type: { type: "string" }, description: "The string to convert" },
	 *       ],
	 *       returnType: { type: "string" },
	 *     },
	 *   ],
	 * });
	 * ```
	 */
	helpers?: HelperConfig[];
}

export interface CommonTypebarsOptions {
	/**
	 * Explicit coercion schema for the output value.
	 * When provided with a primitive type, the execution result will be
	 * coerced to match the declared type instead of using auto-detection.
	 */
	coerceSchema?: JSONSchema7;
	/**
	 * When `true`, properties whose values contain Handlebars expressions
	 * (i.e. any `{{…}}` syntax) are excluded from the execution result.
	 *
	 * - **Object**: properties with template expressions are omitted from
	 *   the resulting object.
	 * - **Array**: elements with template expressions are omitted from
	 *   the resulting array.
	 * - **Root string** with expressions: returns `null` (there is no
	 *   parent to exclude from).
	 * - **Literals** (number, boolean, null): unaffected.
	 *
	 * This mirrors the analysis-side `excludeTemplateExpression` option
	 * but applied at runtime.
	 *
	 * @default false
	 */
	excludeTemplateExpression?: boolean;
}

// ─── Execution Options ───────────────────────────────────────────────────────
// Optional options object for `execute()`, replacing multiple positional
// parameters for better ergonomics.

export interface ExecuteOptions extends CommonTypebarsOptions {
	/** JSON Schema for pre-execution static validation */
	schema?: JSONSchema7;
	/** Data by identifier `{ [id]: { key: value } }` */
	identifierData?: Record<number, Record<string, unknown>>;
	/** Schemas by identifier (for static validation with identifiers) */
	identifierSchemas?: Record<number, JSONSchema7>;
}

// ─── Combined Analyze-and-Execute Options ────────────────────────────────────
// Optional options object for `analyzeAndExecute()`, grouping parameters
// related to template identifiers.

export interface AnalyzeAndExecuteOptions extends CommonTypebarsOptions {
	/** Schemas by identifier `{ [id]: JSONSchema7 }` for static analysis */
	identifierSchemas?: Record<number, JSONSchema7>;
	/** Data by identifier `{ [id]: { key: value } }` for execution */
	identifierData?: Record<number, Record<string, unknown>>;
}

// ─── Custom Helpers ──────────────────────────────────────────────────────────
// Allows registering custom helpers with their type signature for static
// analysis support.

/** Describes a parameter expected by a helper */
export interface HelperParam {
	/** Parameter name (for documentation / introspection) */
	name: string;

	/**
	 * JSON Schema describing the expected type for this parameter.
	 * Used for documentation and static validation.
	 */
	type?: JSONSchema7;

	/** Human-readable description of the parameter */
	description?: string;

	/**
	 * Whether the parameter is optional.
	 * @default false
	 */
	optional?: boolean;
}

/**
 * Definition of a helper registerable via `registerHelper()`.
 *
 * Contains the runtime implementation and typing metadata
 * for static analysis.
 */
export interface HelperDefinition {
	/**
	 * Runtime implementation of the helper — will be registered with Handlebars.
	 *
	 * For an inline helper `{{uppercase name}}`:
	 *   `(value: string) => string`
	 *
	 * For a block helper `{{#repeat count}}...{{/repeat}}`:
	 *   `function(this: any, count: number, options: Handlebars.HelperOptions) { ... }`
	 */
	// biome-ignore lint/suspicious/noExplicitAny: Handlebars helper signatures are inherently dynamic
	fn: (...args: any[]) => unknown;

	/**
	 * Parameters expected by the helper (for documentation and analysis).
	 *
	 * @example
	 * ```
	 * params: [
	 *   { name: "value", type: { type: "number" }, description: "The value to round" },
	 *   { name: "precision", type: { type: "number" }, description: "Decimal places", optional: true },
	 * ]
	 * ```
	 */
	params?: HelperParam[];

	/**
	 * JSON Schema describing the helper's return type for static analysis.
	 * @default { type: "string" }
	 */
	returnType?: JSONSchema7;

	/** Human-readable description of the helper */
	description?: string;
}

/**
 * Full helper configuration for registration via the `Typebars({ helpers: [...] })`
 * constructor options.
 *
 * Extends `HelperDefinition` with a required `name`.
 *
 * @example
 * ```
 * const config: HelperConfig = {
 *   name: "round",
 *   description: "Rounds a number to a given precision",
 *   fn: (value: number, precision?: number) => { ... },
 *   params: [
 *     { name: "value", type: { type: "number" } },
 *     { name: "precision", type: { type: "number" }, optional: true },
 *   ],
 *   returnType: { type: "number" },
 * };
 * ```
 */
export interface HelperConfig extends HelperDefinition {
	/** Name of the helper as used in templates (e.g. `"uppercase"`) */
	name: string;
}

// ─── Automatic Type Inference via json-schema-to-ts ──────────────────────────
// Allows `defineHelper()` to infer TypeScript types for `fn` arguments
// from the JSON Schemas declared in `params`.

/**
 * Param definition used for type inference.
 * Accepts `JSONSchema` from `json-schema-to-ts` to allow `FromSchema`
 * to resolve literal types.
 */
type TypedHelperParam = {
	readonly name: string;
	readonly type?: JSONSchema;
	readonly description?: string;
	readonly optional?: boolean;
};

/**
 * Infers the TypeScript type of a single parameter from its JSON Schema.
 * - If `optional: true`, the resolved type is unioned with `undefined`.
 * - If `type` is not provided, the type is `unknown`.
 */
type InferParamType<P> = P extends {
	readonly type: infer S extends JSONSchema;
	readonly optional: true;
}
	? FromSchema<S> | undefined
	: P extends { readonly type: infer S extends JSONSchema }
		? FromSchema<S>
		: unknown;

/**
 * Maps a tuple of `TypedHelperParam` to a tuple of inferred TypeScript types,
 * usable as the `fn` signature.
 *
 * @example
 * ```
 * type Args = InferArgs<readonly [
 *   { name: "a"; type: { type: "string" } },
 *   { name: "b"; type: { type: "number" }; optional: true },
 * ]>;
 * // => [string, number | undefined]
 * ```
 */
type InferArgs<P extends readonly TypedHelperParam[]> = {
	[K in keyof P]: InferParamType<P[K]>;
};

/**
 * Helper configuration with generic parameter inference.
 * Used exclusively by `defineHelper()`.
 */
interface TypedHelperConfig<P extends readonly TypedHelperParam[]> {
	name: string;
	description?: string;
	params: P;
	fn: (...args: InferArgs<P>) => unknown;
	returnType?: JSONSchema;
}

/**
 * Creates a `HelperConfig` with automatic type inference for `fn` arguments
 * based on the JSON Schemas declared in `params`.
 *
 * The generic parameter `const P` preserves schema literal types
 * (equivalent of `as const`), enabling `FromSchema` to resolve the
 * corresponding TypeScript types.
 *
 * @example
 * ```
 * const helper = defineHelper({
 *   name: "concat",
 *   description: "Concatenates two strings",
 *   params: [
 *     { name: "a", type: { type: "string" }, description: "First string" },
 *     { name: "b", type: { type: "string" }, description: "Second string" },
 *     { name: "sep", type: { type: "string" }, description: "Separator", optional: true },
 *   ],
 *   fn: (a, b, sep) => {
 *     // a: string, b: string, sep: string | undefined
 *     const separator = sep ?? "";
 *     return `${a}${separator}${b}`;
 *   },
 *   returnType: { type: "string" },
 * });
 * ```
 */
export function defineHelper<const P extends readonly TypedHelperParam[]>(
	config: TypedHelperConfig<P>,
): HelperConfig {
	return config as unknown as HelperConfig;
}
