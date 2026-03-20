import type { HelperDefinition } from "../types.ts";
import { HelperFactory } from "./helper-factory.ts";

// ─── ArrayHelpers ───────────────────────────────────────────────────────────
// Provides a variadic helper that constructs an array from its arguments.
//
// - **`array`** — Collects all arguments into a single array.
//   Usage: `{{ array name status }}`
//           `{{ array "a" "b" "c" }}`
//           `{{ array (add count 1) 42 }}`
//
// ─── Registration ────────────────────────────────────────────────────────────
// ArrayHelpers are automatically pre-registered by the `Typebars`
// constructor. They can also be registered manually on any object
// implementing `HelperRegistry`:
//
//   const factory = new ArrayHelpers();
//   factory.register(engine);   // registers all helpers
//   factory.unregister(engine); // removes all helpers
//
// ─── Static Analysis ─────────────────────────────────────────────────────────
// The `array` helper has special static analysis handling in the analyzer:
// - At least 1 argument is required
// - All arguments must have compatible types
// - The inferred return type is `{ type: "array", items: <union of arg types> }`

// ─── Internal utilities ─────────────────────────────────────────────────────

/**
 * Checks whether a value is a Handlebars options object.
 * Handlebars always passes an options object as the last argument to helpers.
 */
function isHandlebarsOptions(value: unknown): boolean {
	return (
		value !== null &&
		typeof value === "object" &&
		"hash" in (value as Record<string, unknown>) &&
		"name" in (value as Record<string, unknown>)
	);
}

/**
 * Collects all arguments into an array.
 * The trailing Handlebars options object is automatically excluded.
 */
function arrayValue(...args: unknown[]): unknown[] {
	return args.filter((a) => !isHandlebarsOptions(a));
}

// ─── Main class ─────────────────────────────────────────────────────────────

export class ArrayHelpers extends HelperFactory {
	/** The name used for special-case detection in the analyzer/executor */
	static readonly ARRAY_HELPER_NAME = "array";

	// ─── buildDefinitions (required by HelperFactory) ──────────────────

	protected buildDefinitions(defs: Map<string, HelperDefinition>): void {
		this.registerArray(defs);
	}

	// ── array ──────────────────────────────────────────────────────────

	/** Registers the `array` helper */
	private registerArray(defs: Map<string, HelperDefinition>): void {
		defs.set(ArrayHelpers.ARRAY_HELPER_NAME, {
			fn: arrayValue,
			params: [
				{
					name: "values",
					description: "One or more values to collect into an array (variadic)",
				},
			],
			// No static returnType — the analyzer infers it from the arguments
			description:
				"Constructs an array from its arguments: {{ array name status }}",
		});
	}
}
