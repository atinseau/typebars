import type { JSONSchema7, AnalysisResult, TemplateEngineOptions } from "./types.ts";
import { analyze } from "./analyzer.ts";
import { execute } from "./executor.ts";
import { parse } from "./parser.ts";
import { TemplateAnalysisError } from "./errors.ts";

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

// ─── Re-exports ──────────────────────────────────────────────────────────────
// On ré-exporte les types et fonctions utiles pour que le consommateur
// n'ait pas besoin d'importer depuis les modules internes.

export { analyze } from "./analyzer.ts";
export { execute } from "./executor.ts";
export { parse } from "./parser.ts";
export { resolveSchemaPath, resolveArrayItems, simplifySchema } from "./schema-resolver.ts";
export { TemplateError, TemplateParseError, TemplateAnalysisError, TemplateRuntimeError } from "./errors.ts";
export type { JSONSchema7, AnalysisResult, TemplateDiagnostic, TemplateEngineOptions } from "./types.ts";

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
   * @param template    - La chaîne de template (ex: `"Hello {{user.name}}"`)
   * @param inputSchema - JSON Schema v7 décrivant les variables disponibles
   *
   * @example
   * ```
   * const engine = new TemplateEngine();
   * const result = engine.analyze("{{age}}", {
   *   type: "object",
   *   properties: { age: { type: "number" } }
   * });
   * // result.outputSchema → { type: "number" }
   * // result.valid → true
   * ```
   */
  analyze(template: string, inputSchema: JSONSchema7): AnalysisResult {
    return analyze(template, inputSchema);
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
   * @param template    - La chaîne de template
   * @param data        - Les données de contexte pour le rendu
   * @param inputSchema - (optionnel) JSON Schema pour validation préalable
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
   * engine.execute(
   *   "{{#if active}}Online{{else}}Offline{{/if}}",
   *   { active: true }
   * );
   * // → "Online"
   * ```
   */
  execute(
    template: string,
    data: Record<string, unknown>,
    inputSchema?: JSONSchema7,
  ): unknown {
    // Validation statique préalable si un schema est fourni et mode strict
    if (inputSchema && this.strict) {
      const analysis = analyze(template, inputSchema);
      if (!analysis.valid) {
        throw new TemplateAnalysisError(analysis.diagnostics);
      }
    }

    return execute(template, data);
  }

  // ─── Raccourcis combinés ─────────────────────────────────────────────────

  /**
   * Analyse un template et, si valide, l'exécute avec les données fournies.
   * Retourne à la fois le résultat d'analyse et la valeur exécutée.
   *
   * Pratique pour obtenir le type de retour ET la valeur en un seul appel.
   *
   * @param template    - La chaîne de template
   * @param inputSchema - JSON Schema v7 décrivant les variables disponibles
   * @param data        - Les données de contexte pour le rendu
   * @returns Un objet `{ analysis, value }` où `value` est `undefined` si
   *          l'analyse a échoué et le mode strict est activé.
   */
  analyzeAndExecute(
    template: string,
    inputSchema: JSONSchema7,
    data: Record<string, unknown>,
  ): { analysis: AnalysisResult; value: unknown } {
    const analysis = analyze(template, inputSchema);

    if (!analysis.valid && this.strict) {
      return { analysis, value: undefined };
    }

    const value = execute(template, data);
    return { analysis, value };
  }
}
