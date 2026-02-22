import Handlebars from "handlebars";
import {
  parse,
  isSingleExpression,
  extractPathSegments,
  isThisExpression,
  getEffectivelySingleBlock,
  getEffectivelySingleExpression,
  coerceLiteral,
} from "./parser.ts";
import { TemplateRuntimeError } from "./errors.ts";

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

// ─── API publique ────────────────────────────────────────────────────────────

/**
 * Exécute un template avec les données fournies et retourne le résultat.
 *
 * Le type de retour dépend de la structure du template :
 * - Expression unique `{{expr}}` → valeur brute (any)
 * - Bloc unique → valeur coercée (number, boolean, null ou string)
 * - Template mixte → `string`
 */
export function execute(template: string, data: Record<string, unknown>): unknown {
  const ast = parse(template);

  // ── Cas 1 : expression unique stricte `{{expr}}` ─────────────────────
  if (isSingleExpression(ast)) {
    const stmt = ast.body[0] as hbs.AST.MustacheStatement;
    return resolveExpression(stmt.path, data);
  }

  // ── Cas 1b : expression unique avec whitespace autour `  {{expr}}  ` ──
  const singleExpr = getEffectivelySingleExpression(ast);
  if (singleExpr) {
    return resolveExpression(singleExpr.path, data);
  }

  // ── Cas 2 : bloc unique (éventuellement entouré de whitespace) ────────
  // On rend via Handlebars puis on tente de coercer le résultat vers le
  // type littéral détecté (number, boolean, null).
  const singleBlock = getEffectivelySingleBlock(ast);
  if (singleBlock) {
    const raw = renderWithHandlebars(template, data);
    return coerceLiteral(raw);
  }

  // ── Cas 3 : template mixte → string ───────────────────────────────────
  return renderWithHandlebars(template, data);
}

// ─── Résolution directe d'expression ─────────────────────────────────────────
// Utilisé uniquement pour les templates à expression unique, afin de
// retourner la valeur brute sans passer par le moteur Handlebars.

/**
 * Résout une expression AST en suivant le chemin dans les données.
 *
 * @param expr - L'expression AST à résoudre
 * @param data - Le contexte de données courant
 * @returns La valeur brute pointée par l'expression
 */
function resolveExpression(
  expr: hbs.AST.Expression,
  data: Record<string, unknown>,
): unknown {
  // this / . → retourne le contexte entier
  if (isThisExpression(expr)) {
    return data;
  }

  // Literals
  if (expr.type === "StringLiteral") return (expr as hbs.AST.StringLiteral).value;
  if (expr.type === "NumberLiteral") return (expr as hbs.AST.NumberLiteral).value;
  if (expr.type === "BooleanLiteral") return (expr as hbs.AST.BooleanLiteral).value;
  if (expr.type === "NullLiteral") return null;
  if (expr.type === "UndefinedLiteral") return undefined;

  // PathExpression — navigation par segments dans l'objet data
  const segments = extractPathSegments(expr);
  if (segments.length === 0) {
    throw new TemplateRuntimeError(
      `Cannot resolve expression of type "${expr.type}"`,
    );
  }

  return resolveDataPath(data, segments);
}

/**
 * Navigue dans un objet de données en suivant un chemin de segments.
 *
 * @param data     - L'objet de données
 * @param segments - Les segments du chemin (ex: `["user", "address", "city"]`)
 * @returns La valeur au bout du chemin, ou `undefined` si un segment
 *          intermédiaire est null/undefined
 */
export function resolveDataPath(
  data: unknown,
  segments: string[],
): unknown {
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
