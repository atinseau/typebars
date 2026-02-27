import type { HelperDefinition } from "../types";
import { HelperFactory } from "./helper-factory";
import { toNumber } from "./utils";

// ─── LogicalHelpers ──────────────────────────────────────────────────────────
// Aggregates all logical / comparison helpers for the template engine.
//
// Provides two kinds of helpers:
//
// 1. **Named helpers** — one helper per operation (`eq`, `lt`, `not`, …)
//    Usage: `{{#if (eq status "active")}}`, `{{#if (lt price 100)}}`
//
// 2. **Generic `compare` helper** — single helper with the operator as a param
//    Usage: `{{#if (compare a "<" b)}}`, `{{#if (compare name "==" "Alice")}}`
//
// ─── Registration ────────────────────────────────────────────────────────────
// LogicalHelpers are automatically pre-registered by the `Typebars` constructor.
// They can also be registered manually on any object implementing
// `HelperRegistry`:
//
//   const factory = new LogicalHelpers();
//   factory.register(engine);   // registers all helpers
//   factory.unregister(engine); // removes all helpers
//
// ─── Supported operators (generic `compare` helper) ──────────────────────────
//   ==   Loose equality
//   ===  Strict equality
//   !=   Loose inequality
//   !==  Strict inequality
//   <    Less than
//   <=   Less than or equal
//   >    Greater than
//   >=   Greater than or equal

// ─── Types ───────────────────────────────────────────────────────────────────

/** Operators supported by the generic `compare` helper */
type CompareOperator = "==" | "===" | "!=" | "!==" | "<" | "<=" | ">" | ">=";

const SUPPORTED_OPERATORS = new Set<string>([
	"==",
	"===",
	"!=",
	"!==",
	"<",
	"<=",
	">",
	">=",
]);

// ─── Internal utilities ─────────────────────────────────────────────────────

/**
 * Applies a comparison operator to two operands.
 */
function applyOperator(a: unknown, op: CompareOperator, b: unknown): boolean {
	switch (op) {
		case "==":
			// biome-ignore lint/suspicious/noDoubleEquals: intentional loose equality
			return a == b;
		case "===":
			return a === b;
		case "!=":
			// biome-ignore lint/suspicious/noDoubleEquals: intentional loose inequality
			return a != b;
		case "!==":
			return a !== b;
		case "<":
			return toNumber(a) < toNumber(b);
		case "<=":
			return toNumber(a) <= toNumber(b);
		case ">":
			return toNumber(a) > toNumber(b);
		case ">=":
			return toNumber(a) >= toNumber(b);
	}
}

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

// ─── Main class ─────────────────────────────────────────────────────────────

export class LogicalHelpers extends HelperFactory {
	// ─── buildDefinitions (required by HelperFactory) ──────────────────

	protected buildDefinitions(defs: Map<string, HelperDefinition>): void {
		this.registerEquality(defs);
		this.registerComparison(defs);
		this.registerLogicalOperators(defs);
		this.registerCollectionHelpers(defs);
		this.registerGenericCompare(defs);
	}

	// ── Equality helpers ─────────────────────────────────────────────

	/** Registers eq, ne / neq */
	private registerEquality(defs: Map<string, HelperDefinition>): void {
		// eq — Strict equality: {{#if (eq a b)}}
		defs.set("eq", {
			fn: (a: unknown, b: unknown) => a === b,
			params: [
				{ name: "a", description: "Left value" },
				{ name: "b", description: "Right value" },
			],
			returnType: { type: "boolean" },
			description: "Returns true if a is strictly equal to b: {{#if (eq a b)}}",
		});

		// ne / neq — Strict inequality: {{#if (ne a b)}}
		const neDef: HelperDefinition = {
			fn: (a: unknown, b: unknown) => a !== b,
			params: [
				{ name: "a", description: "Left value" },
				{ name: "b", description: "Right value" },
			],
			returnType: { type: "boolean" },
			description:
				"Returns true if a is not strictly equal to b: {{#if (ne a b)}}",
		};
		defs.set("ne", neDef);
		defs.set("neq", neDef);
	}

	// ── Comparison helpers ───────────────────────────────────────────

	/** Registers lt, lte / le, gt, gte / ge */
	private registerComparison(defs: Map<string, HelperDefinition>): void {
		// lt — Less than: {{#if (lt a b)}}
		defs.set("lt", {
			fn: (a: unknown, b: unknown) => toNumber(a) < toNumber(b),
			params: [
				{ name: "a", type: { type: "number" }, description: "Left operand" },
				{ name: "b", type: { type: "number" }, description: "Right operand" },
			],
			returnType: { type: "boolean" },
			description: "Returns true if a < b: {{#if (lt a b)}}",
		});

		// lte / le — Less than or equal: {{#if (lte a b)}}
		const lteDef: HelperDefinition = {
			fn: (a: unknown, b: unknown) => toNumber(a) <= toNumber(b),
			params: [
				{ name: "a", type: { type: "number" }, description: "Left operand" },
				{ name: "b", type: { type: "number" }, description: "Right operand" },
			],
			returnType: { type: "boolean" },
			description: "Returns true if a <= b: {{#if (lte a b)}}",
		};
		defs.set("lte", lteDef);
		defs.set("le", lteDef);

		// gt — Greater than: {{#if (gt a b)}}
		defs.set("gt", {
			fn: (a: unknown, b: unknown) => toNumber(a) > toNumber(b),
			params: [
				{ name: "a", type: { type: "number" }, description: "Left operand" },
				{ name: "b", type: { type: "number" }, description: "Right operand" },
			],
			returnType: { type: "boolean" },
			description: "Returns true if a > b: {{#if (gt a b)}}",
		});

		// gte / ge — Greater than or equal: {{#if (gte a b)}}
		const gteDef: HelperDefinition = {
			fn: (a: unknown, b: unknown) => toNumber(a) >= toNumber(b),
			params: [
				{ name: "a", type: { type: "number" }, description: "Left operand" },
				{ name: "b", type: { type: "number" }, description: "Right operand" },
			],
			returnType: { type: "boolean" },
			description: "Returns true if a >= b: {{#if (gte a b)}}",
		};
		defs.set("gte", gteDef);
		defs.set("ge", gteDef);
	}

