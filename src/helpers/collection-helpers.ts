import type { HelperDefinition } from "../types.ts";
import { HelperFactory } from "./helper-factory.ts";

// ─── CollectionHelpers ───────────────────────────────────────────────────────
// Aggregates all collection-related helpers for the template engine.
//
// Provides helpers for working with arrays of objects:
//
// - **`collect`** — Extracts a specific property from each element of an
//   array, returning a new array of those values.
//   Usage: `{{ collect users "name" }}` → `["Alice", "Bob", "Charlie"]`
//
// ─── Registration ────────────────────────────────────────────────────────────
// CollectionHelpers are automatically pre-registered by the `Typebars`
// constructor. They can also be registered manually on any object
// implementing `HelperRegistry`:
//
//   const factory = new CollectionHelpers();
//   factory.register(engine);   // registers all helpers
//   factory.unregister(engine); // removes all helpers
//
// ─── Static Analysis ─────────────────────────────────────────────────────────
// The `collect` helper has special static analysis handling in the analyzer:
// - The first argument must resolve to an array of objects
// - The second argument must be a quoted string literal (e.g. `"name"`, not `name`)
// - The property must exist in the item schema of the array
// - The inferred return type is `{ type: "array", items: <property schema> }`

// ─── Internal utilities ─────────────────────────────────────────────────────

/**
 * Extracts a property from each element of an array.
 *
 * @param collection - The array of objects
 * @param property   - The property name to extract from each element
 * @returns A new array containing the extracted property values
 */
function collectProperty(collection: unknown, property: unknown): unknown[] {
	if (!Array.isArray(collection)) {
		return [];
	}
	const prop = String(property);
	// Use flatMap semantics: if the collection contains nested arrays
	// (e.g. from a previous collect), flatten one level before extracting.
	// This enables chaining like `{{ collect (collect users 'cartItems') 'productId' }}`
	// where the inner collect returns an array of arrays.
	const flattened = collection.flat(1);
	return flattened.map((item: unknown) => {
		if (item !== null && item !== undefined && typeof item === "object") {
			return (item as Record<string, unknown>)[prop];
		}
		return undefined;
	});
}

// ─── Main class ─────────────────────────────────────────────────────────────

export class CollectionHelpers extends HelperFactory {
	/** The name used for special-case detection in the analyzer/executor */
	static readonly COLLECT_HELPER_NAME = "collect";

	// ─── buildDefinitions (required by HelperFactory) ──────────────────

	protected buildDefinitions(defs: Map<string, HelperDefinition>): void {
		this.registerCollect(defs);
	}

	// ── collect ──────────────────────────────────────────────────────────

	/** Registers the `collect` helper */
	private registerCollect(defs: Map<string, HelperDefinition>): void {
		defs.set(CollectionHelpers.COLLECT_HELPER_NAME, {
			fn: (collection: unknown, property: unknown) =>
				collectProperty(collection, property),
			params: [
				{
					name: "collection",
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
				'Extracts a property from each element of an array: {{ collect users "name" }} → ["Alice", "Bob", "Charlie"]',
		});
	}
}
