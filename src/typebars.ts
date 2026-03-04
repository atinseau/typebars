import Handlebars from "handlebars";
import type { JSONSchema7 } from "json-schema";
import type { AnalyzeOptions } from "./analyzer.ts";
import { analyzeFromAst } from "./analyzer.ts";
import {
	CompiledTemplate,
	type CompiledTemplateOptions,
} from "./compiled-template.ts";
import { TemplateAnalysisError } from "./errors.ts";
import { executeFromAst } from "./executor.ts";
import { LogicalHelpers, MathHelpers } from "./helpers/index.ts";
import { hasHandlebarsExpression, parse } from "./parser.ts";
import { resolveSchemaPath } from "./schema-resolver.ts";
import type {
	AnalysisResult,
	AnalyzeAndExecuteOptions,
	ExecuteOptions,
	HelperDefinition,
	TemplateEngineOptions,
	TemplateInput,
	ValidationResult,
} from "./types.ts";
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
	LRUCache,
} from "./utils";

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
		if (isArrayInput(template)) {
			const exclude = options?.excludeTemplateExpression === true;
			if (exclude) {
				// When excludeTemplateExpression is enabled, filter out elements
				// that are strings containing Handlebars expressions.
				const kept = template.filter(
					(item) =>
						!(typeof item === "string" && hasHandlebarsExpression(item)),
				);
				return aggregateArrayAnalysis(kept.length, (index) =>
					this.analyze(kept[index] as TemplateInput, inputSchema, options),
				);
			}
			return aggregateArrayAnalysis(template.length, (index) =>
				this.analyze(template[index] as TemplateInput, inputSchema, options),
			);
		}
		if (isObjectInput(template)) {
			const coerceSchema = options?.coerceSchema;
			const exclude = options?.excludeTemplateExpression === true;

			// When excludeTemplateExpression is enabled, filter out keys whose
			// values contain Handlebars expressions. Only static properties
			// (literals, plain strings without `{{…}}`) are retained.
			const keys = exclude
				? Object.keys(template).filter((key) => {
						const val = template[key];
						return !(typeof val === "string" && hasHandlebarsExpression(val));
					})
				: Object.keys(template);

			return aggregateObjectAnalysis(keys, (key) => {
				// When a coerceSchema is provided, resolve the child property
				// schema from it. This allows deeply nested objects to propagate
				// coercion at every level.
				const childCoerceSchema = coerceSchema
					? resolveSchemaPath(coerceSchema, [key])
					: undefined;
				return this.analyze(template[key] as TemplateInput, inputSchema, {
					identifierSchemas: options?.identifierSchemas,
					coerceSchema: childCoerceSchema,
					excludeTemplateExpression: options?.excludeTemplateExpression,
				});
			});
		}
		if (isLiteralInput(template)) {
			return {
				valid: true,
				diagnostics: [],
				outputSchema: inferPrimitiveSchema(template),
			};
		}
		const ast = this.getCachedAst(template);
		return analyzeFromAst(ast, template, inputSchema, {
			identifierSchemas: options?.identifierSchemas,
			helpers: this.helpers,
			coerceSchema: options?.coerceSchema,
		});
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
		data: Record<string, unknown>,
		options?: ExecuteOptions,
	): unknown {
		// ── Array template → recursive execution ─────────────────────────────
		if (isArrayInput(template)) {
			const result: unknown[] = [];
			for (const element of template) {
				result.push(this.execute(element, data, options));
			}
			return result;
		}

		// ── Object template → recursive execution ────────────────────────────
		if (isObjectInput(template)) {
			const coerceSchema = options?.coerceSchema;
			const result: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(template)) {
				const childCoerceSchema = coerceSchema
					? resolveSchemaPath(coerceSchema, [key])
					: undefined;
				result[key] = this.execute(value, data, {
					...options,
					coerceSchema: childCoerceSchema,
				});
			}
			return result;
		}

		// ── Passthrough for literal values ────────────────────────────────────
		if (isLiteralInput(template)) return template;

		// ── Parse once ───────────────────────────────────────────────────────
		const ast = this.getCachedAst(template);

		// ── Pre-execution static validation ──────────────────────────────────
		if (options?.schema) {
			const analysis = analyzeFromAst(ast, template, options.schema, {
				identifierSchemas: options?.identifierSchemas,
				helpers: this.helpers,
			});
			if (!analysis.valid) {
				throw new TemplateAnalysisError(analysis.diagnostics);
			}
		}

		// ── Execution ────────────────────────────────────────────────────────
		return executeFromAst(ast, template, data, {
			identifierData: options?.identifierData,
			hbs: this.hbs,
			compilationCache: this.compilationCache,
			coerceSchema: options?.coerceSchema,
		});
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
		data: Record<string, unknown>,
		options?: AnalyzeAndExecuteOptions & { coerceSchema?: JSONSchema7 },
	): { analysis: AnalysisResult; value: unknown } {
		if (isArrayInput(template)) {
			return aggregateArrayAnalysisAndExecution(template.length, (index) =>
				this.analyzeAndExecute(
					template[index] as TemplateInput,
					inputSchema,
					data,
					options,
				),
			);
		}
		if (isObjectInput(template)) {
			const coerceSchema = options?.coerceSchema;
			return aggregateObjectAnalysisAndExecution(
				Object.keys(template),
				(key) => {
					// When a coerceSchema is provided, resolve the child property
					// schema from it for deeply nested coercion propagation.
					const childCoerceSchema = coerceSchema
						? resolveSchemaPath(coerceSchema, [key])
						: undefined;
					return this.analyzeAndExecute(
						template[key] as TemplateInput,
						inputSchema,
						data,
						{
							identifierSchemas: options?.identifierSchemas,
							identifierData: options?.identifierData,
							coerceSchema: childCoerceSchema,
						},
					);
				},
			);
		}

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

		const ast = this.getCachedAst(template);
		const analysis = analyzeFromAst(ast, template, inputSchema, {
			identifierSchemas: options?.identifierSchemas,
			helpers: this.helpers,
			coerceSchema: options?.coerceSchema,
		});

		if (!analysis.valid) {
			return { analysis, value: undefined };
		}

		const value = executeFromAst(ast, template, data, {
			identifierData: options?.identifierData,
			hbs: this.hbs,
			compilationCache: this.compilationCache,
			coerceSchema: options?.coerceSchema,
		});
		return { analysis, value };
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
		this.hbs.registerHelper(name, definition.fn);

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
