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
import type { LRUCache } from "./utils.ts";

// ─── CompiledTemplate ────────────────────────────────────────────────────────
// Template pré-parsé et prêt à être exécuté ou analysé sans re-parsing.
//
// Le pattern compile-once / execute-many évite le coût du parsing Handlebars
// à chaque appel. L'AST est parsé une seule fois lors de la compilation,
// et le template Handlebars est compilé paresseusement au premier `execute()`.
//
// Usage :
//   const tpl = engine.compile("Hello {{name}}");
//   tpl.execute({ name: "Alice" });   // pas de re-parsing
//   tpl.execute({ name: "Bob" });     // pas de re-parsing ni recompilation
//   tpl.analyze(schema);              // pas de re-parsing
//
// ─── Literal passthrough ─────────────────────────────────────────────────────
// Quand la source est une valeur primitive (number, boolean, null), le
// CompiledTemplate fonctionne en mode passthrough : pas de parsing, pas de
// compilation, la valeur est retournée telle quelle.
//
// ─── Avantages par rapport à l'API directe ───────────────────────────────────
// - **Performance** : parsing et compilation ne sont faits qu'une seule fois
// - **API simplifiée** : pas besoin de repasser le template string à chaque appel
// - **Cohérence** : le même AST est utilisé pour l'analyse et l'exécution

/** Options internes passées par le TemplateEngine lors de la compilation */
export interface CompiledTemplateOptions {
	/** Helpers custom enregistrés sur l'engine */
	helpers: Map<string, HelperDefinition>;
	/** Environnement Handlebars isolé (avec les helpers enregistrés) */
	hbs: typeof Handlebars;
	/** Cache de compilation partagé par l'engine */
	compilationCache: LRUCache<string, HandlebarsTemplateDelegate>;
}

export class CompiledTemplate {
	/** L'AST Handlebars pré-parsé — null en mode littéral */
	readonly ast: hbs.AST.Program | null;

	/** Le template source original — string vide en mode littéral */
	readonly template: string;

	/** Template Handlebars compilé (lazy — créé au premier `execute()` qui en a besoin) */
	private hbsCompiled: HandlebarsTemplateDelegate | null = null;

	/** Options héritées du TemplateEngine parent */
	private readonly options: CompiledTemplateOptions;

	/**
	 * Valeur littérale en mode passthrough (number, boolean, null).
	 * `undefined` signifie que le template est un vrai template string.
	 */
	private readonly literalValue: number | boolean | null | undefined;

	constructor(
		ast: hbs.AST.Program | null,
		template: string,
		options: CompiledTemplateOptions,
		literalValue?: number | boolean | null,
	) {
		this.ast = ast;
		this.template = template;
		this.options = options;
		this.literalValue = literalValue;
	}

	/**
	 * Crée un CompiledTemplate en mode passthrough pour une valeur littérale
	 * (number, boolean, null). Aucun parsing ni compilation n'est effectué.
	 *
	 * @param value   - La valeur primitive
	 * @param options - Options héritées du TemplateEngine
	 * @returns Un CompiledTemplate qui retourne toujours `value`
	 */
	static fromLiteral(
		value: number | boolean | null,
		options: CompiledTemplateOptions,
	): CompiledTemplate {
		return new CompiledTemplate(null, "", options, value);
	}

	/** Vérifie si ce template est en mode littéral (passthrough) */
	private isLiteral(): boolean {
		return this.literalValue !== undefined;
	}

	// ─── Analyse statique ────────────────────────────────────────────────

	/**
	 * Analyse statiquement ce template par rapport à un JSON Schema v7.
	 *
	 * Retourne un `AnalysisResult` contenant :
	 * - `valid`        — `true` si aucune erreur
	 * - `diagnostics`  — liste de diagnostics (erreurs + warnings)
	 * - `outputSchema` — JSON Schema décrivant le type de retour
	 *
	 * L'AST étant pré-parsé, cette méthode ne re-parse jamais le template.
	 *
	 * @param inputSchema        - JSON Schema décrivant les variables disponibles
	 * @param identifierSchemas  - (optionnel) Schemas par identifiant `{ [id]: JSONSchema7 }`
	 *
	 * @example
	 * ```
	 * const tpl = engine.compile("{{age}}");
	 * const result = tpl.analyze({
	 *   type: "object",
	 *   properties: { age: { type: "number" } }
	 * });
	 * // result.valid === true
	 * // result.outputSchema === { type: "number" }
	 * ```
	 */
	analyze(
		inputSchema: JSONSchema7,
		identifierSchemas?: Record<number, JSONSchema7>,
	): AnalysisResult {
		if (this.isLiteral()) {
			return {
				valid: true,
				diagnostics: [],
				outputSchema: inferPrimitiveSchema(
					this.literalValue as number | boolean | null,
				),
			};
		}
		// biome-ignore lint/style/noNonNullAssertion: ast is guaranteed non-null when not literal
		return analyzeFromAst(this.ast!, this.template, inputSchema, {
			identifierSchemas,
			helpers: this.options.helpers,
		});
	}

