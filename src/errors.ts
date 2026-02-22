import type { TemplateDiagnostic } from "./types.ts";

// ─── Classe de base ──────────────────────────────────────────────────────────
// Toutes les erreurs du moteur de template héritent de cette classe pour
// permettre un `catch` ciblé : `catch (e) { if (e instanceof TemplateError) … }`

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

// ─── Erreur de parsing ───────────────────────────────────────────────────────
// Levée quand Handlebars ne parvient pas à parser le template (syntaxe invalide).

export class TemplateParseError extends TemplateError {
  constructor(
    message: string,
    /** Position approximative de l'erreur dans le source */
    public readonly loc?: { line: number; column: number },
  ) {
    super(`Parse error: ${message}`);
    this.name = "TemplateParseError";
  }
}

// ─── Erreur d'analyse statique ───────────────────────────────────────────────
// Levée en mode strict quand l'analyse produit au moins une erreur.

export class TemplateAnalysisError extends TemplateError {
  constructor(
    /** Liste complète des diagnostics (erreurs + warnings) */
    public readonly diagnostics: TemplateDiagnostic[],
  ) {
    const errors = diagnostics.filter((d) => d.severity === "error");
    const summary = errors.map((d) => `  • ${d.message}`).join("\n");
    super(`Static analysis failed with ${errors.length} error(s):\n${summary}`);
    this.name = "TemplateAnalysisError";
  }
}

// ─── Erreur d'exécution ──────────────────────────────────────────────────────
// Levée quand l'exécution du template échoue (accès à une propriété
// inexistante en mode strict, type inattendu, etc.).

export class TemplateRuntimeError extends TemplateError {
  constructor(message: string) {
    super(`Runtime error: ${message}`);
    this.name = "TemplateRuntimeError";
  }
}
