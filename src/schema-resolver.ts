import type { JSONSchema7 } from "./types.ts";

// ─── JSON Schema Resolver ────────────────────────────────────────────────────
// Utilitaire pour naviguer dans un JSON Schema Draft v7 en suivant un chemin
// de propriétés (ex: ["user", "address", "city"]).
//
// Gère :
// - La résolution de `$ref` (références internes #/definitions/...)
// - La navigation dans `properties`
// - La navigation dans `items` (éléments d'un tableau)
// - Les combinateurs `allOf`, `anyOf`, `oneOf` (recherche dans chaque branche)
// - `additionalProperties` quand la propriété n'est pas déclarée

// ─── Résolution de $ref ──────────────────────────────────────────────────────
// Supporte uniquement les références internes au format `#/definitions/Foo`
// ou `#/$defs/Foo` (JSON Schema Draft 2019+). Les $ref distantes (URL) ne
// sont pas prises en charge — ce n'est pas le rôle d'un moteur de template.

/**
 * Résout récursivement les `$ref` d'un schema en utilisant le schema racine
 * comme source de définitions.
 */
export function resolveRef(
  schema: JSONSchema7,
  root: JSONSchema7,
): JSONSchema7 {
  if (!schema.$ref) return schema;

  const ref = schema.$ref;

  // Format attendu : #/definitions/Name ou #/$defs/Name
  const match = ref.match(/^#\/(definitions|\$defs)\/(.+)$/);
  if (!match) {
    throw new Error(`Unsupported $ref format: "${ref}". Only internal #/definitions/ references are supported.`);
  }

  const defsKey = match[1] as "definitions" | "$defs";
  const name = match[2]!;

  const defs = defsKey === "definitions"
    ? root.definitions
    : (root as Record<string, unknown>)["$defs"] as Record<string, JSONSchema7> | undefined;

  if (!defs || !(name in defs)) {
    throw new Error(`Cannot resolve $ref "${ref}": definition "${name}" not found.`);
  }

  // Résolution récursive au cas où la définition elle-même contient un $ref
  return resolveRef(defs[name]!, root);
}

// ─── Navigation par segment de chemin ────────────────────────────────────────

/**
 * Résout un seul segment de chemin (un nom de propriété) dans un schema.
 * Retourne le sous-schema correspondant ou `undefined` si le chemin est invalide.
 *
 * @param schema  - Le schema courant (déjà résolu, sans $ref)
 * @param segment - Le nom de la propriété à résoudre
 * @param root    - Le schema racine (pour résoudre d'éventuels $ref internes)
 */
function resolveSegment(
  schema: JSONSchema7,
  segment: string,
  root: JSONSchema7,
): JSONSchema7 | undefined {
  const resolved = resolveRef(schema, root);

  // 1. Propriétés explicites
  if (resolved.properties && segment in resolved.properties) {
    return resolveRef(resolved.properties[segment]!, root);
  }

  // 2. additionalProperties (quand la propriété n'est pas déclarée)
  if (resolved.additionalProperties !== undefined && resolved.additionalProperties !== false) {
    if (resolved.additionalProperties === true) {
      // additionalProperties: true → on ne sait rien du type
      return {};
    }
    return resolveRef(resolved.additionalProperties, root);
  }

  // 3. Combinateurs — on cherche dans chaque branche
  const combinatorResult = resolveInCombinators(resolved, segment, root);
  if (combinatorResult) return combinatorResult;

  return undefined;
}

/**
 * Cherche un segment dans les branches `allOf`, `anyOf`, `oneOf`.
 * Retourne le premier sous-schema trouvé ou `undefined`.
 * Pour `allOf`, on fusionne les résultats trouvés en un `allOf`.
 */
function resolveInCombinators(
  schema: JSONSchema7,
  segment: string,
  root: JSONSchema7,
): JSONSchema7 | undefined {
  // allOf : la propriété peut être définie dans n'importe quelle branche,
  // et toutes les contraintes s'appliquent simultanément.
  if (schema.allOf) {
    const matches = schema.allOf
      .map((branch) => resolveSegment(branch, segment, root))
      .filter((s): s is JSONSchema7 => s !== undefined);

    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) return { allOf: matches };
  }

  // anyOf / oneOf : la propriété peut venir de n'importe quelle branche.
  for (const key of ["anyOf", "oneOf"] as const) {
    if (!schema[key]) continue;
    const matches = schema[key]
      .map((branch) => resolveSegment(branch, segment, root))
      .filter((s): s is JSONSchema7 => s !== undefined);

    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) return { [key]: matches };
  }

  return undefined;
}

