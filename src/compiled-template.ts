import type Handlebars from "handlebars";
import type { JSONSchema7 } from "json-schema";
import type { AnalyzeOptions } from "./analyzer.ts";
import { analyzeFromAst } from "./analyzer.ts";
import { TemplateAnalysisError } from "./errors.ts";
import { type ExecutorContext, executeFromAst } from "./executor.ts";
import { resolveSchemaPath } from "./schema-resolver.ts";
import type {
	AnalysisResult,
	ExecuteOptions,
	HelperDefinition,
	ValidationResult,
} from "./types.ts";
import { inferPrimitiveSchema } from "./types.ts";
import {
	aggregateArrayAnalysis,
	aggregateArrayAnalysisAndExecution,
	aggregateObjectAnalysis,
	aggregateObjectAnalysisAndExecution,
	type LRUCache,
} from "./utils";

// ─── CompiledTemplate ────────────────────────────────────────────────────────
// Pre-parsed template ready to be executed or analyzed without re-parsing.
//
// The compile-once / execute-many pattern avoids the cost of Handlebars
// parsing on every call. The AST is parsed once at compile time, and the
// Handlebars template is lazily compiled on the first `execute()`.
//
// Usage:
//   const tpl = engine.compile("Hello {{name}}");
//   tpl.execute({ name: "Alice" });   // no re-parsing
//   tpl.execute({ name: "Bob" });     // no re-parsing or recompilation
//   tpl.analyze(schema);              // no re-parsing
//
// ─── Internal State (TemplateState) ──────────────────────────────────────────
// CompiledTemplate operates in 4 exclusive modes, modeled by a discriminated
// union `TemplateState`:
//
// - `"template"` — parsed Handlebars template (AST + source string)
// - `"literal"`  — primitive passthrough value (number, boolean, null)
// - `"object"`   — object where each property is a child CompiledTemplate
// - `"array"`    — array where each element is a child CompiledTemplate
//
// This design eliminates optional fields and `!` assertions in favor of
// natural TypeScript narrowing via `switch (this.state.kind)`.
//
// ─── Advantages Over the Direct API ──────────────────────────────────────────
// - **Performance**: parsing and compilation happen only once
// - **Simplified API**: no need to re-pass the template string on each call
// - **Consistency**: the same AST is used for both analysis and execution

// ─── Internal Types ──────────────────────────────────────────────────────────

/** Internal options passed by Typebars during compilation */
export interface CompiledTemplateOptions {
	/** Custom helpers registered on the engine */
	helpers: Map<string, HelperDefinition>;
	/** Isolated Handlebars environment (with registered helpers) */
	hbs: typeof Handlebars;
	/** Compilation cache shared by the engine */
	compilationCache: LRUCache<string, HandlebarsTemplateDelegate>;
}

/** Discriminated internal state of the CompiledTemplate */
type TemplateState =
	| {
			readonly kind: "template";
			readonly ast: hbs.AST.Program;
			readonly source: string;
	  }
	| { readonly kind: "literal"; readonly value: number | boolean | null }
	| {
			readonly kind: "object";
			readonly children: Record<string, CompiledTemplate>;
	  }
	| {
			readonly kind: "array";
			readonly elements: CompiledTemplate[];
	  };

// ─── Public Class ────────────────────────────────────────────────────────────

export class CompiledTemplate {
	/** Discriminated internal state */
	private readonly state: TemplateState;

	/** Options inherited from the parent Typebars instance */
	private readonly options: CompiledTemplateOptions;

	/** Compiled Handlebars template (lazy — created on the first `execute()` that needs it) */
	private hbsCompiled: HandlebarsTemplateDelegate | null = null;

	// ─── Public Accessors (backward-compatible) ──────────────────────────

	/** The pre-parsed Handlebars AST — `null` in literal, object, or array mode */
	get ast(): hbs.AST.Program | null {
		return this.state.kind === "template" ? this.state.ast : null;
	}

	/** The original template source — empty string in literal, object, or array mode */
	get template(): string {
		return this.state.kind === "template" ? this.state.source : "";
	}

	// ─── Construction ────────────────────────────────────────────────────

	private constructor(state: TemplateState, options: CompiledTemplateOptions) {
		this.state = state;
		this.options = options;
	}

	/**
	 * Creates a CompiledTemplate for a parsed Handlebars template.
	 *
	 * @param ast     - The pre-parsed Handlebars AST
	 * @param source  - The original template source
	 * @param options - Options inherited from Typebars
	 */
	static fromTemplate(
		ast: hbs.AST.Program,
		source: string,
		options: CompiledTemplateOptions,
	): CompiledTemplate {
		return new CompiledTemplate({ kind: "template", ast, source }, options);
	}

