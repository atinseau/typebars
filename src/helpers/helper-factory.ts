import type { HelperDefinition } from "../types";

// ─── HelperFactory ───────────────────────────────────────────────────────────
// Abstract base class that enforces a consistent pattern for creating,
// registering, and managing groups of related helpers.
//
// Every helper factory (MathHelpers, LogicalHelpers, …) must extend this class
// and implement the `buildDefinitions()` method to populate its helpers.
//
// The base class provides:
// - Lazy-cached definitions, helper names, and name set
// - `register()` / `unregister()` for any `HelperRegistry`
// - `getHelperNames()` / `isHelper()` for introspection

// ─── Types ───────────────────────────────────────────────────────────────────

/** Minimal registration interface — avoids tight coupling with Typebars */
export interface HelperRegistry {
	registerHelper(name: string, definition: HelperDefinition): unknown;
	unregisterHelper(name: string): unknown;
}

// ─── Abstract Base Class ─────────────────────────────────────────────────────

export abstract class HelperFactory {
	// ── Lazy caches (populated on first access) ──────────────────────────
	private _definitions: Map<string, HelperDefinition> | null = null;
	private _helperNames: readonly string[] | null = null;
	private _helperNamesSet: ReadonlySet<string> | null = null;

	// ── Abstract method — must be implemented by each factory ────────────

	/**
	 * Populates the `defs` map with all helper definitions.
	 *
	 * Subclasses implement this method to register their helpers:
	 * ```
	 * protected buildDefinitions(defs: Map<string, HelperDefinition>): void {
	 *   defs.set("myHelper", {
	 *     fn: (a: unknown) => String(a).toUpperCase(),
	 *     params: [{ name: "a", type: { type: "string" } }],
	 *     returnType: { type: "string" },
	 *     description: "Converts to uppercase",
	 *   });
	 * }
	 * ```
	 *
	 * @param defs - The map to populate with `[name, HelperDefinition]` entries
	 */
	protected abstract buildDefinitions(
		defs: Map<string, HelperDefinition>,
	): void;

	// ── Public API ───────────────────────────────────────────────────────

	/**
	 * Returns all definitions as a `Map<name, HelperDefinition>`.
	 * The map is lazily built and cached on first access.
	 */
	getDefinitions(): Map<string, HelperDefinition> {
		if (!this._definitions) {
			this._definitions = new Map();
			this.buildDefinitions(this._definitions);
		}
		return this._definitions;
	}

	/**
	 * Returns the list of all helper names provided by this factory.
	 */
	getHelperNames(): readonly string[] {
		if (!this._helperNames) {
			this._helperNames = [...this.getDefinitions().keys()];
		}
		return this._helperNames;
	}

	/**
	 * Checks whether a helper name belongs to this factory.
	 *
	 * @param name - The helper name to check
	 */
	isHelper(name: string): boolean {
		if (!this._helperNamesSet) {
			this._helperNamesSet = new Set(this.getHelperNames());
		}
		return this._helperNamesSet.has(name);
	}

	/**
	 * Registers all helpers from this factory on the given registry.
	 *
	 * @param registry - The engine or target registry
	 */
	register(registry: HelperRegistry): void {
		for (const [name, def] of this.getDefinitions()) {
			registry.registerHelper(name, def);
		}
	}

	/**
	 * Removes all helpers from this factory from the given registry.
	 *
	 * @param registry - The engine or target registry
	 */
	unregister(registry: HelperRegistry): void {
		for (const name of this.getHelperNames()) {
			registry.unregisterHelper(name);
		}
	}
}
