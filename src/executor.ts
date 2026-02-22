import Handlebars from "handlebars";
import { TemplateRuntimeError } from "./errors.ts";
import {
	canUseFastPath,
	coerceLiteral,
	extractExpressionIdentifier,
	extractPathSegments,
	getEffectivelySingleBlock,
	getEffectivelySingleExpression,
	isSingleExpression,
	isThisExpression,
	parse,
} from "./parser.ts";
import type { TemplateInput, TemplateInputObject } from "./types.ts";
import { isLiteralInput, isObjectInput } from "./types.ts";
import { LRUCache } from "./utils.ts";

// ─── Template Executor ───────────────────────────────────────────────────────
// Exécute un template Handlebars avec des données réelles.
//
// Quatre modes d'exécution (du plus rapide au plus général) :
//
// 1. **Expression unique** (`{{value}}` ou `  {{value}}  `) → retourne la
//    valeur brute sans conversion en string. Cela permet de préserver le type
//    original (number, boolean, object, array, null).
//
// 2. **Fast-path** (texte + expressions simples, pas de blocs ni helpers) →
//    concaténation directe sans passer par Handlebars.compile(). Jusqu'à
//    10-100x plus rapide pour les templates simples comme `Hello {{name}}`.
//
// 3. **Bloc unique** (`{{#if x}}10{{else}}20{{/if}}` éventuellement entouré
//    de whitespace) → rendu via Handlebars puis coercion intelligente du
//    résultat (détection de littéraux number, boolean, null).
//
// 4. **Template mixte** (texte + blocs multiples, helpers, …) →
//    délègue à Handlebars qui produit toujours une string.
//
// ─── Caching ─────────────────────────────────────────────────────────────────
// Les templates compilés par Handlebars sont cachés dans un LRU cache pour
// éviter la recompilation coûteuse lors d'appels répétés.
//
// Deux niveaux de cache :
// - **Cache global** (module-level) pour les fonctions standalone `execute()`
// - **Cache d'instance** pour `TemplateEngine` (passé via `ExecutorContext`)
//
// ─── Template Identifiers ────────────────────────────────────────────────────
// La syntaxe `{{key:N}}` permet de résoudre une variable depuis une source
// de données spécifique, identifiée par un entier N. Le paramètre optionnel
// `identifierData` fournit un mapping `{ [id]: { key: value, ... } }`.

// ─── Types ───────────────────────────────────────────────────────────────────

/** Contexte optionnel pour l'exécution (utilisé par TemplateEngine/CompiledTemplate) */
export interface ExecutorContext {
	/** Données par identifiant `{ [id]: { key: value } }` */
	identifierData?: Record<number, Record<string, unknown>>;
	/** Template Handlebars pré-compilé (pour CompiledTemplate) */
	compiledTemplate?: HandlebarsTemplateDelegate;
	/** Environnement Handlebars isolé (pour les helpers custom) */
	hbs?: typeof Handlebars;
	/** Cache de compilation partagé par l'engine */
	compilationCache?: LRUCache<string, HandlebarsTemplateDelegate>;
}

// ─── Cache global de compilation ─────────────────────────────────────────────
// Utilisé par la fonction standalone `execute()` et `renderWithHandlebars()`.
// Les instances de `TemplateEngine` utilisent leur propre cache.
const globalCompilationCache = new LRUCache<string, HandlebarsTemplateDelegate>(
	128,
);

// ─── API publique (backward-compatible) ──────────────────────────────────────

/**
 * Exécute un template avec les données fournies et retourne le résultat.
 *
 * Le type de retour dépend de la structure du template :
 * - Expression unique `{{expr}}` → valeur brute (any)
 * - Bloc unique → valeur coercée (number, boolean, null ou string)
 * - Template mixte → `string`
 *
 * @param template       - La chaîne de template
 * @param data           - Les données de contexte principal
 * @param identifierData - (optionnel) Données par identifiant `{ [id]: { key: value } }`
 */
