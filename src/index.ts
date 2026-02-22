import Handlebars from "handlebars";
import type { JSONSchema7 } from "json-schema";
import { analyzeFromAst } from "./analyzer.ts";
import {
	CompiledTemplate,
	type CompiledTemplateOptions,
} from "./compiled-template.ts";
import { TemplateAnalysisError } from "./errors.ts";
import { executeFromAst } from "./executor.ts";
import { MathHelpers } from "./helpers/index.ts";
import { parse } from "./parser.ts";
import type {
	AnalysisResult,
	ExecuteOptions,
	HelperDefinition,
	TemplateEngineOptions,
	TemplateInput,
	ValidationResult,
} from "./types.ts";
import {
	inferPrimitiveSchema,
	isLiteralInput,
	isObjectInput,
} from "./types.ts";
import {
	aggregateObjectAnalysis,
	aggregateObjectAnalysisAndExecution,
	LRUCache,
} from "./utils.ts";

// ─── TemplateEngine ──────────────────────────────────────────────────────────
// Point d'entrée public du moteur de template. Orchestre les trois phases :
//
// 1. **Parsing**   — transformation du template string en AST (via Handlebars)
// 2. **Analyse**   — validation statique + inférence du type de retour
// 3. **Exécution** — rendu du template avec des données réelles
//
// ─── Architecture v2 ─────────────────────────────────────────────────────────
// - **Cache LRU** pour les AST parsés et les templates Handlebars compilés
// - **Environnement Handlebars isolé** par instance (custom helpers)
// - **Pattern `compile()`** : parse-once / execute-many
// - **Méthode `validate()`** : raccourci d'API sans `outputSchema`
// - **`registerHelper()`** : helpers custom avec typage statique
// - **`ExecuteOptions`** : options object pour `execute()`
//
// ─── Template Identifiers ────────────────────────────────────────────────────
// La syntaxe `{{key:N}}` permet de référencer des variables provenant de
// sources de données spécifiques, identifiées par un entier N.
//
// - `identifierSchemas` : mapping `{ [id]: JSONSchema7 }` pour l'analyse statique
// - `identifierData`    : mapping `{ [id]: Record<string, unknown> }` pour l'exécution
//
// Usage :
//   engine.execute("{{meetingId:1}}", data, { identifierData: { 1: node1Data } });
//   engine.analyze("{{meetingId:1}}", schema, { 1: node1Schema });

// ─── Re-exports ──────────────────────────────────────────────────────────────
// On ré-exporte les types et fonctions utiles pour que le consommateur
// n'ait pas besoin d'importer depuis les modules internes.

export { analyze, analyzeFromAst } from "./analyzer.ts";
export { CompiledTemplate } from "./compiled-template.ts";
export {
	createMissingArgumentMessage,
	createPropertyNotFoundMessage,
	createTypeMismatchMessage,
	createUnknownHelperMessage,
	TemplateAnalysisError,
	TemplateError,
	TemplateParseError,
	TemplateRuntimeError,
} from "./errors.ts";
export { clearCompilationCache, execute, executeFromAst } from "./executor.ts";
export { MathHelpers } from "./helpers/index.ts";
export type { ExpressionIdentifier, ParsedIdentifier } from "./parser.ts";
export {
	canUseFastPath,
	clearParseCache,
	extractExpressionIdentifier,
	parse,
	parseIdentifier,
} from "./parser.ts";
export {
	resolveArrayItems,
	resolveSchemaPath,
	simplifySchema,
} from "./schema-resolver.ts";
export type {
	AnalysisResult,
	DiagnosticCode,
	DiagnosticDetails,
	ExecuteOptions,
	HelperConfig,
	HelperDefinition,
	HelperParam,
	TemplateDiagnostic,
	TemplateEngineOptions,
	TemplateInput,
	TemplateInputObject,
	ValidationResult,
} from "./types.ts";
export {
	defineHelper,
	inferPrimitiveSchema,
	isLiteralInput,
	isObjectInput,
} from "./types.ts";
export {
	aggregateObjectAnalysis,
	aggregateObjectAnalysisAndExecution,
	deepEqual,
	LRUCache,
} from "./utils.ts";

// ─── Classe principale ──────────────────────────────────────────────────────

export class TemplateEngine {
	/** Environnement Handlebars isolé — chaque engine a ses propres helpers */
	private readonly hbs: typeof Handlebars;

	/** Cache LRU des AST parsés (évite le re-parsing) */
	private readonly astCache: LRUCache<string, hbs.AST.Program>;

	/** Cache LRU des templates Handlebars compilés (évite la recompilation) */
	private readonly compilationCache: LRUCache<
		string,
		HandlebarsTemplateDelegate
	>;

	/** Helpers custom enregistrés sur cette instance */
	private readonly helpers = new Map<string, HelperDefinition>();

