import type { JSONSchema7 } from "json-schema";
import { UnsupportedSchemaError } from "./errors.ts";
import { deepEqual } from "./utils.ts";

// ─── JSON Schema Resolver ────────────────────────────────────────────────────
// Utility for navigating a JSON Schema Draft v7 by following a property path
// (e.g. ["user", "address", "city"]).
//
// Handles:
// - `$ref` resolution (internal references #/definitions/...)
// - Navigation through `properties`
// - Navigation through `items` (array elements)
// - Combinators `allOf`, `anyOf`, `oneOf` (searches each branch)
// - `additionalProperties` when the property is not explicitly declared
//
// Rejects:
// - Conditional schemas (`if/then/else`) — non-resolvable without runtime data

// ─── Conditional Schema Detection ────────────────────────────────────────────
// JSON Schema Draft v7 introduced `if/then/else` conditional schemas.
// These are fundamentally non-resolvable during static analysis because
// they depend on runtime data values. Rather than silently ignoring them
// (which would produce incorrect results — missing properties, wrong types),
// we fail fast with a clear error pointing to the exact location in the schema.

/**
 * Recursively validates that a JSON Schema does not contain `if/then/else`
 * conditional keywords. Throws an `UnsupportedSchemaError` if any are found.
 *
 * This check traverses the entire schema tree, including:
 * - `properties` values
 * - `additionalProperties` (when it's a schema)
 * - `items` (single schema or tuple)
 * - `allOf`, `anyOf`, `oneOf` branches
 * - `not`
 * - `definitions` / `$defs` values
 *
 * A `Set<object>` is used to track visited schemas and prevent infinite loops
 * from circular structures.
 *
 * @param schema - The JSON Schema to validate
 * @param path   - The current JSON pointer path (for error reporting)
 * @param visited - Set of already-visited schema objects (cycle protection)
 *
 * @throws {UnsupportedSchemaError} if `if`, `then`, or `else` is found
 *
 * @example
 * ```
 * // Throws UnsupportedSchemaError:
 * assertNoConditionalSchema({
 *   type: "object",
 *   if: { properties: { kind: { const: "a" } } },
 *   then: { properties: { a: { type: "string" } } },
 * });
 *
 * // OK — no conditional keywords:
 * assertNoConditionalSchema({
 *   type: "object",
 *   properties: { name: { type: "string" } },
 * });
 * ```
 */
export function assertNoConditionalSchema(
	schema: JSONSchema7,
	path = "",
	visited: Set<object> = new Set(),
): void {
	// Cycle protection — avoid infinite loops on circular schema structures
	if (visited.has(schema)) return;
	visited.add(schema);

	// ── Detect if/then/else at the current level ─────────────────────────
	if (schema.if !== undefined) {
		throw new UnsupportedSchemaError("if/then/else", path || "/");
	}
	// `then` or `else` without `if` is unusual but still unsupported
	if (schema.then !== undefined) {
		throw new UnsupportedSchemaError("if/then/else", path || "/");
	}
	if (schema.else !== undefined) {
		throw new UnsupportedSchemaError("if/then/else", path || "/");
	}

	// ── Recurse into properties ──────────────────────────────────────────
	if (schema.properties) {
		for (const [key, prop] of Object.entries(schema.properties)) {
			if (prop && typeof prop !== "boolean") {
				assertNoConditionalSchema(prop, `${path}/properties/${key}`, visited);
			}
		}
	}

	// ── Recurse into additionalProperties ────────────────────────────────
	if (
		schema.additionalProperties &&
		typeof schema.additionalProperties === "object"
	) {
		assertNoConditionalSchema(
			schema.additionalProperties,
			`${path}/additionalProperties`,
			visited,
		);
	}

	// ── Recurse into items ───────────────────────────────────────────────
	if (schema.items) {
		if (Array.isArray(schema.items)) {
			for (let i = 0; i < schema.items.length; i++) {
				const item = schema.items[i];
				if (item && typeof item !== "boolean") {
					assertNoConditionalSchema(item, `${path}/items/${i}`, visited);
				}
			}
		} else if (typeof schema.items !== "boolean") {
			assertNoConditionalSchema(schema.items, `${path}/items`, visited);
		}
	}

	// ── Recurse into combinators ─────────────────────────────────────────
	for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
		const branches = schema[keyword];
		if (branches) {
			for (let i = 0; i < branches.length; i++) {
				const branch = branches[i];
				if (branch && typeof branch !== "boolean") {
					assertNoConditionalSchema(branch, `${path}/${keyword}/${i}`, visited);
				}
			}
		}
	}

	// ── Recurse into not ─────────────────────────────────────────────────
	if (schema.not && typeof schema.not !== "boolean") {
		assertNoConditionalSchema(schema.not, `${path}/not`, visited);
	}

	// ── Recurse into definitions / $defs ─────────────────────────────────
	for (const defsKey of ["definitions", "$defs"] as const) {
		const defs = schema[defsKey];
		if (defs) {
			for (const [name, def] of Object.entries(defs)) {
				if (def && typeof def !== "boolean") {
					assertNoConditionalSchema(def, `${path}/${defsKey}/${name}`, visited);
				}
			}
		}
	}
}