	// ── Logical operators ────────────────────────────────────────────

	/** Registers not, and, or */
	private registerLogicalOperators(defs: Map<string, HelperDefinition>): void {
		// not — Logical negation: {{#if (not active)}}
		defs.set("not", {
			fn: (value: unknown) => !value,
			params: [{ name: "value", description: "Value to negate" }],
			returnType: { type: "boolean" },
			description: "Returns true if the value is falsy: {{#if (not active)}}",
		});

		// and — Logical AND: {{#if (and a b)}}
		defs.set("and", {
			fn: (a: unknown, b: unknown) => !!a && !!b,
			params: [
				{ name: "a", description: "First condition" },
				{ name: "b", description: "Second condition" },
			],
			returnType: { type: "boolean" },
			description: "Returns true if both values are truthy: {{#if (and a b)}}",
		});

		// or — Logical OR: {{#if (or a b)}}
		defs.set("or", {
			fn: (a: unknown, b: unknown) => !!a || !!b,
			params: [
				{ name: "a", description: "First condition" },
				{ name: "b", description: "Second condition" },
			],
			returnType: { type: "boolean" },
			description:
				"Returns true if at least one value is truthy: {{#if (or a b)}}",
		});
	}

	// ── Collection / String helpers ──────────────────────────────────

	/** Registers contains, in */
	private registerCollectionHelpers(defs: Map<string, HelperDefinition>): void {
		// contains — Checks if a string contains a substring or an array contains an element
		// Usage: {{#if (contains name "ali")}} or {{#if (contains tags "admin")}}
		defs.set("contains", {
			fn: (haystack: unknown, needle: unknown) => {
				if (typeof haystack === "string") {
					return haystack.includes(String(needle));
				}
				if (Array.isArray(haystack)) {
					return haystack.includes(needle);
				}
				return false;
			},
			params: [
				{
					name: "haystack",
					description: "String or array to search in",
				},
				{
					name: "needle",
					description: "Value to search for",
				},
			],
			returnType: { type: "boolean" },
			description:
				'Checks if a string contains a substring or an array contains an element: {{#if (contains name "ali")}}',
		});

		// in — Checks if a value is one of the provided options (variadic)
		// Usage: {{#if (in status "active" "pending" "draft")}}
		defs.set("in", {
			fn: (...args: unknown[]) => {
				// Handlebars always passes an options object as the last argument.
				// We need to exclude it from the candidate list.
				if (args.length < 2) return false;

				const value = args[0];
				// Filter out the trailing Handlebars options object
				const candidates = args.slice(1).filter((a) => !isHandlebarsOptions(a));

				return candidates.some((c) => c === value);
			},
			params: [
				{
					name: "value",
					description: "Value to look for",
				},
				{
					name: "candidates",
					description:
						'One or more candidate values (variadic): {{#if (in status "active" "pending")}}',
				},
			],
			returnType: { type: "boolean" },
			description:
				'Checks if a value is one of the provided options: {{#if (in status "active" "pending" "draft")}}',
		});
	}

	// ── Generic helper ───────────────────────────────────────────────

	/** Registers the generic `compare` helper with operator as a parameter */
	private registerGenericCompare(defs: Map<string, HelperDefinition>): void {
		// Usage: {{#if (compare a "<" b)}}, {{#if (compare name "===" "Alice")}}
		defs.set("compare", {
			fn: (a: unknown, operator: unknown, b: unknown) => {
				const op = String(operator);
				if (!SUPPORTED_OPERATORS.has(op)) {
					throw new Error(
						`[compare helper] Unknown operator "${op}". ` +
							`Supported: ${[...SUPPORTED_OPERATORS].join(", ")} `,
					);
				}
				return applyOperator(a, op as CompareOperator, b);
			},
			params: [
				{ name: "a", description: "Left operand" },
				{
					name: "operator",
					type: {
						type: "string",
						enum: ["==", "===", "!=", "!==", "<", "<=", ">", ">="],
					},
					description:
						'Comparison operator: "==", "===", "!=", "!==", "<", "<=", ">", ">="',
				},
				{ name: "b", description: "Right operand" },
			],
			returnType: { type: "boolean" },
			description:
				'Generic comparison helper with operator as parameter: {{#if (compare a "<" b)}}. ' +
				"Supported operators: ==, ===, !=, !==, <, <=, >, >=",
		});
	}
}
