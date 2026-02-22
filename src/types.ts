import type { JSONSchema7 } from "json-schema";
import type { FromSchema, JSONSchema } from "json-schema-to-ts";

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

	/**
	 * Helpers custom à enregistrer lors de la construction de l'engine.
	 *
	 * Chaque entrée décrit un helper avec son nom, son implémentation,
	 * ses paramètres attendus et son type de retour.
	 *
	 * @example
	 * ```
	 * const engine = new TemplateEngine({
	 *   helpers: [
	 *     {
	 *       name: "uppercase",
	 *       description: "Converts a string to uppercase",
	 *       fn: (value: string) => String(value).toUpperCase(),
	 *       params: [
	 *         { name: "value", type: { type: "string" }, description: "The string to convert" },
	 *       ],
	 *       returnType: { type: "string" },
	 *     },
	 *   ],
	 * });
	 * ```
	 */
	helpers?: HelperConfig[];
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

/** Décrit un paramètre attendu par un helper */
export interface HelperParam {
	/** Nom du paramètre (pour la documentation / introspection) */
	name: string;

	/**
	 * JSON Schema décrivant le type attendu pour ce paramètre.
	 * Utilisé pour la documentation et la validation statique.
	 */
	type?: JSONSchema7;

	/** Description humaine du paramètre */
	description?: string;

	/**
	 * Indique si le paramètre est optionnel.
	 * @default false
	 */
	optional?: boolean;
}

/**
 * Définition d'un helper enregistrable via `registerHelper()`.
 *
 * Contient l'implémentation runtime et les métadonnées de typage
 * pour l'analyse statique.
 */
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
	 * Paramètres attendus par le helper (pour la documentation et l'analyse).
	 *
	 * @example
	 * ```
	 * params: [
	 *   { name: "value", type: { type: "number" }, description: "The value to round" },
	 *   { name: "precision", type: { type: "number" }, description: "Decimal places", optional: true },
	 * ]
	 * ```
	 */
	params?: HelperParam[];

	/**
	 * JSON Schema décrivant le type de retour du helper pour l'analyse statique.
	 * @default { type: "string" }
	 */
	returnType?: JSONSchema7;

	/** Description humaine du helper */
	description?: string;
}

/**
 * Configuration complète d'un helper pour l'enregistrement via les options
 * du constructeur `TemplateEngine({ helpers: [...] })`.
 *
 * Étend `HelperDefinition` avec un `name` obligatoire.
 *
 * @example
 * ```
 * const config: HelperConfig = {
 *   name: "round",
 *   description: "Rounds a number to a given precision",
 *   fn: (value: number, precision?: number) => { ... },
 *   params: [
 *     { name: "value", type: { type: "number" } },
 *     { name: "precision", type: { type: "number" }, optional: true },
 *   ],
 *   returnType: { type: "number" },
 * };
 * ```
 */
export interface HelperConfig extends HelperDefinition {
	/** Nom du helper tel qu'il sera utilisé dans les templates (ex: `"uppercase"`) */
	name: string;
}

// ─── Inférence automatique des types de paramètres via json-schema-to-ts ─────
// Permet à `defineHelper()` d'inférer les types TypeScript des arguments de `fn`
// à partir des JSON Schemas déclarés dans `params`.

/**
 * Param definition utilisé pour l'inférence de type.
 * Accepte `JSONSchema` de `json-schema-to-ts` pour permettre à `FromSchema`
 * de résoudre les types littéraux.
 */
type TypedHelperParam = {
	readonly name: string;
	readonly type?: JSONSchema;
	readonly description?: string;
	readonly optional?: boolean;
};

/**
 * Infère le type TypeScript d'un seul paramètre à partir de son JSON Schema.
 * - Si `optional: true`, le type résolu est unionné avec `undefined`.
 * - Si `type` n'est pas fourni, le type est `unknown`.
 */
type InferParamType<P> = P extends {
	readonly type: infer S extends JSONSchema;
	readonly optional: true;
}
	? FromSchema<S> | undefined
	: P extends { readonly type: infer S extends JSONSchema }
		? FromSchema<S>
		: unknown;

/**
 * Mappe un tuple de `TypedHelperParam` vers un tuple de types TypeScript
 * inférés, utilisable comme signature de `fn`.
 *
 * @example
 * ```
 * type Args = InferArgs<readonly [
 *   { name: "a"; type: { type: "string" } },
 *   { name: "b"; type: { type: "number" }; optional: true },
 * ]>;
 * // => [string, number | undefined]
 * ```
 */
type InferArgs<P extends readonly TypedHelperParam[]> = {
	[K in keyof P]: InferParamType<P[K]>;
};

/**
 * Configuration d'un helper avec inférence générique sur les paramètres.
 * Utilisé exclusivement par `defineHelper()`.
 */
interface TypedHelperConfig<P extends readonly TypedHelperParam[]> {
	name: string;
	description?: string;
	params: P;
	fn: (...args: InferArgs<P>) => unknown;
	returnType?: JSONSchema;
}

/**
 * Crée un `HelperConfig` avec inférence automatique des types de `fn`
 * à partir des JSON Schemas déclarés dans `params`.
 *
 * Le paramètre générique `const P` préserve les types littéraux des schemas
 * (équivalent de `as const`), ce qui permet à `FromSchema` de résoudre
 * les types TypeScript correspondants.
 *
 * @example
 * ```
 * const helper = defineHelper({
 *   name: "concat",
 *   description: "Concatenates two strings",
 *   params: [
 *     { name: "a", type: { type: "string" }, description: "First string" },
 *     { name: "b", type: { type: "string" }, description: "Second string" },
 *     { name: "sep", type: { type: "string" }, description: "Separator", optional: true },
 *   ],
 *   fn: (a, b, sep) => {
 *     // a: string, b: string, sep: string | undefined
 *     const separator = sep ?? "";
 *     return `${a}${separator}${b}`;
 *   },
 *   returnType: { type: "string" },
 * });
 * ```
 */
export function defineHelper<const P extends readonly TypedHelperParam[]>(
	config: TypedHelperConfig<P>,
): HelperConfig {
	return config as unknown as HelperConfig;
}
