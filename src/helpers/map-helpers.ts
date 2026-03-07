import type { HelperDefinition } from "../types.ts";
import { HelperFactory } from "./helper-factory.ts";

// ─── MapHelpers ──────────────────────────────────────────────────────────────
// Aggregates all map-related helpers for the template engine.
//
// Provides helpers for working with arrays of objects:
//
// - **`map`** — Extracts a specific property from each element of an
//   array, returning a new array of those values.
//   Usage: `{{ map users "name" }}` → `["Alice", "Bob", "Charlie"]`
//
// ─── Registration ────────────────────────────────────────────────────────────
// MapHelpers are automatically pre-registered by the `Typebars`
// constructor. They can also be registered manually on any object
// implementing `HelperRegistry`:
//
//   const factory = new MapHelpers();
//   factory.register(engine);   // registers all helpers
//   factory.unregister(engine); // removes all helpers
//
// ─── Static Analysis ─────────────────────────────────────────────────────────
// The `map` helper has special static analysis handling in the analyzer:
// - The first argument must resolve to an array of objects
// - The second argument must be a quoted string literal (e.g. `"name"`, not `name`)
// - The property must exist in the item schema of the array
// - The inferred return type is `{ type: "array", items: <property schema> }`

// ─── Internal utilities ─────────────────────────────────────────────────────

/**
 * Extracts a property from each element of an array.
 *
 * @param array    - The array of objects
 * @param property - The property name to extract from each element
 * @returns A new array containing the extracted property values
 */
function mapProperty(array: unknown, property: unknown): unknown[] {
	if (!Array.isArray(array)) {
		return [];
	}
	const prop = String(property);
	// Use flatMap semantics: if the array contains nested arrays
	// (e.g. from a previous map), flatten one level before extracting.
	// This enables chaining like `{{ map (map users 'cartItems') 'productId' }}`
	// where the inner map returns an array of arrays.
	const flattened = array.flat(1);
	return flattened.map((item: unknown) => {
		if (item !== null && item !== undefined && typeof item === "object") {
			return (item as Record<string, unknown>)[prop];
		}
		return undefined;
	});
}

// ─── Main class ─────────────────────────────────────────────────────────────

export class MapHelpers extends HelperFactory {
	/** The name used for special-case detection in the analyzer/executor */
	static readonly MAP_HELPER_NAME = "map";

	// ─── buildDefinitions (required by HelperFactory) ──────────────────

	protected buildDefinitions(defs: Map<string, HelperDefinition>): void {
		this.registerMap(defs);
	}

	// ── map ──────────────────────────────────────────────────────────────

	/** Registers the `map` helper */
	private registerMap(defs: Map<string, HelperDefinition>): void {
		defs.set(MapHelpers.MAP_HELPER_NAME, {
			fn: (array: unknown, property: unknown) => mapProperty(array, property),
			params: [
				{
					name: "array",
					type: { type: "array" },
					description: "The array of objects to extract values from",
				},
				{
					name: "property",
					type: { type: "string" },
					description: "The property name to extract from each element",
				},
			],
			returnType: { type: "array" },
			description:
				'Extracts a property from each element of an array: {{ map users "name" }} → ["Alice", "Bob", "Charlie"]',
		});
	}
}
