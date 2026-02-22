// ─── JSON Schema Draft v7 ────────────────────────────────────────────────────
// Subset suffisant pour notre moteur de template (on ne réinvente pas un
// validateur complet — seule la navigation structurelle nous intéresse).

export interface JSONSchema7 {
	type?: JSONSchema7Type | JSONSchema7Type[];
	properties?: Record<string, JSONSchema7>;
	items?: JSONSchema7 | JSONSchema7[];
	additionalProperties?: boolean | JSONSchema7;
	required?: string[];

	/** Combinateurs */
	oneOf?: JSONSchema7[];
	anyOf?: JSONSchema7[];
	allOf?: JSONSchema7[];

	/** Référence interne */
	$ref?: string;

	/** Définitions (pour résoudre les $ref) */
	definitions?: Record<string, JSONSchema7>;

	/** Enum */
	enum?: unknown[];
	const?: unknown;

	/** Métadonnées (non utilisées en analyse, mais conservées) */
	title?: string;
	description?: string;
	default?: unknown;
}

export type JSONSchema7Type =
	| "string"
	| "number"
	| "integer"
	| "boolean"
	| "object"
	| "array"
	| "null";

// ─── Résultat d'analyse statique ─────────────────────────────────────────────

/** Diagnostic produit par l'analyseur statique */
export interface TemplateDiagnostic {
	/** "error" bloque l'exécution, "warning" est informatif */
	severity: "error" | "warning";
	message: string;
	/** Position dans le template source (si disponible via l'AST) */
	loc?: {
		start: { line: number; column: number };
		end: { line: number; column: number };
	};
}

/** Résultat complet de l'analyse statique */
export interface AnalysisResult {
	/** true si aucune erreur (les warnings sont tolérés) */
	valid: boolean;
	/** Liste de diagnostics (erreurs + warnings) */
	diagnostics: TemplateDiagnostic[];
	/** JSON Schema décrivant le type de retour du template */
	outputSchema: JSONSchema7;
}

// ─── Options publiques du moteur ─────────────────────────────────────────────

export interface TemplateEngineOptions {
	/**
	 * Si true, l'exécution d'un template dont l'analyse produit des erreurs
	 * lèvera une exception au lieu de tenter un rendu best-effort.
	 * @default true
	 */
	strictMode?: boolean;
}
