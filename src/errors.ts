import type { TemplateDiagnostic } from "./types.ts";

// ─── Classe de base ──────────────────────────────────────────────────────────
// Toutes les erreurs du moteur de template héritent de cette classe pour
// permettre un `catch` ciblé : `catch (e) { if (e instanceof TemplateError) … }`

export class TemplateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TemplateError";
	}

	/**
	 * Sérialise l'erreur en un objet JSON-compatible, adapté à l'envoi
	 * vers un frontend ou un système de logging structuré.
	 */
	toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			message: this.message,
		};
	}
}

// ─── Erreur de parsing ───────────────────────────────────────────────────────
// Levée quand Handlebars ne parvient pas à parser le template (syntaxe invalide).

export class TemplateParseError extends TemplateError {
	constructor(
		message: string,
		/** Position approximative de l'erreur dans le source */
		public readonly loc?: { line: number; column: number },
		/** Fragment du template source autour de l'erreur */
		public readonly source?: string,
	) {
		super(`Parse error: ${message}`);
		this.name = "TemplateParseError";
	}

	override toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			message: this.message,
			loc: this.loc,
			source: this.source,
		};
	}
}

// ─── Erreur d'analyse statique ───────────────────────────────────────────────
// Levée en mode strict quand l'analyse produit au moins une erreur.
// Contient la liste complète des diagnostics pour inspection détaillée.

export class TemplateAnalysisError extends TemplateError {
	/** Liste complète des diagnostics (erreurs + warnings) */
	public readonly diagnostics: TemplateDiagnostic[];

	/** Uniquement les diagnostics de sévérité "error" */
	public readonly errors: TemplateDiagnostic[];

	/** Uniquement les diagnostics de sévérité "warning" */
	public readonly warnings: TemplateDiagnostic[];

	/** Nombre total d'erreurs */
	public readonly errorCount: number;

	/** Nombre total de warnings */
	public readonly warningCount: number;

	constructor(diagnostics: TemplateDiagnostic[]) {
		const errors = diagnostics.filter((d) => d.severity === "error");
		const warnings = diagnostics.filter((d) => d.severity === "warning");

		const summary = errors.map((d) => formatDiagnosticLine(d)).join("\n");
		super(`Static analysis failed with ${errors.length} error(s):\n${summary}`);

		this.name = "TemplateAnalysisError";
		this.diagnostics = diagnostics;
		this.errors = errors;
		this.warnings = warnings;
		this.errorCount = errors.length;
		this.warningCount = warnings.length;
	}

	/**
	 * Sérialise l'erreur d'analyse en un objet JSON-compatible.
	 *
	 * Conçu pour être envoyé directement à un frontend :
	 * ```
	 * res.status(400).json(error.toJSON());
	 * ```
	 *
	 * Structure retournée :
	 * ```
	 * {
	 *   name: "TemplateAnalysisError",
	 *   message: "Static analysis failed with 2 error(s): ...",
	 *   errorCount: 2,
	 *   warningCount: 0,
	 *   diagnostics: [
	 *     {
	 *       severity: "error",
	 *       code: "UNKNOWN_PROPERTY",
	 *       message: "Property \"foo\" does not exist...",
	 *       loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 7 } },
	 *       source: "{{foo}}",
	 *       details: { path: "foo", availableProperties: ["name", "age"] }
	 *     }
	 *   ]
	 * }
	 * ```
	 */
	override toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			message: this.message,
			errorCount: this.errorCount,
			warningCount: this.warningCount,
			diagnostics: this.diagnostics,
		};
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

// ─── Utilitaires internes ────────────────────────────────────────────────────

/**
 * Formate une ligne de diagnostic pour le message résumé d'une
 * `TemplateAnalysisError`.
 *
 * Produit un format lisible :
 *   `  • [UNKNOWN_PROPERTY] Property "foo" does not exist (at 1:0)`
 */
function formatDiagnosticLine(diag: TemplateDiagnostic): string {
	const parts: string[] = [`  • [${diag.code}] ${diag.message}`];

	if (diag.loc) {
		parts.push(`(at ${diag.loc.start.line}:${diag.loc.start.column})`);
	}

	return parts.join(" ");
}

// ─── Factory pour les erreurs courantes ──────────────────────────────────────
// Ces fonctions simplifient la création d'erreurs typées à travers le code.

/**
 * Crée un diagnostic structuré pour une propriété inexistante.
 * Utilisé par l'analyseur pour produire des messages d'erreur enrichis.
 */
export function createPropertyNotFoundMessage(
	path: string,
	availableProperties: string[],
): string {
	const base = `Property "${path}" does not exist in the context schema`;
	if (availableProperties.length === 0) return base;
	return `${base}. Available properties: ${availableProperties.join(", ")}`;
}

/**
 * Crée un message pour une incompatibilité de type.
 */
export function createTypeMismatchMessage(
	helperName: string,
	expected: string,
	actual: string,
): string {
	return `"{{#${helperName}}}" expects ${expected}, but resolved schema has type "${actual}"`;
}

/**
 * Crée un message pour un argument manquant sur un helper de bloc.
 */
export function createMissingArgumentMessage(helperName: string): string {
	return `"{{#${helperName}}}" requires an argument`;
}

/**
 * Crée un message pour un helper de bloc inconnu.
 */
export function createUnknownHelperMessage(helperName: string): string {
	return `Unknown block helper "{{#${helperName}}}" — cannot analyze statically`;
}

/**
 * Crée un message pour une expression non analysable.
 */
export function createUnanalyzableMessage(nodeType: string): string {
	return `Expression of type "${nodeType}" cannot be statically analyzed`;
}
