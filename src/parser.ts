import Handlebars from "handlebars";
import { TemplateParseError } from "./errors.ts";

// ─── Template Parser ─────────────────────────────────────────────────────────
// Wrapper mince autour du parser Handlebars. On centralise ici l'appel au
// parser pour :
// 1. Encapsuler les erreurs dans notre hiérarchie (`TemplateParseError`)
// 2. Exposer des helpers d'introspection sur l'AST (ex: `isSingleExpression`)
// 3. Isoler la dépendance directe à Handlebars du reste du code

// ─── Regex pour détecter un littéral numérique (entier ou décimal, signé) ────
// Conservateur volontairement : pas de notation scientifique (1e5), pas de
// hex (0xFF), pas de séparateurs (1_000). On veut reconnaître uniquement ce
// qu'un humain écrirait comme valeur numérique dans un template.
const NUMERIC_LITERAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Parse un template string et retourne l'AST Handlebars.
 *
 * @param template - La chaîne de template à parser (ex: `"Hello {{name}}"`)
 * @returns L'AST racine (`hbs.AST.Program`)
 * @throws {TemplateParseError} si la syntaxe du template est invalide
 */
export function parse(template: string): hbs.AST.Program {
  try {
    return Handlebars.parse(template);
  } catch (error: unknown) {
    // Handlebars lève une Error classique avec un message descriptif.
    // On la transforme en TemplateParseError pour un traitement uniforme.
    const message = error instanceof Error ? error.message : String(error);

    // Handlebars inclut parfois la position dans le message, on tente
    // de l'extraire pour enrichir notre erreur.
    const locMatch = message.match(/line\s+(\d+).*?column\s+(\d+)/i);
    const loc = locMatch
      ? { line: parseInt(locMatch[1]!, 10), column: parseInt(locMatch[2]!, 10) }
      : undefined;

    throw new TemplateParseError(message, loc);
  }
}

/**
 * Détermine si l'AST représente un template constitué d'une seule expression
 * `{{expression}}` sans aucun contenu textuel autour.
 *
 * C'est important pour l'inférence de type de retour :
 * - Template `{{value}}`       → retourne le type brut de `value` (number, object…)
 * - Template `Hello {{name}}`  → retourne toujours `string` (concaténation)
 *
 * @param ast - L'AST parsé du template
 * @returns `true` si le template est une expression unique
 */
export function isSingleExpression(ast: hbs.AST.Program): boolean {
  const { body } = ast;

  // Exactement un nœud, et c'est un MustacheStatement (pas un block, pas du texte)
  return body.length === 1 && body[0]!.type === "MustacheStatement";
}

/**
 * Extrait les segments de chemin d'un `PathExpression` Handlebars.
 *
 * Handlebars décompose `user.address.city` en `{ parts: ["user", "address", "city"] }`.
 * Cette fonction extrait ces segments de manière sûre.
 *
 * @param expr - L'expression dont on veut le chemin
 * @returns Les segments du chemin, ou un tableau vide si l'expression n'est
 *          pas un `PathExpression`
 */
export function extractPathSegments(
  expr: hbs.AST.Expression,
): string[] {
  if (expr.type === "PathExpression") {
    return (expr as hbs.AST.PathExpression).parts;
  }
  return [];
}

/**
 * Vérifie si une expression AST est un `PathExpression` pointant vers `this`
 * (utilisé à l'intérieur des blocs `{{#each}}`).
 */
export function isThisExpression(expr: hbs.AST.Expression): boolean {
  if (expr.type !== "PathExpression") return false;
  const path = expr as hbs.AST.PathExpression;
  return path.original === "this" || path.original === ".";
}

// ─── Filtrage des nœuds significatifs ────────────────────────────────────────
// Dans un AST Handlebars, le formatage (retours à la ligne, indentation)
// produit des `ContentStatement` dont la valeur est purement du whitespace.
// Ces nœuds n'ont aucun impact sémantique et doivent être ignorés lors de
// l'inférence de type pour détecter les cas "effectivement un seul bloc" ou
// "effectivement une seule expression".

/**
 * Retourne les statements significatifs d'un Program en éliminant les
 * `ContentStatement` constitués uniquement de whitespace.
 */
export function getEffectiveBody(program: hbs.AST.Program): hbs.AST.Statement[] {
  return program.body.filter(
    (s) =>
      !(
        s.type === "ContentStatement" &&
        (s as hbs.AST.ContentStatement).value.trim() === ""
      ),
  );
}

/**
 * Détermine si un Program est effectivement constitué d'un seul
 * `BlockStatement` (en ignorant le whitespace autour).
 *
 * Exemples reconnus :
 * ```
 * {{#if x}}...{{/if}}
 *
 *   {{#each items}}...{{/each}}
 * ```
 *
 * @returns Le `BlockStatement` unique ou `null` si le programme contient
 *          d'autres nœuds significatifs.
 */
export function getEffectivelySingleBlock(
  program: hbs.AST.Program,
): hbs.AST.BlockStatement | null {
  const effective = getEffectiveBody(program);
  if (effective.length === 1 && effective[0]!.type === "BlockStatement") {
    return effective[0] as hbs.AST.BlockStatement;
  }
  return null;
}

/**
 * Détermine si un Program est effectivement constitué d'une seule
 * `MustacheStatement` (en ignorant le whitespace autour).
 *
 * Exemple : `  {{age}}  ` → true
 */
export function getEffectivelySingleExpression(
  program: hbs.AST.Program,
): hbs.AST.MustacheStatement | null {
  const effective = getEffectiveBody(program);
  if (effective.length === 1 && effective[0]!.type === "MustacheStatement") {
    return effective[0] as hbs.AST.MustacheStatement;
  }
  return null;
}

// ─── Détection de littéraux dans le contenu textuel ──────────────────────────
// Quand un programme ne contient que des ContentStatements (pas d'expressions),
// on essaie de détecter si le texte concaténé et trimé est un littéral typé
// (nombre, booléen, null). Cela permet d'inférer correctement le type de
// branches comme `{{#if x}}  42  {{/if}}`.

/**
 * Tente de détecter le type d'un littéral textuel brut.
 *
 * @param text - Le texte trimé d'un ContentStatement ou d'un groupe de ContentStatements
 * @returns Le type JSON Schema détecté, ou `null` si c'est du texte libre (string).
 */
export function detectLiteralType(text: string): "number" | "boolean" | "null" | null {
  if (NUMERIC_LITERAL_RE.test(text)) return "number";
  if (text === "true" || text === "false") return "boolean";
  if (text === "null") return "null";
  return null;
}

/**
 * Coerce une string brute issue du rendu Handlebars vers son type réel
 * si elle représente un littéral (number, boolean, null).
 * Retourne la string trimée sinon.
 */
export function coerceLiteral(raw: string): unknown {
  const trimmed = raw.trim();
  const type = detectLiteralType(trimmed);
  if (type === "number") return Number(trimmed);
  if (type === "boolean") return trimmed === "true";
  if (type === "null") return null;
  // Pas un littéral typé → on retourne la string brute sans la trimer,
  // car le whitespace peut être significatif (ex: résultat d'un #each).
  return raw;
}