export function execute(
	template: TemplateInput,
	data: Record<string, unknown>,
	identifierData?: Record<number, Record<string, unknown>>,
): unknown {
	if (isObjectInput(template)) {
		return executeObjectTemplate(template, data, identifierData);
	}
	if (isLiteralInput(template)) return template;
	const ast = parse(template);
	return executeFromAst(ast, template, data, { identifierData });
}

/**
 * Exécute un objet template récursivement (version standalone).
 * Chaque propriété est exécutée individuellement et le résultat est un objet
 * avec la même structure mais les valeurs résolues.
 */
function executeObjectTemplate(
	template: TemplateInputObject,
	data: Record<string, unknown>,
	identifierData?: Record<number, Record<string, unknown>>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(template)) {
		result[key] = execute(value, data, identifierData);
	}
	return result;
}

// ─── API interne (pour TemplateEngine / CompiledTemplate) ────────────────────

/**
 * Exécute un template à partir d'un AST déjà parsé.
 *
 * Cette fonction est le cœur de l'exécution. Elle est utilisée par :
 * - `execute()` (wrapper backward-compatible)
 * - `CompiledTemplate.execute()` (avec AST pré-parsé et cache)
 * - `TemplateEngine.execute()` (avec cache et helpers)
 *
 * @param ast       - L'AST Handlebars déjà parsé
 * @param template  - Le template source (pour la compilation Handlebars si nécessaire)
 * @param data      - Les données de contexte principal
 * @param ctx       - Contexte d'exécution optionnel
 */
export function executeFromAst(
	ast: hbs.AST.Program,
	template: string,
	data: Record<string, unknown>,
	ctx?: ExecutorContext,
): unknown {
	const identifierData = ctx?.identifierData;

	// ── Cas 1 : expression unique stricte `{{expr}}` ─────────────────────
	// On exclut les helper calls (params > 0 ou hash) car ils doivent
	// passer par Handlebars pour être exécutés correctement.
	if (isSingleExpression(ast)) {
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		if (stmt.params.length === 0 && !stmt.hash) {
			return resolveExpression(stmt.path, data, identifierData);
		}
	}

	// ── Cas 1b : expression unique avec whitespace autour `  {{expr}}  ` ──
	const singleExpr = getEffectivelySingleExpression(ast);
	if (singleExpr && singleExpr.params.length === 0 && !singleExpr.hash) {
		return resolveExpression(singleExpr.path, data, identifierData);
	}

	// ── Cas 1c : expression unique avec helper (params > 0) ──────────────
	// Ex: `{{ divide accountIds.length 10 }}` ou `{{ math a "+" b }}`
	// Le helper retourne une valeur typée mais Handlebars la convertit en
	// string. On rend via Handlebars puis on coerce le résultat pour
	// retrouver le type original (number, boolean, null).
	if (singleExpr && (singleExpr.params.length > 0 || singleExpr.hash)) {
		const merged = mergeDataWithIdentifiers(data, identifierData);
		const raw = renderWithHandlebars(template, merged, ctx);
		return coerceLiteral(raw);
	}

	// ── Cas 2 : fast-path pour templates simples (texte + expressions) ────
	// Si le template ne contient que du texte et des expressions simples
	// (pas de blocs, pas de helpers avec paramètres), on peut faire une
	// concaténation directe sans passer par Handlebars.compile().
	if (canUseFastPath(ast) && ast.body.length > 1) {
		return executeFastPath(ast, data, identifierData);
	}

	// ── Cas 3 : bloc unique (éventuellement entouré de whitespace) ────────
	// On rend via Handlebars puis on tente de coercer le résultat vers le
	// type littéral détecté (number, boolean, null).
	const singleBlock = getEffectivelySingleBlock(ast);
	if (singleBlock) {
		const merged = mergeDataWithIdentifiers(data, identifierData);
		const raw = renderWithHandlebars(template, merged, ctx);
		return coerceLiteral(raw);
	}

	// ── Cas 4 : template mixte → string ───────────────────────────────────
	const merged = mergeDataWithIdentifiers(data, identifierData);
	return renderWithHandlebars(template, merged, ctx);
}

