// ─── Shared Helper Utilities ─────────────────────────────────────────────────
// Common utilities used across helper packs (MathHelpers, LogicalHelpers, …).

/**
 * Converts an unknown value to a number.
 *
 * Conversion rules:
 * - `number`  → returned as-is
 * - `string`  → parsed via `Number()`; returns `fallback` if result is `NaN`
 * - `boolean` → `true` → `1`, `false` → `0`
 * - anything else → `fallback`
 *
 * The `fallback` parameter lets each consumer choose the right semantics:
 * - **Math helpers** pass `0` so that invalid inputs silently become zero
 *   (e.g. `add("abc", 5)` → `5`).
 * - **Logical helpers** pass `NaN` (the default) so that invalid comparisons
 *   evaluate to `false` (e.g. `lt("abc", 5)` → `false`).
 *
 * @param value    - The value to convert
 * @param fallback - Value returned when conversion fails (default: `NaN`)
 */
export function toNumber(value: unknown, fallback: number = NaN): number {
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const n = Number(value);
		return Number.isNaN(n) ? fallback : n;
	}
	if (typeof value === "boolean") return value ? 1 : 0;
	return fallback;
}