	constructor(options: TemplateEngineOptions = {}) {
		this.hbs = Handlebars.create();
		this.astCache = new LRUCache(options.astCacheSize ?? 256);
		this.compilationCache = new LRUCache(options.compilationCacheSize ?? 256);

		// ── Built-in helpers (math) ──────────────────────────────────────────
		MathHelpers.register(this);

		// ── Helpers custom via options ───────────────────────────────────────
		if (options.helpers) {
			for (const helper of options.helpers) {
				const { name, ...definition } = helper;
				this.registerHelper(name, definition);
			}
		}
	}

	// ─── Compilation ───────────────────────────────────────────────────────

	/**
	 * Compile un template et retourne un `CompiledTemplate` prêt à être
	 * exécuté ou analysé sans re-parsing.
	 *
	 * Accepte un `TemplateInput` : string, number, boolean, null ou objet.
	 * Pour les objets, chaque propriété est compilée récursivement.
	 *
	 * @param template - Le template à compiler
	 * @returns Un `CompiledTemplate` réutilisable
	 */
	compile(template: TemplateInput): CompiledTemplate {
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

	// ─── Analyse statique ────────────────────────────────────────────────────

	/**
	 * Analyse statiquement un template par rapport à un JSON Schema v7
	 * décrivant le contexte disponible.
	 *
	 * Accepte un `TemplateInput` : string, number, boolean, null ou objet.
	 * Pour les objets, chaque propriété est analysée récursivement et le
	 * `outputSchema` reflète la structure de l'objet avec les types résolus.
	 *
	 * @param template           - Le template à analyser
	 * @param inputSchema        - JSON Schema v7 décrivant les variables disponibles
	 * @param identifierSchemas  - (optionnel) Schemas par identifiant `{ [id]: JSONSchema7 }`
	 */
	analyze(
		template: TemplateInput,
		inputSchema: JSONSchema7,
		identifierSchemas?: Record<number, JSONSchema7>,
	): AnalysisResult {
		if (isObjectInput(template)) {
			return aggregateObjectAnalysis(Object.keys(template), (key) =>
				this.analyze(
					template[key] as TemplateInput,
					inputSchema,
					identifierSchemas,
				),
			);
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
			identifierSchemas,
			helpers: this.helpers,
		});
	}

	// ─── Validation ──────────────────────────────────────────────────────────

	/**
	 * Valide un template contre un schema sans retourner le type de sortie.
	 *
	 * C'est un raccourci d'API pour `analyze()` qui ne retourne que `valid`
	 * et `diagnostics`, sans `outputSchema`. L'analyse complète (y compris
	 * l'inférence de type) est exécutée en interne — cette méthode ne
	 * fournit pas de gain de performance, uniquement une API simplifiée.
	 *
	 * @param template           - Le template à valider
	 * @param inputSchema        - JSON Schema v7 décrivant les variables disponibles
	 * @param identifierSchemas  - (optionnel) Schemas par identifiant
	 */
	validate(
		template: TemplateInput,
		inputSchema: JSONSchema7,
		identifierSchemas?: Record<number, JSONSchema7>,
	): ValidationResult {
		const analysis = this.analyze(template, inputSchema, identifierSchemas);
		return {
			valid: analysis.valid,
			diagnostics: analysis.diagnostics,
		};
	}

	// ─── Validation syntaxique ───────────────────────────────────────────────

	/**
	 * Vérifie uniquement que la syntaxe du template est valide (parsing).
	 * Ne nécessite pas de schema — utile pour un feedback rapide dans un éditeur.
	 *
	 * Pour les objets, vérifie récursivement chaque propriété.
	 *
	 * @param template - Le template à valider
	 * @returns `true` si le template est syntaxiquement correct
	 */
	isValidSyntax(template: TemplateInput): boolean {
		if (isObjectInput(template)) {
			return Object.values(template).every((v) => this.isValidSyntax(v));
		}
		if (isLiteralInput(template)) return true;
		try {
			parse(template);
			return true;
		} catch {
			return false;
		}
	}

	// ─── Exécution ───────────────────────────────────────────────────────────

	/**
	 * Exécute un template avec les données fournies.
	 *
	 * Accepte un `TemplateInput` : string, number, boolean, null ou objet.
	 * Pour les objets, chaque propriété est exécutée récursivement et un
	 * objet avec les valeurs résolues est retourné.
	 *
	 * Si un `schema` est fourni dans les options, l'analyse statique est
	 * lancée avant l'exécution. Une `TemplateAnalysisError` est levée en
	 * cas d'erreur.
	 *
	 * @param template - Le template à exécuter
	 * @param data     - Les données de contexte pour le rendu
	 * @param options  - Options d'exécution (schema, identifierData, identifierSchemas)
	 * @returns Le résultat de l'exécution
	 */
	execute(
		template: TemplateInput,
		data: Record<string, unknown>,
		options?: ExecuteOptions,
	): unknown {
		// ── Objet template → exécution récursive ─────────────────────────────
		if (isObjectInput(template)) {
			const result: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(template)) {
				result[key] = this.execute(value, data, options);
			}
			return result;
		}

