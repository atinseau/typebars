import Handlebars from "handlebars";
import { TemplateRuntimeError } from "./errors.ts";
import {
	coerceLiteral,
	extractExpressionIdentifier,
	extractPathSegments,
	getEffectivelySingleBlock,
	getEffectivelySingleExpression,
	isSingleExpression,
	isThisExpression,
	parse,
} from "./parser.ts";

// ─── Template Executor ───────────────────────────────────────────────────────
// Exécute un template Handlebars avec des données réelles.
//
// Trois modes d'exécution :
//
// 1. **Expression unique** (`{{value}}` ou `  {{value}}  `) → retourne la
//    valeur brute sans conversion en string. Cela permet de préserver le type
//    original (number, boolean, object, array, null).
//
// 2. **Bloc unique** (`{{#if x}}10{{else}}20{{/if}}` éventuellement entouré
//    de whitespace) → rendu via Handlebars puis coercion intelligente du
//    résultat (détection de littéraux number, boolean, null).
//
// 3. **Template mixte** (`Hello {{name}}`, texte + blocs multiples, …) →
//    délègue à Handlebars qui produit toujours une string.
//
// Cette distinction est la raison pour laquelle on ne peut pas simplement
// appeler `Handlebars.compile()` dans tous les cas.
//
// ─── Template Identifiers ────────────────────────────────────────────────────
// La syntaxe `{{key:N}}` permet de résoudre une variable depuis une source
// de données spécifique, identifiée par un entier N. Le paramètre optionnel
// `identifierData` fournit un mapping `{ [id]: { key: value, ... } }`.
//
// - `{{meetingId}}`   → résolu dans `data` (comportement standard)
// - `{{meetingId:1}}` → résolu dans `identifierData[1]`
//
// Pour le rendu Handlebars (templates mixtes / blocs), les données
// identifiées sont aplaties dans l'objet de données sous la forme
// `"key:N": value`, ce qui correspond à la façon dont Handlebars parse
// naturellement `{{key:N}}` (un seul segment `"key:N"`).

// ─── API publique ────────────────────────────────────────────────────────────

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
	template: string,
	data: Record<string, unknown>,
	identifierData?: Record<number, Record<string, unknown>>,
): unknown {
	const ast = parse(template);

	// ── Cas 1 : expression unique stricte `{{expr}}` ─────────────────────
	if (isSingleExpression(ast)) {
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		return resolveExpression(stmt.path, data, identifierData);
	}

	// ── Cas 1b : expression unique avec whitespace autour `  {{expr}}  ` ──
	const singleExpr = getEffectivelySingleExpression(ast);
	if (singleExpr) {
		return resolveExpression(singleExpr.path, data, identifierData);
	}

	// ── Cas 2 : bloc unique (éventuellement entouré de whitespace) ────────
	// On rend via Handlebars puis on tente de coercer le résultat vers le
	// type littéral détecté (number, boolean, null).
	const singleBlock = getEffectivelySingleBlock(ast);
	if (singleBlock) {
		const merged = mergeDataWithIdentifiers(data, identifierData);
		const raw = renderWithHandlebars(template, merged);
		return coerceLiteral(raw);
	}

	// ── Cas 3 : template mixte → string ───────────────────────────────────
	const merged = mergeDataWithIdentifiers(data, identifierData);
	return renderWithHandlebars(template, merged);
}

// ─── Résolution directe d'expression ─────────────────────────────────────────
// Utilisé uniquement pour les templates à expression unique, afin de
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
// Pour le rendu Handlebars (templates mixtes, blocs), on ne peut pas
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
// Pour les templates mixtes (texte + expressions, blocs), on délègue à
// Handlebars qui gère nativement tous les helpers intégrés (#if, #each,
// #with, #unless) et produit une string.

/**
 * Compile et exécute un template via Handlebars.
 * Retourne toujours une string.
 *
 * @param template - La chaîne de template
 * @param data     - Les données de contexte
 */
function renderWithHandlebars(
	template: string,
	data: Record<string, unknown>,
): string {
	try {
		const compiled = Handlebars.compile(template, {
			// Désactive le HTML-escaping par défaut — ce moteur n'est pas
			// spécifique au HTML, on veut les valeurs brutes.
			noEscape: true,
			// Mode strict : lève une erreur si un chemin n'existe pas dans les données.
			strict: false,
		});

		return compiled(data);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		throw new TemplateRuntimeError(message);
	}
}
