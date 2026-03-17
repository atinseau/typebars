import type { HelperDefinition } from "../types.ts";
import { HelperFactory } from "./helper-factory.ts";

// ─── DefaultHelpers ──────────────────────────────────────────────────────────
// Provides a variadic fallback helper that returns the first non-nullish
// argument, similar to the `??` (nullish coalescing) chain in JavaScript.
//
// - **`default`** — Returns the first non-nullish value from a list of
//   arguments (variables or literals).
//   Usage: `{{ default userId "anonymous" }}`
//           `{{ default a b c }}`
//           `{{ default departmentId accountId "fallback-id" }}`
//
// ─── Registration ────────────────────────────────────────────────────────────
// DefaultHelpers are automatically pre-registered by the `Typebars`
// constructor. They can also be registered manually on any object
// implementing `HelperRegistry`:
//
//   const factory = new DefaultHelpers();
//   factory.register(engine);   // registers all helpers
//   factory.unregister(engine); // removes all helpers
//
// ─── Static Analysis ─────────────────────────────────────────────────────────
// The `default` helper has special static analysis handling in the analyzer:
// - At least 2 arguments are required
// - All arguments must have compatible types
// - The argument chain must terminate with a guaranteed value (a literal,
//   a non-optional property, or a sub-expression). If no argument is
//   guaranteed, a `DEFAULT_NO_GUARANTEED_VALUE` diagnostic error is emitted.
// - The inferred return type is the union of all argument types (simplified)

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
 * Returns the first non-nullish argument from a variadic argument list.
 * The trailing Handlebars options object is automatically excluded.
 */
function defaultValue(...args: unknown[]): unknown {
	// Filter out the trailing Handlebars options object
	const candidates = args.filter((a) => !isHandlebarsOptions(a));

	for (const candidate of candidates) {
		if (candidate !== null && candidate !== undefined) {
			return candidate;
		}
	}

	return null;
}

// ─── Main class ─────────────────────────────────────────────────────────────

export class DefaultHelpers extends HelperFactory {
	/** The name used for special-case detection in the analyzer/executor */
	static readonly DEFAULT_HELPER_NAME = "default";

	// ─── buildDefinitions (required by HelperFactory) ──────────────────

	protected buildDefinitions(defs: Map<string, HelperDefinition>): void {
		this.registerDefault(defs);
	}

	// ── default ──────────────────────────────────────────────────────────

	/** Registers the `default` helper */
	private registerDefault(defs: Map<string, HelperDefinition>): void {
		defs.set(DefaultHelpers.DEFAULT_HELPER_NAME, {
			fn: defaultValue,
			params: [
				{
					name: "primary",
					description: "The primary value to use (may be nullish)",
				},
				{
					name: "fallback",
					description:
						"One or more fallback values (variadic). The chain must end with a guaranteed value.",
				},
			],
			// No static returnType — the analyzer infers it from the arguments
			description:
				'Returns the first non-nullish value from a list of arguments: {{ default userId "anonymous" }}',
		});
	}
}
