import Handlebars from "handlebars";
import type { JSONSchema7 } from "json-schema";
import type { AnalyzeOptions } from "./analyzer.ts";
import { analyzeFromAst } from "./analyzer.ts";
import {
	CompiledTemplate,
	type CompiledTemplateOptions,
} from "./compiled-template.ts";
import {
	dispatchAnalyze,
	dispatchAnalyzeAndExecute,
	dispatchExecute,
} from "./dispatch.ts";
import { TemplateAnalysisError } from "./errors.ts";
import { executeFromAst } from "./executor.ts";
import { LogicalHelpers, MapHelpers, MathHelpers } from "./helpers/index.ts";
import { parse } from "./parser.ts";
import type {
	AnalysisResult,
	AnalyzeAndExecuteOptions,
	ExecuteOptions,
	HelperDefinition,
	TemplateData,
	TemplateEngineOptions,
	TemplateInput,
	ValidationResult,
} from "./types.ts";
import { isArrayInput, isLiteralInput, isObjectInput } from "./types.ts";
import { LRUCache } from "./utils";

// ─── Typebars ────────────────────────────────────────────────────────────────
// Public entry point of the template engine. Orchestrates three phases:
//
// 1. **Parsing**   — transforms the template string into an AST (via Handlebars)
// 2. **Analysis**  — static validation + return type inference
// 3. **Execution** — renders the template with real data
//
// ─── Architecture v2 ─────────────────────────────────────────────────────────
// - **LRU cache** for parsed ASTs and compiled Handlebars templates
// - **Isolated Handlebars environment** per instance (custom helpers)
// - **`compile()` pattern**: parse-once / execute-many
// - **`validate()` method**: API shortcut without `outputSchema`
// - **`registerHelper()`**: custom helpers with static typing
// - **`ExecuteOptions`**: options object for `execute()`
//
// ─── Template Identifiers ────────────────────────────────────────────────────
// The `{{key:N}}` syntax allows referencing variables from specific data
// sources, identified by an integer N.
//
// - `identifierSchemas`: mapping `{ [id]: JSONSchema7 }` for static analysis
// - `identifierData`:    mapping `{ [id]: Record<string, unknown> }` for execution
//
// Usage:
//   engine.execute("{{meetingId:1}}", data, { identifierData: { 1: node1Data } });
//   engine.analyze("{{meetingId:1}}", schema, { identifierSchemas: { 1: node1Schema } });

// ─── Direct Execution Helper Names ───────────────────────────────────────────
// Helpers whose return values are non-primitive (arrays, objects) and must be
// wrapped when registered with Handlebars so that mixed/block templates get a
// human-readable string (e.g. `", "` joined) instead of JS default toString().
// In single-expression mode the executor bypasses Handlebars entirely, so the
// raw value is preserved.
const DIRECT_EXECUTION_HELPER_NAMES = new Set<string>([
	MapHelpers.MAP_HELPER_NAME,
]);

/**
 * Converts a value to a string suitable for embedding in a Handlebars template.
 *
 * - Arrays of primitives are joined with `", "`
 * - Arrays of objects are JSON-stringified per element, then joined
 * - Primitives use `String(value)`
 * - null/undefined become `""`
 */
function stringifyForTemplate(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (Array.isArray(value)) {
		return value
			.map((item) => {
				if (item === null || item === undefined) return "";
				if (typeof item === "object") return JSON.stringify(item);
				return String(item);
			})
			.join(", ");
	}
	return String(value);
}

// ─── Main Class ──────────────────────────────────────────────────────────────

export class Typebars {
	/** Isolated Handlebars environment — each engine has its own helpers */
	private readonly hbs: typeof Handlebars;

	/** LRU cache of parsed ASTs (avoids re-parsing) */
	private readonly astCache: LRUCache<string, hbs.AST.Program>;

	/** LRU cache of compiled Handlebars templates (avoids recompilation) */
	private readonly compilationCache: LRUCache<
		string,
		HandlebarsTemplateDelegate
	>;

	/** Custom helpers registered on this instance */
	private readonly helpers = new Map<string, HelperDefinition>();

	constructor(options: TemplateEngineOptions = {}) {
		this.hbs = Handlebars.create();
		this.astCache = new LRUCache(options.astCacheSize ?? 256);
		this.compilationCache = new LRUCache(options.compilationCacheSize ?? 256);

		// ── Built-in helpers ─────────────────────────────────────────────
		new MathHelpers().register(this);
		new LogicalHelpers().register(this);
		new MapHelpers().register(this);

		// ── Custom helpers via options ───────────────────────────────────
		if (options.helpers) {
			for (const helper of options.helpers) {
				const { name, ...definition } = helper;
				this.registerHelper(name, definition);
			}
		}
	}

	// ─── Compilation ───────────────────────────────────────────────────────

