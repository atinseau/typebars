// ─── JSON Schema Draft v7 ────────────────────────────────────────────────────
// Types importés depuis @types/json-schema — on ne réimplémente rien.

import type { JSONSchema7 } from "json-schema";

export type { JSONSchema7, JSONSchema7Definition } from "json-schema";

// ─── Codes de diagnostic ─────────────────────────────────────────────────────
// Codes machine-readable pour chaque type d'erreur/warning, permettant au
// frontend de réagir programmatiquement sans parser le message humain.

export type DiagnosticCode =
	/** La propriété référencée n'existe pas dans le schema contextuel */
	| "UNKNOWN_PROPERTY"
	/** Incompatibilité de type (ex: #each sur un non-tableau) */
	| "TYPE_MISMATCH"
	/** Un helper de bloc est utilisé sans argument requis */
	| "MISSING_ARGUMENT"
	/** Helper de bloc inconnu (ni built-in, ni enregistré) */
	| "UNKNOWN_HELPER"
	/** L'expression ne peut pas être analysée statiquement */
	| "UNANALYZABLE"
	/** La syntaxe {{key:N}} est utilisée mais aucun identifierSchemas fourni */
	| "MISSING_IDENTIFIER_SCHEMAS"
	/** L'identifiant N n'existe pas dans les identifierSchemas fournis */
	| "UNKNOWN_IDENTIFIER"
	/** La propriété n'existe pas dans le schema de l'identifiant */
	| "IDENTIFIER_PROPERTY_NOT_FOUND"
	/** Erreur de syntaxe dans le template */
	| "PARSE_ERROR";

// ─── Détails structurés d'un diagnostic ──────────────────────────────────────
// Informations complémentaires pour comprendre la cause exacte de l'erreur.
// Conçu pour être facilement sérialisable en JSON et exploitable par un front.

export interface DiagnosticDetails {
	/** Chemin de l'expression ayant causé l'erreur (ex: `"user.name.foo"`) */
	path?: string;
	/** Nom du helper concerné (pour les erreurs liées aux helpers) */
	helperName?: string;
	/** Ce qui était attendu (ex: `"array"`, `"property to exist"`) */
	expected?: string;
	/** Ce qui a été trouvé (ex: `"string"`, `"undefined"`) */
	actual?: string;
	/** Propriétés disponibles dans le schema courant (pour les suggestions) */
	availableProperties?: string[];
	/** Numéro de l'identifiant de template (pour les erreurs `{{key:N}}`) */
	identifier?: number;
}

// ─── Résultat d'analyse statique ─────────────────────────────────────────────

/** Diagnostic produit par l'analyseur statique */
export interface TemplateDiagnostic {
	/** "error" bloque l'exécution, "warning" est informatif */
	severity: "error" | "warning";

	/** Code machine-readable identifiant le type d'erreur */
	code: DiagnosticCode;

	/** Message humain décrivant le problème */
	message: string;

	/** Position dans le template source (si disponible via l'AST) */
	loc?: {
		start: { line: number; column: number };
		end: { line: number; column: number };
	};

	/** Fragment du template source autour de l'erreur */
	source?: string;

	/** Informations structurées pour le debugging et l'affichage frontend */
	details?: DiagnosticDetails;
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

/** Résultat de validation légère (sans inférence de type de sortie) */
export interface ValidationResult {
	/** true si aucune erreur (les warnings sont tolérés) */
	valid: boolean;
	/** Liste de diagnostics (erreurs + warnings) */
	diagnostics: TemplateDiagnostic[];
}

// ─── Options publiques du moteur ─────────────────────────────────────────────

export interface TemplateEngineOptions {
	/**
	 * Capacité du cache d'AST parsés. Chaque template parsé est mis en cache
	 * pour éviter un re-parsing coûteux lors d'appels répétés.
	 * @default 256
	 */
	astCacheSize?: number;

	/**
	 * Capacité du cache de templates Handlebars compilés.
	 * @default 256
	 */
	compilationCacheSize?: number;
}

// ─── Options d'exécution ─────────────────────────────────────────────────────
// Objet d'options optionnel pour `execute()`, remplaçant les multiples
// paramètres positionnels pour une meilleure ergonomie.

export interface ExecuteOptions {
	/** JSON Schema pour validation statique préalable */
	schema?: JSONSchema7;
	/** Données par identifiant `{ [id]: { key: value } }` */
	identifierData?: Record<number, Record<string, unknown>>;
	/** Schemas par identifiant (pour validation statique avec identifiers) */
	identifierSchemas?: Record<number, JSONSchema7>;
}

// ─── Helpers custom ──────────────────────────────────────────────────────────
// Permet d'enregistrer des helpers personnalisés avec leur signature de type
// pour l'analyse statique.

export interface HelperDefinition {
	/**
	 * Implémentation runtime du helper — sera enregistrée auprès de Handlebars.
	 *
	 * Pour un helper inline `{{uppercase name}}` :
	 *   `(value: string) => string`
	 *
	 * Pour un helper de bloc `{{#repeat count}}...{{/repeat}}` :
	 *   `function(this: any, count: number, options: Handlebars.HelperOptions) { ... }`
	 */
	// biome-ignore lint/suspicious/noExplicitAny: la signature des helpers Handlebars est dynamique par nature
	fn: (...args: any[]) => unknown;

	/**
	 * JSON Schema décrivant le type de retour du helper pour l'analyse statique.
	 * @default { type: "string" }
	 */
	returnType?: JSONSchema7;
}
