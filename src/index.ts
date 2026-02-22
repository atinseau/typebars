import { analyze } from "./analyzer.ts";
import { TemplateAnalysisError } from "./errors.ts";
import { execute } from "./executor.ts";
import { parse } from "./parser.ts";
import type {
	AnalysisResult,
	JSONSchema7,
	TemplateEngineOptions,
} from "./types.ts";

// ─── TemplateEngine ──────────────────────────────────────────────────────────
// Point d'entrée public du moteur de template. Orchestre les trois phases :
//
// 1. **Parsing**   — transformation du template string en AST (via Handlebars)
// 2. **Analyse**   — validation statique + inférence du type de retour
// 3. **Exécution** — rendu du template avec des données réelles
//
// Usage :
//   const engine = new TemplateEngine();
//   const result = engine.analyze("Hello {{name}}", schema);
//   const output = engine.execute("Hello {{name}}", { name: "World" });
//
// ─── Template Identifiers ────────────────────────────────────────────────────
// La syntaxe `{{key:N}}` permet de référencer des variables provenant de
// sources de données spécifiques, identifiées par un entier N.
//
// - `identifierSchemas` : mapping `{ [id]: JSONSchema7 }` pour l'analyse statique
// - `identifierData`    : mapping `{ [id]: Record<string, unknown> }` pour l'exécution
//
// Usage :
//   engine.execute("{{meetingId:1}}", data, schema, { 1: node1Data });
//   engine.analyze("{{meetingId:1}}", schema, { 1: node1Schema });

// ─── Re-exports ──────────────────────────────────────────────────────────────
// On ré-exporte les types et fonctions utiles pour que le consommateur
// n'ait pas besoin d'importer depuis les modules internes.

export { analyze } from "./analyzer.ts";
export {
	TemplateAnalysisError,
	TemplateError,
	TemplateParseError,
	TemplateRuntimeError,
} from "./errors.ts";
export { execute } from "./executor.ts";
export type { ExpressionIdentifier, ParsedIdentifier } from "./parser.ts";
export {
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
	JSONSchema7,
	TemplateDiagnostic,
	TemplateEngineOptions,
} from "./types.ts";

// ─── Classe principale ──────────────────────────────────────────────────────

export class TemplateEngine {
	private readonly strict: boolean;

	constructor(options: TemplateEngineOptions = {}) {
		this.strict = options.strictMode ?? true;
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
		return analyze(template, inputSchema, identifierSchemas);
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
	 * @param template           - La chaîne de template
	 * @param data               - Les données de contexte pour le rendu
	 * @param inputSchema        - (optionnel) JSON Schema pour validation préalable
	 * @param identifierData     - (optionnel) Données par identifiant `{ [id]: { key: value } }`
	 * @param identifierSchemas  - (optionnel) Schemas par identifiant (pour validation statique)
	 * @returns Le résultat de l'exécution
	 *
	 * @example
	 * ```
	 * const engine = new TemplateEngine();
	 *
	 * engine.execute("{{age}}", { age: 42 });
	 * // → 42 (number)
	 *
	 * engine.execute("Hello {{name}}!", { name: "Alice" });
	 * // → "Hello Alice!" (string)
	 *
	 * // Avec identifiers
	 * engine.execute(
	 *   "{{meetingId:1}} {{meetingId:2}}",
	 *   {},
	 *   undefined,
	 *   { 1: { meetingId: "val1" }, 2: { meetingId: "val2" } }
	 * );
	 * // → "val1 val2"
	 * ```
	 */
	execute(
		template: string,
		data: Record<string, unknown>,
		inputSchema?: JSONSchema7,
		identifierData?: Record<number, Record<string, unknown>>,
		identifierSchemas?: Record<number, JSONSchema7>,
	): unknown {
		// Validation statique préalable si un schema est fourni et mode strict
		if (inputSchema && this.strict) {
			const analysis = analyze(template, inputSchema, identifierSchemas);
			if (!analysis.valid) {
				throw new TemplateAnalysisError(analysis.diagnostics);
			}
		}

		return execute(template, data, identifierData);
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
	 *          l'analyse a échoué et le mode strict est activé.
	 */
	analyzeAndExecute(
		template: string,
		inputSchema: JSONSchema7,
		data: Record<string, unknown>,
		identifierSchemas?: Record<number, JSONSchema7>,
		identifierData?: Record<number, Record<string, unknown>>,
	): { analysis: AnalysisResult; value: unknown } {
		const analysis = analyze(template, inputSchema, identifierSchemas);

		if (!analysis.valid && this.strict) {
			return { analysis, value: undefined };
		}

		const value = execute(template, data, identifierData);
		return { analysis, value };
	}
}