	/**
	 * Creates a CompiledTemplate in passthrough mode for a literal value
	 * (number, boolean, null). No parsing or compilation is performed.
	 *
	 * @param value   - The primitive value
	 * @param options - Options inherited from Typebars
	 * @returns A CompiledTemplate that always returns `value`
	 */
	static fromLiteral(
		value: number | boolean | null,
		options: CompiledTemplateOptions,
	): CompiledTemplate {
		return new CompiledTemplate({ kind: "literal", value }, options);
	}

	/**
	 * Creates a CompiledTemplate in object mode, where each property is a
	 * child CompiledTemplate. All operations are recursively delegated
	 * to the children.
	 *
	 * @param children - The compiled child templates `{ [key]: CompiledTemplate }`
	 * @param options  - Options inherited from Typebars
	 * @returns A CompiledTemplate that delegates to children
	 */
	static fromObject(
		children: Record<string, CompiledTemplate>,
		options: CompiledTemplateOptions,
	): CompiledTemplate {
		return new CompiledTemplate({ kind: "object", children }, options);
	}

	/**
	 * Creates a CompiledTemplate in array mode, where each element is a
	 * child CompiledTemplate. All operations are recursively delegated
	 * to the elements.
	 *
	 * @param elements - The compiled child templates (ordered array)
	 * @param options  - Options inherited from Typebars
	 * @returns A CompiledTemplate that delegates to elements
	 */
	static fromArray(
		elements: CompiledTemplate[],
		options: CompiledTemplateOptions,
	): CompiledTemplate {
		return new CompiledTemplate({ kind: "array", elements }, options);
	}

	// ─── Static Analysis ─────────────────────────────────────────────────

	/**
	 * Statically analyzes this template against a JSON Schema v7.
	 *
	 * Returns an `AnalysisResult` containing:
	 * - `valid`        — `true` if no errors
	 * - `diagnostics`  — list of diagnostics (errors + warnings)
	 * - `outputSchema` — JSON Schema describing the return type
	 *
	 * Since the AST is pre-parsed, this method never re-parses the template.
	 *
	 * @param inputSchema - JSON Schema describing the available variables
	 * @param options     - (optional) Analysis options (identifierSchemas, coerceSchema)
	 */
	analyze(inputSchema: JSONSchema7, options?: AnalyzeOptions): AnalysisResult {
		switch (this.state.kind) {
			case "array": {
				const { elements } = this.state;
				return aggregateArrayAnalysis(elements.length, (index) => {
					const element = elements[index];
					if (!element)
						throw new Error(`unreachable: missing element at index ${index}`);
					return element.analyze(inputSchema, options);
				});
			}

			case "object": {
				const { children } = this.state;
				const coerceSchema = options?.coerceSchema;
				return aggregateObjectAnalysis(Object.keys(children), (key) => {
					const child = children[key];
					if (!child) throw new Error(`unreachable: missing child "${key}"`);
					const childCoerceSchema = coerceSchema
						? resolveSchemaPath(coerceSchema, [key])
						: undefined;
					return child.analyze(inputSchema, {
						identifierSchemas: options?.identifierSchemas,
						coerceSchema: childCoerceSchema,
					});
				});
			}

			case "literal":
				return {
					valid: true,
					diagnostics: [],
					outputSchema: inferPrimitiveSchema(this.state.value),
				};

			case "template":
				return analyzeFromAst(this.state.ast, this.state.source, inputSchema, {
					identifierSchemas: options?.identifierSchemas,
					helpers: this.options.helpers,
					coerceSchema: options?.coerceSchema,
				});
		}
	}

	// ─── Validation ──────────────────────────────────────────────────────

	/**
	 * Validates the template against a schema without returning the output type.
	 *
	 * This is an API shortcut for `analyze()` that only returns `valid` and
	 * `diagnostics`, without `outputSchema`. The full analysis (including type
	 * inference) is executed internally — this method provides no performance
	 * gain, only a simplified API.
	 *
	 * @param inputSchema - JSON Schema describing the available variables
	 * @param options     - (optional) Analysis options (identifierSchemas, coerceSchema)
	 */
	validate(
		inputSchema: JSONSchema7,
		options?: AnalyzeOptions,
	): ValidationResult {
		const analysis = this.analyze(inputSchema, options);
		return {
			valid: analysis.valid,
			diagnostics: analysis.diagnostics,
		};
	}

	// ─── Execution ───────────────────────────────────────────────────────