// ─── Fast-path execution ─────────────────────────────────────────────────────
// Pour les templates constitués uniquement de texte et d'expressions simples
// (pas de blocs, pas de helpers), on court-circuite Handlebars et on fait
// une concaténation directe. C'est significativement plus rapide.

/**
 * Exécute un template via le fast-path (concaténation directe).
 *
 * Pré-condition : `canUseFastPath(ast)` doit retourner `true`.
 *
 * @param ast            - L'AST du template (que ContentStatement et MustacheStatement simples)
 * @param data           - Les données de contexte
 * @param identifierData - Données par identifiant (optionnel)
 * @returns La string résultante
 */
function executeFastPath(
	ast: hbs.AST.Program,
	data: Record<string, unknown>,
	identifierData?: Record<number, Record<string, unknown>>,
): string {
	let result = "";

	for (const stmt of ast.body) {
		if (stmt.type === "ContentStatement") {
			result += (stmt as hbs.AST.ContentStatement).value;
		} else if (stmt.type === "MustacheStatement") {
			const value = resolveExpression(
				(stmt as hbs.AST.MustacheStatement).path,
				data,
				identifierData,
			);
			// Handlebars convertit les valeurs en string pour le rendu.
			// On reproduit ce comportement : null/undefined → "", sinon String(value).
			if (value != null) {
				result += String(value);
			}
		}
	}

	return result;
}

// ─── Résolution directe d'expression ─────────────────────────────────────────
// Utilisé pour les templates à expression unique et le fast-path, afin de
// retourner la valeur brute sans passer par le moteur Handlebars.

/**
 * Résout une expression AST en suivant le chemin dans les données.
 *
 * Si l'expression contient un identifiant (ex: `meetingId:1`), la résolution
 * se fait dans `identifierData[1]` au lieu de `data`.
 *
 * @param expr           - L'expression AST à résoudre
 * @param data           - Le contexte de données principal
 * @param identifierData - Données par identifiant (optionnel)
 * @returns La valeur brute pointée par l'expression
 */
function resolveExpression(
	expr: hbs.AST.Expression,
	data: Record<string, unknown>,
	identifierData?: Record<number, Record<string, unknown>>,
): unknown {
	// this / . → retourne le contexte entier
	if (isThisExpression(expr)) {
		return data;
	}

	// Literals
	if (expr.type === "StringLiteral")
		return (expr as hbs.AST.StringLiteral).value;
	if (expr.type === "NumberLiteral")
		return (expr as hbs.AST.NumberLiteral).value;
	if (expr.type === "BooleanLiteral")
		return (expr as hbs.AST.BooleanLiteral).value;
	if (expr.type === "NullLiteral") return null;
	if (expr.type === "UndefinedLiteral") return undefined;

	// PathExpression — navigation par segments dans l'objet data
	const segments = extractPathSegments(expr);
	if (segments.length === 0) {
		throw new TemplateRuntimeError(
			`Cannot resolve expression of type "${expr.type}"`,
		);
	}

	// Extraire l'identifiant éventuel du dernier segment
	const { cleanSegments, identifier } = extractExpressionIdentifier(segments);

	if (identifier !== null && identifierData) {
		const source = identifierData[identifier];
		if (source) {
			return resolveDataPath(source, cleanSegments);
		}
		// La source n'existe pas → undefined (comme une clé manquante)
		return undefined;
	}

	if (identifier !== null && !identifierData) {
		// Template utilise un identifiant mais aucune identifierData fournie
		return undefined;
	}

	return resolveDataPath(data, cleanSegments);
}

/**
 * Navigue dans un objet de données en suivant un chemin de segments.
 *
 * @param data     - L'objet de données
 * @param segments - Les segments du chemin (ex: `["user", "address", "city"]`)
 * @returns La valeur au bout du chemin, ou `undefined` si un segment
 *          intermédiaire est null/undefined
 */
