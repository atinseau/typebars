import type Handlebars from "handlebars";
import type { JSONSchema7 } from "json-schema";
import { analyzeFromAst } from "./analyzer.ts";
import { TemplateAnalysisError } from "./errors.ts";
import { type ExecutorContext, executeFromAst } from "./executor.ts";
import type {
	AnalysisResult,
	ExecuteOptions,
	HelperDefinition,
	ValidationResult,
} from "./types.ts";
import { inferPrimitiveSchema } from "./types.ts";
import {
	aggregateObjectAnalysis,
	aggregateObjectAnalysisAndExecution,
	type LRUCache,
} from "./utils.ts";

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
// CompiledTemplate operates in 3 exclusive modes, modeled by a discriminated
// union `TemplateState`:
//
// - `"template"` — parsed Handlebars template (AST + source string)
// - `"literal"`  — primitive passthrough value (number, boolean, null)
// - `"object"`   — object where each property is a child CompiledTemplate
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

	/** The pre-parsed Handlebars AST — `null` in literal or object mode */
	get ast(): hbs.AST.Program | null {
		return this.state.kind === "template" ? this.state.ast : null;
	}

	/** The original template source — empty string in literal or object mode */
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
	 * @param inputSchema        - JSON Schema describing the available variables
	 * @param identifierSchemas  - (optional) Schemas by identifier `{ [id]: JSONSchema7 }`
	 */
	analyze(
		inputSchema: JSONSchema7,
		identifierSchemas?: Record<number, JSONSchema7>,
	): AnalysisResult {
		switch (this.state.kind) {
			case "object": {
				const { children } = this.state;
				return aggregateObjectAnalysis(Object.keys(children), (key) => {
					const child = children[key];
					if (!child) throw new Error(`unreachable: missing child "${key}"`);
					return child.analyze(inputSchema, identifierSchemas);
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
					identifierSchemas,
					helpers: this.options.helpers,
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
	 * @param inputSchema        - JSON Schema describing the available variables
	 * @param identifierSchemas  - (optional) Schemas by identifier
	 */
	validate(
		inputSchema: JSONSchema7,
		identifierSchemas?: Record<number, JSONSchema7>,
	): ValidationResult {
		const analysis = this.analyze(inputSchema, identifierSchemas);
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
	 *
	 * If a `schema` is provided in options, static analysis is performed
	 * before execution. A `TemplateAnalysisError` is thrown on errors.
	 *
	 * @param data    - The context data for rendering
	 * @param options - Execution options (schema, identifierData, etc.)
	 * @returns The execution result
	 */
	execute(data: Record<string, unknown>, options?: ExecuteOptions): unknown {
		switch (this.state.kind) {
			case "object": {
				const { children } = this.state;
				const result: Record<string, unknown> = {};
				for (const [key, child] of Object.entries(children)) {
					result[key] = child.execute(data, options);
				}
				return result;
			}

			case "literal":
				return this.state.value;

			case "template": {
				// Pre-execution static validation if a schema is provided
				if (options?.schema) {
					const analysis = this.analyze(
						options.schema,
						options.identifierSchemas,
					);
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
	 * @param inputSchema        - JSON Schema describing the available variables
	 * @param data               - The context data for rendering
	 * @param options            - Additional options
	 * @returns `{ analysis, value }`
	 */
	analyzeAndExecute(
		inputSchema: JSONSchema7,
		data: Record<string, unknown>,
		options?: {
			identifierSchemas?: Record<number, JSONSchema7>;
			identifierData?: Record<number, Record<string, unknown>>;
		},
	): { analysis: AnalysisResult; value: unknown } {
		switch (this.state.kind) {
			case "object": {
				const { children } = this.state;
				return aggregateObjectAnalysisAndExecution(
					Object.keys(children),
					// biome-ignore lint/style/noNonNullAssertion: key comes from Object.keys(children), access is guaranteed
					(key) => children[key]!.analyzeAndExecute(inputSchema, data, options),
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
				const analysis = this.analyze(inputSchema, options?.identifierSchemas);

				if (!analysis.valid) {
					return { analysis, value: undefined };
				}

				const value = executeFromAst(
					this.state.ast,
					this.state.source,
					data,
					this.buildExecutorContext({
						identifierData: options?.identifierData,
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