		// ── Passthrough pour les valeurs littérales ───────────────────────────
		if (isLiteralInput(template)) return template;

		// ── Validation statique préalable ────────────────────────────────────
		if (options?.schema) {
			const ast = this.getCachedAst(template);
			const analysis = analyzeFromAst(ast, template, options.schema, {
				identifierSchemas: options.identifierSchemas,
				helpers: this.helpers,
			});
			if (!analysis.valid) {
				throw new TemplateAnalysisError(analysis.diagnostics);
			}
		}

		// ── Exécution ────────────────────────────────────────────────────────
		const ast = this.getCachedAst(template);
		return executeFromAst(ast, template, data, {
			identifierData: options?.identifierData,
			hbs: this.hbs,
			compilationCache: this.compilationCache,
		});
	}

	// ─── Raccourcis combinés ─────────────────────────────────────────────────

	/**
	 * Analyse un template et, si valide, l'exécute avec les données fournies.
	 * Retourne à la fois le résultat d'analyse et la valeur exécutée.
	 *
	 * Pour les objets, chaque propriété est analysée et exécutée récursivement.
	 * L'objet entier est considéré invalide si au moins une propriété l'est.
	 *
	 * @param template           - Le template
	 * @param inputSchema        - JSON Schema v7 décrivant les variables disponibles
	 * @param data               - Les données de contexte pour le rendu
	 * @param identifierSchemas  - (optionnel) Schemas par identifiant
	 * @param identifierData     - (optionnel) Données par identifiant
	 * @returns Un objet `{ analysis, value }` où `value` est `undefined` si
	 *          l'analyse a échoué.
	 */
	analyzeAndExecute(
		template: TemplateInput,
		inputSchema: JSONSchema7,
		data: Record<string, unknown>,
		identifierSchemas?: Record<number, JSONSchema7>,
		identifierData?: Record<number, Record<string, unknown>>,
	): { analysis: AnalysisResult; value: unknown } {
		if (isObjectInput(template)) {
			return aggregateObjectAnalysisAndExecution(Object.keys(template), (key) =>
				this.analyzeAndExecute(
					template[key] as TemplateInput,
					inputSchema,
					data,
					identifierSchemas,
					identifierData,
				),
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
			identifierSchemas,
			helpers: this.helpers,
		});

		if (!analysis.valid) {
			return { analysis, value: undefined };
		}

		const value = executeFromAst(ast, template, data, {
			identifierData,
			hbs: this.hbs,
			compilationCache: this.compilationCache,
		});
		return { analysis, value };
	}

	// ─── Gestion des helpers custom ────────────────────────────────────────

	/**
	 * Enregistre un helper custom sur cette instance du moteur.
	 *
	 * Le helper est disponible à la fois pour l'exécution (via Handlebars)
	 * et pour l'analyse statique (via son `returnType` déclaré).
	 *
	 * @param name       - Nom du helper (ex: `"uppercase"`)
	 * @param definition - Définition du helper (implémentation + type de retour)
	 * @returns `this` pour permettre le chaînage
	 */
	registerHelper(name: string, definition: HelperDefinition): this {
		this.helpers.set(name, definition);
		this.hbs.registerHelper(name, definition.fn);

		// Invalider le cache de compilation car les helpers ont changé
		this.compilationCache.clear();

		return this;
	}

	/**
	 * Supprime un helper custom de cette instance du moteur.
	 *
	 * @param name - Nom du helper à supprimer
	 * @returns `this` pour permettre le chaînage
	 */
	unregisterHelper(name: string): this {
		this.helpers.delete(name);
		this.hbs.unregisterHelper(name);

		// Invalider le cache de compilation
		this.compilationCache.clear();

		return this;
	}

	/**
	 * Vérifie si un helper est enregistré sur cette instance.
	 *
	 * @param name - Nom du helper
	 * @returns `true` si le helper est enregistré
	 */
	hasHelper(name: string): boolean {
		return this.helpers.has(name);
	}

	// ─── Gestion du cache ──────────────────────────────────────────────────

	/**
	 * Vide tous les caches internes (AST + compilation).
	 *
	 * Utile après un changement de configuration ou pour libérer la mémoire.
	 */
	clearCaches(): void {
		this.astCache.clear();
		this.compilationCache.clear();
	}

	// ─── Internals ─────────────────────────────────────────────────────────

	/**
	 * Récupère l'AST d'un template depuis le cache, ou le parse et le cache.
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