// ─── API publique ────────────────────────────────────────────────────────────

/**
 * Résout un chemin complet (ex: ["user", "address", "city"]) dans un JSON
 * Schema et retourne le sous-schema correspondant.
 *
 * @param schema - Le schema racine décrivant le contexte du template
 * @param path   - Tableau de segments (noms de propriétés)
 * @returns Le sous-schema au bout du chemin, ou `undefined` si le chemin
 *          ne peut pas être résolu.
 *
 * @example
 * ```
 * const schema = {
 *   type: "object",
 *   properties: {
 *     user: {
 *       type: "object",
 *       properties: {
 *         name: { type: "string" }
 *       }
 *     }
 *   }
 * };
 * resolveSchemaPath(schema, ["user", "name"]);
 * // → { type: "string" }
 * ```
 */
export function resolveSchemaPath(
  schema: JSONSchema7,
  path: string[],
): JSONSchema7 | undefined {
  if (path.length === 0) return resolveRef(schema, schema);

  let current: JSONSchema7 = resolveRef(schema, schema);
  const root = schema;

  for (const segment of path) {
    const next = resolveSegment(current, segment, root);
    if (next === undefined) return undefined;
    current = next;
  }

  return current;
}

/**
 * Résout le schema des éléments d'un tableau.
 * Si le schema n'est pas de type `array` ou n'a pas de `items`, retourne `undefined`.
 *
 * @param schema - Le schema d'un tableau
 * @param root   - Le schema racine (pour résoudre les $ref)
 */
export function resolveArrayItems(
  schema: JSONSchema7,
  root: JSONSchema7,
): JSONSchema7 | undefined {
  const resolved = resolveRef(schema, root);

  // Vérification que c'est bien un tableau
  const schemaType = resolved.type;
  const isArray = schemaType === "array" || (Array.isArray(schemaType) && schemaType.includes("array"));

  if (!isArray && resolved.items === undefined) {
    return undefined;
  }

  if (resolved.items === undefined) {
    // array sans items → éléments de type inconnu
    return {};
  }

  // items peut être un schema unique ou un tuple (tableau de schemas).
  // Pour les boucles de template, on traite le cas d'un schema unique.
  if (Array.isArray(resolved.items)) {
    // Tuple : on crée un oneOf de tous les types possibles
    return { oneOf: resolved.items.map((item) => resolveRef(item, root)) };
  }

  return resolveRef(resolved.items, root);
}

/**
 * Simplifie un schema de sortie pour éviter les constructions inutilement
 * complexes (ex: `oneOf` avec un seul élément, doublons, etc.).
 */
export function simplifySchema(schema: JSONSchema7): JSONSchema7 {
  // oneOf / anyOf avec un seul élément → on déplie
  for (const key of ["oneOf", "anyOf"] as const) {
    if (schema[key] && schema[key].length === 1) {
      return simplifySchema(schema[key][0]!);
    }
  }

  // allOf avec un seul élément → on déplie
  if (schema.allOf && schema.allOf.length === 1) {
    return simplifySchema(schema.allOf[0]!);
  }

  // Déduplique les entrées identiques dans oneOf/anyOf
  for (const key of ["oneOf", "anyOf"] as const) {
    if (schema[key] && schema[key].length > 1) {
      const seen = new Set<string>();
      const unique: JSONSchema7[] = [];
      for (const entry of schema[key]) {
        const serialized = JSON.stringify(entry);
        if (!seen.has(serialized)) {
          seen.add(serialized);
          unique.push(simplifySchema(entry));
        }
      }
      if (unique.length === 1) return unique[0]!;
      return { ...schema, [key]: unique };
    }
  }

  return schema;
}