	/**
	 * Compiles a template and returns a `CompiledTemplate` ready to be
	 * executed or analyzed without re-parsing.
	 *
	 * Accepts a `TemplateInput`: string, number, boolean, null, or object.
	 * For objects, each property is compiled recursively.
	 *
	 * @param template - The template to compile
	 * @returns A reusable `CompiledTemplate`
	 */
	compile(template: TemplateInput): CompiledTemplate {
		if (isArrayInput(template)) {
			const children: CompiledTemplate[] = [];
			for (const element of template) {
				children.push(this.compile(element));
			}
			return CompiledTemplate.fromArray(children, {
				helpers: this.helpers,
				hbs: this.hbs,
				compilationCache: this.compilationCache,
			});
		}
		if (isObjectInput(template)) {
			const children: Record<string, CompiledTemplate> = {};
			for (const [key, value] of Object.entries(template)) {
				children[key] = this.compile(value);
			}
			return CompiledTemplate.fromObject(children, {
				helpers: this.helpers,
				hbs: this.hbs,
				compilationCache: this.compilationCache,
			});
		}
		if (isLiteralInput(template)) {
			return CompiledTemplate.fromLiteral(template, {
				helpers: this.helpers,
				hbs: this.hbs,
				compilationCache: this.compilationCache,
			});
		}
		const ast = this.getCachedAst(template);
		const options: CompiledTemplateOptions = {
			helpers: this.helpers,
			hbs: this.hbs,
			compilationCache: this.compilationCache,
		};
		return CompiledTemplate.fromTemplate(ast, template, options);
	}

	// ─── Static Analysis ─────────────────────────────────────────────────────

	/**
	 * Statically analyzes a template against a JSON Schema v7 describing
	 * the available context.
	 *
	 * Accepts a `TemplateInput`: string, number, boolean, null, or object.
	 * For objects, each property is analyzed recursively and the
	 * `outputSchema` reflects the object structure with resolved types.
	 *
	 * @param template    - The template to analyze
	 * @param inputSchema - JSON Schema v7 describing the available variables
	 * @param options     - (optional) Analysis options (identifierSchemas, coerceSchema)
	 */
	analyze(
		template: TemplateInput,
		inputSchema: JSONSchema7 = {},
		options?: AnalyzeOptions,
	): AnalysisResult {
		return dispatchAnalyze(
			template,
			options,
			// String handler — parse with cache and analyze the AST
			(tpl, coerceSchema) => {
				const ast = this.getCachedAst(tpl);
				return analyzeFromAst(ast, tpl, inputSchema, {
					identifierSchemas: options?.identifierSchemas,
					helpers: this.helpers,
					coerceSchema,
				});
			},
			// Recursive handler — re-enter analyze() for child elements
			(child, childOptions) => this.analyze(child, inputSchema, childOptions),
		);
	}

	// ─── Validation ──────────────────────────────────────────────────────────

	/**
	 * Validates a template against a schema without returning the output type.
	 *
	 * This is an API shortcut for `analyze()` that only returns `valid` and
	 * `diagnostics`, without `outputSchema`. The full analysis (including type
	 * inference) is executed internally — this method provides no performance
	 * gain, only a simplified API.
	 *
	 * @param template           - The template to validate
	 * @param inputSchema        - JSON Schema v7 describing the available variables
	 * @param identifierSchemas  - (optional) Schemas by identifier
	 */
	validate(
		template: TemplateInput,
		inputSchema: JSONSchema7 = {},
		options?: AnalyzeOptions,
	): ValidationResult {
		const analysis = this.analyze(template, inputSchema, options);
		return {
			valid: analysis.valid,
			diagnostics: analysis.diagnostics,
		};
	}

	// ─── Syntax Validation ───────────────────────────────────────────────────

	/**
	 * Checks only that the template syntax is valid (parsing).
	 * Does not require a schema — useful for quick feedback in an editor.
	 *
	 * For objects, recursively checks each property.
	 *
	 * @param template - The template to validate
	 * @returns `true` if the template is syntactically correct
	 */
	isValidSyntax(template: TemplateInput): boolean {
		if (isArrayInput(template)) {
			return template.every((v) => this.isValidSyntax(v));
		}
		if (isObjectInput(template)) {
			return Object.values(template).every((v) => this.isValidSyntax(v));
		}
		if (isLiteralInput(template)) return true;
		try {
			this.getCachedAst(template);
			return true;
		} catch {
			return false;
		}
	}

	// ─── Execution ───────────────────────────────────────────────────────────

	/**
	 * Executes a template with the provided data.
	 *
	 * Accepts a `TemplateInput`: string, number, boolean, null, or object.
	 * For objects, each property is executed recursively and an object with
	 * resolved values is returned.
	 *
	 * If a `schema` is provided in options, static analysis is performed
	 * before execution. A `TemplateAnalysisError` is thrown on errors.
	 *
	 * @param template - The template to execute
	 * @param data     - The context data for rendering
	 * @param options  - Execution options (schema, identifierData, identifierSchemas)
	 * @returns The execution result
	 */
	execute(
		template: TemplateInput,
		data?: TemplateData,
		options?: ExecuteOptions,
	): unknown {
		return dispatchExecute(
			template,
			options,
			// String handler — parse, optionally validate, then execute
			(tpl, coerceSchema) => {
				const ast = this.getCachedAst(tpl);

				// Pre-execution static validation if a schema is provided
				if (options?.schema) {
					const analysis = analyzeFromAst(ast, tpl, options.schema, {
						identifierSchemas: options?.identifierSchemas,
						helpers: this.helpers,
					});
					if (!analysis.valid) {
						throw new TemplateAnalysisError(analysis.diagnostics);
					}
				}

				return executeFromAst(ast, tpl, data, {
					identifierData: options?.identifierData,
					hbs: this.hbs,
					compilationCache: this.compilationCache,
					coerceSchema,
					helpers: this.helpers,
				});
			},
			// Recursive handler — re-enter execute() for child elements
			(child, childOptions) =>
				this.execute(child, data, { ...options, ...childOptions }),
		);
	}