export function resolveDataPath(data: unknown, segments: string[]): unknown {
	let current: unknown = data;

	for (const segment of segments) {
		if (current === null || current === undefined) {
			return undefined;
		}

		if (typeof current !== "object") {
			return undefined;
		}

		current = (current as Record<string, unknown>)[segment];
	}

	return current;
}

// ─── Fusion des données ──────────────────────────────────────────────────────
// Pour le rendu Handlebars (templates mixtes / blocs), on ne peut pas
// intercepter la résolution expression par expression. On fusionne donc
// les données identifiées dans l'objet principal sous la forme `"key:N"`.
//
// Handlebars parse `{{meetingId:1}}` comme un PathExpression avec un seul
// segment `"meetingId:1"`, donc il cherchera la clé `"meetingId:1"` dans
// l'objet de données — ce qui correspond exactement à notre format aplati.

/**
 * Fusionne les données principales avec les données identifiées.
 *
 * @param data           - Données principales
 * @param identifierData - Données par identifiant
 * @returns Un objet fusionné où les données identifiées sont sous la forme `"key:N"`
 *
 * @example
 * ```
 * mergeDataWithIdentifiers(
 *   { name: "Alice" },
 *   { 1: { meetingId: "val1" }, 2: { meetingId: "val2" } }
 * )
 * // → { name: "Alice", "meetingId:1": "val1", "meetingId:2": "val2" }
 * ```
 */
function mergeDataWithIdentifiers(
	data: Record<string, unknown>,
	identifierData?: Record<number, Record<string, unknown>>,
): Record<string, unknown> {
	if (!identifierData) return data;

	const merged: Record<string, unknown> = { ...data };

	for (const [id, idData] of Object.entries(identifierData)) {
		for (const [key, value] of Object.entries(idData)) {
			merged[`${key}:${id}`] = value;
		}
	}

	return merged;
}

// ─── Rendu Handlebars ────────────────────────────────────────────────────────
// Pour les templates complexes (blocs, helpers), on délègue à Handlebars.
// La compilation est cachée pour éviter les recompilations coûteuses.

/**
 * Compile et exécute un template via Handlebars.
 *
 * Utilise un cache de compilation (LRU) pour éviter de recompiler le même
 * template lors d'appels répétés. Le cache est soit :
 * - Le cache global (pour la fonction standalone `execute()`)
 * - Le cache d'instance fourni via `ExecutorContext` (pour `TemplateEngine`)
 *
 * @param template - La chaîne de template
 * @param data     - Les données de contexte
 * @param ctx      - Contexte d'exécution optionnel (cache, env Handlebars)
 * @returns Toujours une string
 */
function renderWithHandlebars(
	template: string,
	data: Record<string, unknown>,
	ctx?: ExecutorContext,
): string {
	try {
		// 1. Utiliser le template pré-compilé si disponible (CompiledTemplate)
		if (ctx?.compiledTemplate) {
			return ctx.compiledTemplate(data);
		}

		// 2. Chercher dans le cache (instance ou global)
		const cache = ctx?.compilationCache ?? globalCompilationCache;
		const hbs = ctx?.hbs ?? Handlebars;

		let compiled = cache.get(template);
		if (!compiled) {
			compiled = hbs.compile(template, {
				// Désactive le HTML-escaping par défaut — ce moteur n'est pas
				// spécifique au HTML, on veut les valeurs brutes.
				noEscape: true,
				// Mode strict : lève une erreur si un chemin n'existe pas dans les données.
				strict: false,
			});
			cache.set(template, compiled);
		}

		return compiled(data);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		throw new TemplateRuntimeError(message);
	}
}

/**
 * Vide le cache global de compilation Handlebars.
 * Utile pour les tests ou pour libérer la mémoire.
 */
export function clearCompilationCache(): void {
	globalCompilationCache.clear();
}
