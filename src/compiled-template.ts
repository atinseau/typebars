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
// ─── État interne (TemplateState) ────────────────────────────────────────────
// Le CompiledTemplate fonctionne en 3 modes exclusifs, modélisés par un
// discriminated union `TemplateState` :
//
// - `"template"` — template Handlebars parsé (AST + source string)
// - `"literal"`  — valeur primitive passthrough (number, boolean, null)
// - `"object"`   — objet dont chaque propriété est un CompiledTemplate enfant
//
// Ce design élimine les champs optionnels et les `!` assertions en faveur
// d'un narrowing TypeScript naturel via `switch (this.state.kind)`.
//
// ─── Avantages par rapport à l'API directe ───────────────────────────────────
// - **Performance** : parsing et compilation ne sont faits qu'une seule fois
// - **API simplifiée** : pas besoin de repasser le template string à chaque appel
// - **Cohérence** : le même AST est utilisé pour l'analyse et l'exécution

// ─── Types internes ──────────────────────────────────────────────────────────

/** Options internes passées par le TemplateEngine lors de la compilation */
export interface CompiledTemplateOptions {
	/** Helpers custom enregistrés sur l'engine */
	helpers: Map<string, HelperDefinition>;
	/** Environnement Handlebars isolé (avec les helpers enregistrés) */
	hbs: typeof Handlebars;
	/** Cache de compilation partagé par l'engine */
	compilationCache: LRUCache<string, HandlebarsTemplateDelegate>;
}

/** État interne discriminé du CompiledTemplate */
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

// ─── Classe publique ─────────────────────────────────────────────────────────

export class CompiledTemplate {
	/** État interne discriminé */
	private readonly state: TemplateState;

	/** Options héritées du TemplateEngine parent */
	private readonly options: CompiledTemplateOptions;

	/** Template Handlebars compilé (lazy — créé au premier `execute()` qui en a besoin) */
	private hbsCompiled: HandlebarsTemplateDelegate | null = null;

	// ─── Accesseurs publics (backward-compatible) ────────────────────────

	/** L'AST Handlebars pré-parsé — `null` en mode littéral ou objet */
	get ast(): hbs.AST.Program | null {
		return this.state.kind === "template" ? this.state.ast : null;
	}

	/** Le template source original — string vide en mode littéral ou objet */
	get template(): string {
		return this.state.kind === "template" ? this.state.source : "";
	}

	// ─── Construction ────────────────────────────────────────────────────

	private constructor(state: TemplateState, options: CompiledTemplateOptions) {
		this.state = state;
		this.options = options;
	}

	/**
	 * Crée un CompiledTemplate pour un template Handlebars parsé.
	 *
	 * @param ast     - L'AST Handlebars pré-parsé
	 * @param source  - Le template source original
	 * @param options - Options héritées du TemplateEngine
	 */
	static fromTemplate(
		ast: hbs.AST.Program,
		source: string,
		options: CompiledTemplateOptions,
	): CompiledTemplate {
		return new CompiledTemplate({ kind: "template", ast, source }, options);
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
		return new CompiledTemplate({ kind: "literal", value }, options);
	}

	/**
	 * Crée un CompiledTemplate en mode objet, où chaque propriété est un
	 * CompiledTemplate enfant. Toutes les opérations sont déléguées
	 * récursivement aux enfants.
	 *
	 * @param children - Les templates enfants compilés `{ [key]: CompiledTemplate }`
	 * @param options  - Options héritées du TemplateEngine
	 * @returns Un CompiledTemplate qui délègue aux enfants
	 */
	static fromObject(
		children: Record<string, CompiledTemplate>,
		options: CompiledTemplateOptions,
	): CompiledTemplate {
		return new CompiledTemplate({ kind: "object", children }, options);
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
	 * Valide le template contre un schema sans retourner le type de sortie.
	 *
	 * C'est un raccourci d'API pour `analyze()` qui ne retourne que `valid`
	 * et `diagnostics`, sans `outputSchema`. L'analyse complète (y compris
	 * l'inférence de type) est exécutée en interne — cette méthode ne
	 * fournit pas de gain de performance, uniquement une API simplifiée.
	 *
	 * @param inputSchema        - JSON Schema décrivant les variables disponibles
	 * @param identifierSchemas  - (optionnel) Schemas par identifiant
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
	 * - Littéral primitif → la valeur telle quelle
	 * - Objet template → objet avec les valeurs résolues
	 *
	 * Si un `schema` est fourni dans les options, l'analyse statique est
	 * lancée avant l'exécution. Une `TemplateAnalysisError` est levée en
	 * cas d'erreur.
	 *
	 * @param data    - Les données de contexte pour le rendu
	 * @param options - Options d'exécution (schema, identifierData, etc.)
	 * @returns Le résultat de l'exécution
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
				// Validation statique préalable si un schema est fourni
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
	 *
	 * Pré-condition : cette méthode n'est appelée que depuis le mode "template".
	 */
	private getOrCompileHbs(): HandlebarsTemplateDelegate {
		if (!this.hbsCompiled) {
			// En mode "template", `this.template` retourne la source string
			this.hbsCompiled = this.options.hbs.compile(this.template, {
				noEscape: true,
				strict: false,
			});
		}
		return this.hbsCompiled;
	}
}