	// ─── Validation légère ───────────────────────────────────────────────

	/**
	 * Valide le template contre un schema sans retourner le type de sortie.
	 *
	 * C'est un raccourci pour `analyze()` qui ne retourne que `valid` et
	 * `diagnostics`, sans `outputSchema`. Utile pour un feedback rapide
	 * (ex: validation en temps réel dans un éditeur).
	 *
	 * @param inputSchema        - JSON Schema décrivant les variables disponibles
	 * @param identifierSchemas  - (optionnel) Schemas par identifiant
	 *
	 * @example
	 * ```
	 * const tpl = engine.compile("{{name}}");
	 * const { valid, diagnostics } = tpl.validate(schema);
	 * ```
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

	// ─── Exécution ───────────────────────────────────────────────────────

	/**
	 * Exécute ce template avec les données fournies.
	 *
	 * Le type de retour dépend de la structure du template :
	 * - Expression unique `{{expr}}` → valeur brute (number, boolean, object…)
	 * - Template mixte ou avec blocs → `string`
	 *
	 * Si un `schema` est fourni dans les options, l'analyse statique est
	 * lancée avant l'exécution. Une `TemplateAnalysisError` est levée en
	 * cas d'erreur.
	 *
	 * @param data    - Les données de contexte pour le rendu
	 * @param options - Options d'exécution (schema, identifierData, etc.)
	 * @returns Le résultat de l'exécution
	 *
	 * @example
	 * ```
	 * const tpl = engine.compile("Hello {{name}}!");
	 *
	 * // Exécution simple
	 * tpl.execute({ name: "Alice" });
	 * // → "Hello Alice!"
	 *
	 * // Exécution avec validation préalable
	 * tpl.execute({ name: "Alice" }, {
	 *   schema: { type: "object", properties: { name: { type: "string" } } }
	 * });
	 * ```
	 */
	execute(data: Record<string, unknown>, options?: ExecuteOptions): unknown {
		// En mode littéral, retourner la valeur telle quelle
		if (this.isLiteral()) return this.literalValue;

		// Validation statique préalable si un schema est fourni
		if (options?.schema) {
			const analysis = this.analyze(options.schema, options.identifierSchemas);
			if (!analysis.valid) {
				throw new TemplateAnalysisError(analysis.diagnostics);
			}
		}

		return executeFromAst(
			// biome-ignore lint/style/noNonNullAssertion: ast is guaranteed non-null when not literal
			this.ast!,
			this.template,
			data,
			this.buildExecutorContext(options),
		);
	}

	// ─── Raccourcis combinés ─────────────────────────────────────────────

	/**
	 * Analyse et exécute le template en un seul appel.
	 *
	 * Retourne à la fois le résultat d'analyse et la valeur exécutée.
	 * Si l'analyse échoue, `value` est `undefined`.
	 *
	 * @param inputSchema        - JSON Schema décrivant les variables disponibles
	 * @param data               - Les données de contexte pour le rendu
	 * @param options            - Options supplémentaires
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
		if (this.isLiteral()) {
			return {
				analysis: {
					valid: true,
					diagnostics: [],
					outputSchema: inferPrimitiveSchema(
						this.literalValue as number | boolean | null,
					),
				},
				value: this.literalValue,
			};
		}

		const analysis = this.analyze(inputSchema, options?.identifierSchemas);

		if (!analysis.valid) {
			return { analysis, value: undefined };
		}

		const value = executeFromAst(
			// biome-ignore lint/style/noNonNullAssertion: ast is guaranteed non-null when not literal
			this.ast!,
			this.template,
			data,
			this.buildExecutorContext({
				identifierData: options?.identifierData,
			}),
		);

		return { analysis, value };
	}

	// ─── Internals ───────────────────────────────────────────────────────

	/**
	 * Construit le contexte d'exécution pour `executeFromAst`.
	 *
	 * Utilise la compilation Handlebars lazy : le template n'est compilé
	 * qu'au premier appel qui en a besoin (pas les expressions uniques).
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
	 * Compile le template Handlebars de manière lazy et le met en cache.
	 *
	 * La compilation n'est faite qu'une seule fois — les appels suivants
	 * retournent le template compilé en mémoire.
	 */
	private getOrCompileHbs(): HandlebarsTemplateDelegate {
		if (!this.hbsCompiled) {
			this.hbsCompiled = this.options.hbs.compile(this.template, {
				noEscape: true,
				strict: false,
			});
		}
		return this.hbsCompiled;
	}
}