	// ─── Combined Shortcuts ──────────────────────────────────────────────────

	/**
	 * Analyzes a template and, if valid, executes it with the provided data.
	 * Returns both the analysis result and the executed value.
	 *
	 * For objects, each property is analyzed and executed recursively.
	 * The entire object is considered invalid if at least one property is.
	 *
	 * @param template    - The template
	 * @param inputSchema - JSON Schema v7 describing the available variables
	 * @param data        - The context data for rendering
	 * @param options     - (optional) Options for template identifiers
	 * @returns An object `{ analysis, value }` where `value` is `undefined`
	 *          if analysis failed.
	 */
	analyzeAndExecute(
		template: TemplateInput,
		inputSchema: JSONSchema7 = {},
		data: TemplateData,
		options?: AnalyzeAndExecuteOptions & { coerceSchema?: JSONSchema7 },
	): { analysis: AnalysisResult; value: unknown } {
		return dispatchAnalyzeAndExecute(
			template,
			options,
			// String handler — analyze then execute if valid
			(tpl, coerceSchema) => {
				const ast = this.getCachedAst(tpl);
				const analysis = analyzeFromAst(ast, tpl, inputSchema, {
					identifierSchemas: options?.identifierSchemas,
					helpers: this.helpers,
					coerceSchema,
				});

				if (!analysis.valid) {
					return { analysis, value: undefined };
				}

				const value = executeFromAst(ast, tpl, data, {
					identifierData: options?.identifierData,
					hbs: this.hbs,
					compilationCache: this.compilationCache,
					coerceSchema,
					helpers: this.helpers,
				});
				return { analysis, value };
			},
			// Recursive handler — re-enter analyzeAndExecute() for child elements
			(child, childOptions) =>
				this.analyzeAndExecute(child, inputSchema, data, childOptions),
		);
	}

	// ─── Custom Helper Management ──────────────────────────────────────────

	/**
	 * Registers a custom helper on this engine instance.
	 *
	 * The helper is available for both execution (via Handlebars) and
	 * static analysis (via its declared `returnType`).
	 *
	 * @param name       - Helper name (e.g. `"uppercase"`)
	 * @param definition - Helper definition (implementation + return type)
	 * @returns `this` to allow chaining
	 */
	registerHelper(name: string, definition: HelperDefinition): this {
		this.helpers.set(name, definition);

		// For helpers that return non-primitive values (arrays, objects),
		// register a Handlebars-friendly wrapper that converts the result
		// to a string. In single-expression mode the executor bypasses
		// Handlebars entirely (via tryDirectHelperExecution) and returns
		// the raw value, so this wrapper only affects mixed/block templates
		// where Handlebars renders the result into a larger string.
		if (DIRECT_EXECUTION_HELPER_NAMES.has(name)) {
			this.hbs.registerHelper(name, (...args: unknown[]) => {
				// Handlebars appends an `options` object as the last argument.
				// Strip it before calling the real fn.
				const hbsArgs = args.slice(0, -1);
				const raw = definition.fn(...hbsArgs);
				return stringifyForTemplate(raw);
			});
		} else {
			this.hbs.registerHelper(name, definition.fn);
		}

		// Invalidate the compilation cache because helpers have changed
		this.compilationCache.clear();

		return this;
	}

	/**
	 * Removes a custom helper from this engine instance.
	 *
	 * @param name - Name of the helper to remove
	 * @returns `this` to allow chaining
	 */
	unregisterHelper(name: string): this {
		this.helpers.delete(name);
		this.hbs.unregisterHelper(name);

		// Invalidate the compilation cache
		this.compilationCache.clear();

		return this;
	}

	/**
	 * Checks whether a helper is registered on this instance.
	 *
	 * @param name - Helper name
	 * @returns `true` if the helper is registered
	 */
	hasHelper(name: string): boolean {
		return this.helpers.has(name);
	}

	// ─── Cache Management ──────────────────────────────────────────────────

	/**
	 * Clears all internal caches (AST + compilation).
	 *
	 * Useful after a configuration change or to free memory.
	 */
	clearCaches(): void {
		this.astCache.clear();
		this.compilationCache.clear();
	}

	// ─── Internals ─────────────────────────────────────────────────────────

	/**
	 * Retrieves the AST of a template from the cache, or parses and caches it.
	 */
	private getCachedAst(template: string): hbs.AST.Program {
		let ast = this.astCache.get(template);
		if (!ast) {
			ast = parse(template);
			this.astCache.set(template, ast);
		}
		return ast;
	}
}
