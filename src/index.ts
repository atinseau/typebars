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
	ValidationResult,
} from "./types.ts";
import { LRUCache } from "./utils.ts";

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
// - **Méthode `validate()`** : validation légère sans inférence de type
// - **`registerHelper()`** : helpers custom avec typage statique
// - **Options object** pour `execute()` (en plus de l'API positionnelle)
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
	ValidationResult,
} from "./types.ts";
export { deepEqual, LRUCache } from "./utils.ts";

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
	 * C'est la méthode recommandée pour les templates utilisés plusieurs fois :
	 * le parsing n'est fait qu'une seule fois, et la compilation Handlebars
	 * est différée au premier `execute()` qui en a besoin.
	 *
	 * @param template - La chaîne de template (ex: `"Hello {{name}}"`)
	 * @returns Un `CompiledTemplate` réutilisable
	 *
	 * @example
	 * ```
	 * const engine = new TemplateEngine();
	 * const tpl = engine.compile("Hello {{name}}!");
	 *
	 * tpl.execute({ name: "Alice" }); // → "Hello Alice!"
	 * tpl.execute({ name: "Bob" });   // → "Hello Bob!" (pas de re-parsing)
	 *
	 * const result = tpl.analyze(schema);
	 * // result.outputSchema === { type: "string" }
	 * ```
	 */
	compile(template: string): CompiledTemplate {
		const ast = this.getCachedAst(template);
		const options: CompiledTemplateOptions = {
			helpers: this.helpers,
			hbs: this.hbs,
			compilationCache: this.compilationCache,
		};
		return new CompiledTemplate(ast, template, options);
	}

	// ─── Analyse statique ────────────────────────────────────────────────────

	/**
	 * Analyse statiquement un template par rapport à un JSON Schema v7
	 * décrivant le contexte disponible.
	 *
	 * Retourne un `AnalysisResult` contenant :
	 * - `valid`        — `true` si aucune erreur (les warnings sont tolérés)
	 * - `diagnostics`  — liste de diagnostics (erreurs + warnings)
	 * - `outputSchema` — JSON Schema v7 décrivant le type de retour du template
	 *
	 * @param template           - La chaîne de template (ex: `"Hello {{user.name}}"`)
	 * @param inputSchema        - JSON Schema v7 décrivant les variables disponibles
	 * @param identifierSchemas  - (optionnel) Schemas par identifiant `{ [id]: JSONSchema7 }`
	 *
	 * @example
	 * ```
	 * const engine = new TemplateEngine();
	 *
	 * // Sans identifiers
	 * const result = engine.analyze("{{age}}", {
	 *   type: "object",
	 *   properties: { age: { type: "number" } }
	 * });
	 *
	 * // Avec identifiers
	 * const result2 = engine.analyze("{{meetingId:1}}", schema, {
	 *   1: { type: "object", properties: { meetingId: { type: "string" } } }
	 * });
	 * ```
	 */
	analyze(
		template: string,
		inputSchema: JSONSchema7,
		identifierSchemas?: Record<number, JSONSchema7>,
	): AnalysisResult {
		const ast = this.getCachedAst(template);
		return analyzeFromAst(ast, template, inputSchema, {
			identifierSchemas,
			helpers: this.helpers,
		});
	}

	// ─── Validation légère ─────────────────────────────────────────────────

	/**
	 * Valide un template contre un schema sans calculer le type de sortie.
	 *
	 * C'est un raccourci pour `analyze()` qui ne retourne que `valid` et
	 * `diagnostics`, sans `outputSchema`. Utile pour un feedback rapide
	 * dans un éditeur ou une UI de configuration.
	 *
	 * @param template           - La chaîne de template à valider
	 * @param inputSchema        - JSON Schema v7 décrivant les variables disponibles
	 * @param identifierSchemas  - (optionnel) Schemas par identifiant
	 *
	 * @example
	 * ```
	 * const engine = new TemplateEngine();
	 * const { valid, diagnostics } = engine.validate("{{name}}", schema);
	 *
	 * if (!valid) {
	 *   // Envoyer les diagnostics au frontend
	 *   res.status(400).json({ diagnostics });
	 * }
	 * ```
	 */
	validate(
		template: string,
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
	 * @param template - La chaîne de template à valider
	 * @returns `true` si le template est syntaxiquement correct
	 */
	isValidSyntax(template: string): boolean {
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
	 * Le type de retour dépend de la structure du template :
	 * - Expression unique `{{expr}}` → valeur brute (number, boolean, object…)
	 * - Template mixte ou avec blocs → `string`
	 *
	 * En mode strict (par défaut), si un `inputSchema` est fourni, l'analyse
	 * statique est lancée avant l'exécution et une `TemplateAnalysisError` est
	 * levée en cas d'erreur.
	 *
	 * Supporte deux signatures :
	 *
	 * **Signature avec options object (recommandée)** :
	 * ```
	 * engine.execute("{{name}}", data, {
	 *   schema: mySchema,
	 *   identifierData: { 1: { meetingId: "val1" } },
	 *   identifierSchemas: { 1: meetingSchema },
	 * });
	 * ```
	 *
	 * **Signature positionnelle (backward-compatible)** :
	 * ```
	 * engine.execute("{{name}}", data, inputSchema, identifierData, identifierSchemas);
	 * ```
	 *
	 * @param template - La chaîne de template
	 * @param data     - Les données de contexte pour le rendu
	 * @param optionsOrSchema - Options object ou JSON Schema (backward-compat)
	 * @param identifierData  - (legacy) Données par identifiant
	 * @param identifierSchemas - (legacy) Schemas par identifiant
	 * @returns Le résultat de l'exécution
	 */
	execute(
		template: string,
		data: Record<string, unknown>,
		optionsOrSchema?: ExecuteOptions | JSONSchema7,
		identifierData?: Record<number, Record<string, unknown>>,
		identifierSchemas?: Record<number, JSONSchema7>,
	): unknown {
		// ── Normalisation des arguments ──────────────────────────────────────
		let schema: JSONSchema7 | undefined;
		let idData: Record<number, Record<string, unknown>> | undefined;
		let idSchemas: Record<number, JSONSchema7> | undefined;

		if (optionsOrSchema && isExecuteOptions(optionsOrSchema)) {
			// Nouvelle API avec options object
			schema = optionsOrSchema.schema;
			idData = optionsOrSchema.identifierData;
			idSchemas = optionsOrSchema.identifierSchemas;
		} else {
			// Legacy API avec paramètres positionnels
			schema = optionsOrSchema as JSONSchema7 | undefined;
			idData = identifierData;
			idSchemas = identifierSchemas;
		}

		// ── Validation statique préalable ────────────────────────────────────
		if (schema) {
			const ast = this.getCachedAst(template);
			const analysis = analyzeFromAst(ast, template, schema, {
				identifierSchemas: idSchemas,
				helpers: this.helpers,
			});
			if (!analysis.valid) {
				throw new TemplateAnalysisError(analysis.diagnostics);
			}
		}

		// ── Exécution ────────────────────────────────────────────────────────
		const ast = this.getCachedAst(template);
		return executeFromAst(ast, template, data, {
			identifierData: idData,
			hbs: this.hbs,
			compilationCache: this.compilationCache,
		});
	}

	// ─── Raccourcis combinés ─────────────────────────────────────────────────

	/**
	 * Analyse un template et, si valide, l'exécute avec les données fournies.
	 * Retourne à la fois le résultat d'analyse et la valeur exécutée.
	 *
	 * Pratique pour obtenir le type de retour ET la valeur en un seul appel.
	 *
	 * @param template           - La chaîne de template
	 * @param inputSchema        - JSON Schema v7 décrivant les variables disponibles
	 * @param data               - Les données de contexte pour le rendu
	 * @param identifierSchemas  - (optionnel) Schemas par identifiant
	 * @param identifierData     - (optionnel) Données par identifiant
	 * @returns Un objet `{ analysis, value }` où `value` est `undefined` si
	 *          l'analyse a échoué.
	 */
	analyzeAndExecute(
		template: string,
		inputSchema: JSONSchema7,
		data: Record<string, unknown>,
		identifierSchemas?: Record<number, JSONSchema7>,
		identifierData?: Record<number, Record<string, unknown>>,
	): { analysis: AnalysisResult; value: unknown } {
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
	 *
	 * @example
	 * ```
	 * const engine = new TemplateEngine();
	 *
	 * // Helper inline
	 * engine.registerHelper("uppercase", {
	 *   fn: (value: string) => String(value).toUpperCase(),
	 *   returnType: { type: "string" },
	 * });
	 *
	 * engine.execute("{{uppercase name}}", { name: "alice" });
	 * // → "ALICE"
	 * ```
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

// ─── Utilitaire ──────────────────────────────────────────────────────────────

/**
 * Détermine si un argument est un `ExecuteOptions` (nouvelle API)
 * plutôt qu'un `JSONSchema7` (ancienne API positionnelle).
 *
 * Heuristique : un `ExecuteOptions` a au moins une des clés `schema`,
 * `identifierData`, ou `identifierSchemas`. Un `JSONSchema7` n'a jamais
 * ces clés.
 */
function isExecuteOptions(
	value: ExecuteOptions | JSONSchema7,
): value is ExecuteOptions {
	return (
		"schema" in value ||
		"identifierData" in value ||
		"identifierSchemas" in value
	);
}