// ─── $ref Resolution ─────────────────────────────────────────────────────────
// Only supports internal references in the format `#/definitions/Foo`
// or `#/$defs/Foo` (JSON Schema Draft 2019+). Remote $refs (URLs) are
// not supported — that is outside the scope of a template engine.

/**
 * Recursively resolves `$ref` in a schema using the root schema as the
 * source of definitions.
 */
export function resolveRef(
	schema: JSONSchema7,
	root: JSONSchema7,
): JSONSchema7 {
	if (!schema.$ref) return schema;

	const ref = schema.$ref;

	// Expected format: #/definitions/Name or #/$defs/Name
	const match = ref.match(/^#\/(definitions|\$defs)\/(.+)$/);
	if (!match) {
		throw new Error(
			`Unsupported $ref format: "${ref}". Only internal #/definitions/ references are supported.`,
		);
	}

	const defsKey = match[1] as "definitions" | "$defs";
	const name = match[2] ?? "";

	const defs = defsKey === "definitions" ? root.definitions : root.$defs;

	if (!defs || !(name in defs)) {
		throw new Error(
			`Cannot resolve $ref "${ref}": definition "${name}" not found.`,
		);
	}

	// Recursive resolution in case the definition itself contains a $ref
	const def = defs[name];
	if (!def || typeof def === "boolean") {
		throw new Error(
			`Cannot resolve $ref "${ref}": definition "${name}" not found.`,
		);
	}
	return resolveRef(def, root);
}

// ─── Single-Segment Path Navigation ─────────────────────────────────────────

/**
 * Resolves a single path segment (a property name) within a schema.
 * Returns the corresponding sub-schema, or `undefined` if the path is invalid.
 *
 * @param schema  - The current schema (already resolved, no $ref)
 * @param segment - The property name to resolve
 * @param root    - The root schema (for resolving any internal $refs)
 */
function resolveSegment(
	schema: JSONSchema7,
	segment: string,
	root: JSONSchema7,
): JSONSchema7 | undefined {
	const resolved = resolveRef(schema, root);

	// 1. Explicit properties
	if (resolved.properties && segment in resolved.properties) {
		const prop = resolved.properties[segment];
		if (prop && typeof prop !== "boolean") return resolveRef(prop, root);
		if (prop === true) return {};
	}

	// 2. additionalProperties (when the property is not declared)
	if (
		resolved.additionalProperties !== undefined &&
		resolved.additionalProperties !== false
	) {
		if (resolved.additionalProperties === true) {
			// additionalProperties: true → type is unknown
			return {};
		}
		return resolveRef(resolved.additionalProperties, root);
	}

	// 3. Intrinsic array properties (e.g. `.length`)
	const schemaType = resolved.type;
	const isArray =
		schemaType === "array" ||
		(Array.isArray(schemaType) && schemaType.includes("array"));

	if (isArray && segment === "length") {
		return { type: "integer" };
	}

	// 4. Combinators — search within each branch
	const combinatorResult = resolveInCombinators(resolved, segment, root);
	if (combinatorResult) return combinatorResult;

	return undefined;
}

/**
 * Searches for a segment within `allOf`, `anyOf`, `oneOf` branches.
 * Returns the first matching sub-schema, or `undefined`.
 * For `allOf`, found results are merged into a single `allOf`.
 */
function resolveInCombinators(
	schema: JSONSchema7,
	segment: string,
	root: JSONSchema7,
): JSONSchema7 | undefined {
	// allOf: the property can be defined in any branch, and all constraints
	// apply simultaneously.
	if (schema.allOf) {
		const matches = schema.allOf
			.filter((b): b is JSONSchema7 => typeof b !== "boolean")
			.map((branch) => resolveSegment(branch, segment, root))
			.filter((s): s is JSONSchema7 => s !== undefined);

		if (matches.length === 1) return matches[0] as JSONSchema7;
		if (matches.length > 1) return { allOf: matches };
	}

	// anyOf / oneOf: the property can come from any branch.
	for (const key of ["anyOf", "oneOf"] as const) {
		if (!schema[key]) continue;
		const matches = schema[key]
			.filter((b): b is JSONSchema7 => typeof b !== "boolean")
			.map((branch) => resolveSegment(branch, segment, root))
			.filter((s): s is JSONSchema7 => s !== undefined);

		if (matches.length === 1) return matches[0] as JSONSchema7;
		if (matches.length > 1) return { [key]: matches };
	}

	return undefined;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolves a full path (e.g. ["user", "address", "city"]) within a JSON
 * Schema and returns the corresponding sub-schema.
 *
 * @param schema - The root schema describing the template context
 * @param path   - Array of segments (property names)
 * @returns The sub-schema at the end of the path, or `undefined` if the path
 *          cannot be resolved.
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
 * Resolves the item schema of an array.
 * If the schema is not of type `array` or has no `items`, returns `undefined`.
 *
 * @param schema - The array schema
 * @param root   - The root schema (for resolving $refs)
 */
export function resolveArrayItems(
	schema: JSONSchema7,
	root: JSONSchema7,
): JSONSchema7 | undefined {
	const resolved = resolveRef(schema, root);

	// Verify that it's actually an array
	const schemaType = resolved.type;
	const isArray =
		schemaType === "array" ||
		(Array.isArray(schemaType) && schemaType.includes("array"));

	if (!isArray && resolved.items === undefined) {
		return undefined;
	}

	if (resolved.items === undefined) {
		// array without items → element type is unknown
		return {};
	}

	// items can be a boolean (true = anything, false = nothing)
	if (typeof resolved.items === "boolean") {
		return {};
	}

	// items can be a single schema or a tuple (array of schemas).
	// For template loops, we handle the single-schema case.
	if (Array.isArray(resolved.items)) {
		// Tuple: create a oneOf of all possible types
		const schemas = resolved.items
			.filter((item): item is JSONSchema7 => typeof item !== "boolean")
			.map((item) => resolveRef(item, root));
		if (schemas.length === 0) return {};
		return { oneOf: schemas };
	}

	return resolveRef(resolved.items, root);
}

/**
 * Simplifies an output schema to avoid unnecessarily complex constructs
 * (e.g. `oneOf` with a single element, duplicates, etc.).
 *
 * Uses `deepEqual` for deduplication — more robust and performant than
 * `JSON.stringify` (independent of key order, no intermediate string
 * allocations).
 */
export function simplifySchema(schema: JSONSchema7): JSONSchema7 {
	// oneOf / anyOf with a single element → unwrap
	for (const key of ["oneOf", "anyOf"] as const) {
		const arr = schema[key];
		if (arr && arr.length === 1) {
			const first = arr[0];
			if (first !== undefined && typeof first !== "boolean")
				return simplifySchema(first);
		}
	}

	// allOf with a single element → unwrap
	if (schema.allOf && schema.allOf.length === 1) {
		const first = schema.allOf[0];
		if (first !== undefined && typeof first !== "boolean")
			return simplifySchema(first);
	}

	// Deduplicate identical entries in oneOf/anyOf
	for (const key of ["oneOf", "anyOf"] as const) {
		const arr = schema[key];
		if (arr && arr.length > 1) {
			const unique: JSONSchema7[] = [];
			for (const entry of arr) {
				if (typeof entry === "boolean") continue;
				// Use deepEqual instead of JSON.stringify for structural
				// comparison — more robust (key order independent) and
				// more performant (no string allocations).
				const isDuplicate = unique.some((existing) =>
					deepEqual(existing, entry),
				);
				if (!isDuplicate) {
					unique.push(simplifySchema(entry));
				}
			}
			if (unique.length === 1) return unique[0] as JSONSchema7;
			return { ...schema, [key]: unique };
		}
	}

	return schema;
}