	/**
	 * Executes this template with the provided data.
	 *
	 * The return type depends on the template structure:
	 * - Single expression `{{expr}}` → raw value (number, boolean, object…)
	 * - Mixed template or with blocks → `string`
	 * - Primitive literal → the value as-is
	 * - Object template → object with resolved values
	 * - Array template → array with resolved values
	 *
	 * If a `schema` is provided in options, static analysis is performed
	 * before execution. A `TemplateAnalysisError` is thrown on errors.
	 *
	 * @param data    - The context data for rendering
	 * @param options - Execution options (schema, identifierData, coerceSchema, etc.)
	 * @returns The execution result
	 */
	execute(data: Record<string, unknown>, options?: ExecuteOptions): unknown {
		switch (this.state.kind) {
			case "array": {
				const { elements } = this.state;
				const result: unknown[] = [];
				for (const element of elements) {
					result.push(element.execute(data, options));
				}
				return result;
			}

			case "object": {
				const { children } = this.state;
				const coerceSchema = options?.coerceSchema;
				const result: Record<string, unknown> = {};
				for (const [key, child] of Object.entries(children)) {
					const childCoerceSchema = coerceSchema
						? resolveSchemaPath(coerceSchema, [key])
						: undefined;
					result[key] = child.execute(data, {
						...options,
						coerceSchema: childCoerceSchema,
					});
				}
				return result;
			}

			case "literal":
				return this.state.value;

			case "template": {
				// Pre-execution static validation if a schema is provided
				if (options?.schema) {
					const analysis = this.analyze(options.schema, {
						identifierSchemas: options.identifierSchemas,
						coerceSchema: options.coerceSchema,
					});
					if (!analysis.valid) {
						throw new TemplateAnalysisError(analysis.diagnostics);
					}
				}

				return executeFromAst(
					this.state.ast,
					this.state.source,
					data,
					this.buildExecutorContext(options),
				);
			}
		}
	}

	// ─── Combined Shortcuts ──────────────────────────────────────────────

	/**
	 * Analyzes and executes the template in a single call.
	 *
	 * Returns both the analysis result and the executed value.
	 * If analysis fails, `value` is `undefined`.
	 *
	 * @param inputSchema - JSON Schema describing the available variables
	 * @param data        - The context data for rendering
	 * @param options     - Additional options (identifierSchemas, identifierData, coerceSchema)
	 * @returns `{ analysis, value }`
	 */
	analyzeAndExecute(
		inputSchema: JSONSchema7,
		data: Record<string, unknown>,
		options?: {
			identifierSchemas?: Record<number, JSONSchema7>;
			identifierData?: Record<number, Record<string, unknown>>;
			coerceSchema?: JSONSchema7;
		},
	): { analysis: AnalysisResult; value: unknown } {
		switch (this.state.kind) {
			case "array": {
				const { elements } = this.state;
				return aggregateArrayAnalysisAndExecution(elements.length, (index) => {
					const element = elements[index];
					if (!element)
						throw new Error(`unreachable: missing element at index ${index}`);
					return element.analyzeAndExecute(inputSchema, data, options);
				});
			}

			case "object": {
				const { children } = this.state;
				const coerceSchema = options?.coerceSchema;
				return aggregateObjectAnalysisAndExecution(
					Object.keys(children),
					(key) => {
						const child = children[key];
						if (!child) throw new Error(`unreachable: missing child "${key}"`);
						const childCoerceSchema = coerceSchema
							? resolveSchemaPath(coerceSchema, [key])
							: undefined;
						return child.analyzeAndExecute(inputSchema, data, {
							identifierSchemas: options?.identifierSchemas,
							identifierData: options?.identifierData,
							coerceSchema: childCoerceSchema,
						});
					},
				);
			}

			case "literal":
				return {
					analysis: {
						valid: true,
						diagnostics: [],
						outputSchema: inferPrimitiveSchema(this.state.value),
					},
					value: this.state.value,
				};

			case "template": {
				const analysis = this.analyze(inputSchema, {
					identifierSchemas: options?.identifierSchemas,
					coerceSchema: options?.coerceSchema,
				});

				if (!analysis.valid) {
					return { analysis, value: undefined };
				}

				const value = executeFromAst(
					this.state.ast,
					this.state.source,
					data,
					this.buildExecutorContext({
						identifierData: options?.identifierData,
						coerceSchema: options?.coerceSchema,
					}),
				);

				return { analysis, value };
			}
		}
	}

	// ─── Internals ───────────────────────────────────────────────────────

	/**
	 * Builds the execution context for `executeFromAst`.
	 *
	 * Uses lazy Handlebars compilation: the template is only compiled
	 * on the first call that needs it (not for single expressions).
	 */
	private buildExecutorContext(options?: ExecuteOptions): ExecutorContext {
		return {
			identifierData: options?.identifierData,
			compiledTemplate: this.getOrCompileHbs(),
			hbs: this.options.hbs,
			compilationCache: this.options.compilationCache,
			coerceSchema: options?.coerceSchema,
		};
	}

	/**
	 * Lazily compiles the Handlebars template and caches it.
	 *
	 * Compilation happens only once — subsequent calls return the
	 * in-memory compiled template.
	 *
	 * Precondition: this method is only called from "template" mode.
	 */
	private getOrCompileHbs(): HandlebarsTemplateDelegate {
		if (!this.hbsCompiled) {
			// In "template" mode, `this.template` returns the source string
			this.hbsCompiled = this.options.hbs.compile(this.template, {
				noEscape: true,
				strict: false,
			});
		}
		return this.hbsCompiled;
	}
}
