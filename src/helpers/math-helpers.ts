import type { HelperDefinition } from "../types.ts";
import { HelperFactory } from "./helper-factory.ts";
import { toNumber } from "./utils.ts";

// ─── MathHelpers ─────────────────────────────────────────────────────────────
// Aggregates all math-related helpers for the template engine.
//
// Provides two kinds of helpers:
//
// 1. **Named helpers** — one helper per operation (`add`, `subtract`, `divide`, …)
//    Usage: `{{ add a b }}`, `{{ abs value }}`, `{{ round value 2 }}`
//
// 2. **Generic `math` helper** — single helper with the operator as a parameter
//    Usage: `{{ math a "+" b }}`, `{{ math a "/" b }}`, `{{ math a "**" b }}`
//
// ─── Registration ────────────────────────────────────────────────────────────
// MathHelpers are automatically pre-registered by the `Typebars` constructor.
// They can also be registered manually on any object implementing
// `HelperRegistry`:
//
//   const factory = new MathHelpers();
//   factory.register(engine);   // registers all helpers
//   factory.unregister(engine); // removes all helpers
//
// ─── Supported operators (generic `math` helper) ─────────────────────────────
//   +   Addition
//   -   Subtraction
//   *   Multiplication
//   /   Division
//   %   Modulo
//   **  Exponentiation

// ─── Types ───────────────────────────────────────────────────────────────────

/** Operators supported by the generic `math` helper */
type MathOperator = "+" | "-" | "*" | "/" | "%" | "**";

const SUPPORTED_OPERATORS = new Set<string>(["+", "-", "*", "/", "%", "**"]);

// ─── Internal utilities ─────────────────────────────────────────────────────

/** Converts a value to a number with a fallback of `0` for math operations. */
const num = (value: unknown): number => toNumber(value, 0);

/**
 * Applies a binary operator to two operands.
 */
function applyOperator(a: number, op: MathOperator, b: number): number {
	switch (op) {
		case "+":
			return a + b;
		case "-":
			return a - b;
		case "*":
			return a * b;
		case "/":
			return b === 0 ? Infinity : a / b;
		case "%":
			return b === 0 ? NaN : a % b;
		case "**":
			return a ** b;
	}
}

// ─── Main class ─────────────────────────────────────────────────────────────

export class MathHelpers extends HelperFactory {
	// ─── buildDefinitions (required by HelperFactory) ──────────────────

	protected buildDefinitions(defs: Map<string, HelperDefinition>): void {
		this.registerBinaryOperators(defs);
		this.registerUnaryFunctions(defs);
		this.registerMinMax(defs);
		this.registerGenericMath(defs);
	}

	// ── Binary operators ─────────────────────────────────────────────

	/** Registers add, subtract/sub, multiply/mul, divide/div, modulo/mod, pow */
	private registerBinaryOperators(defs: Map<string, HelperDefinition>): void {
		// add — Addition : {{ add a b }}
		const addDef: HelperDefinition = {
			fn: (a: unknown, b: unknown) => num(a) + num(b),
			params: [
				{ name: "a", type: { type: "number" }, description: "First operand" },
				{ name: "b", type: { type: "number" }, description: "Second operand" },
			],
			returnType: { type: "number" },
			description: "Adds two numbers: {{ add a b }}",
		};
		defs.set("add", addDef);

		// subtract / sub — Subtraction: {{ subtract a b }} or {{ sub a b }}
		const subtractDef: HelperDefinition = {
			fn: (a: unknown, b: unknown) => num(a) - num(b),
			params: [
				{
					name: "a",
					type: { type: "number" },
					description: "Value to subtract from",
				},
				{
					name: "b",
					type: { type: "number" },
					description: "Value to subtract",
				},
			],
			returnType: { type: "number" },
			description: "Subtracts b from a: {{ subtract a b }}",
		};
		defs.set("subtract", subtractDef);
		defs.set("sub", subtractDef);

		// multiply / mul — Multiplication: {{ multiply a b }} or {{ mul a b }}
		const multiplyDef: HelperDefinition = {
			fn: (a: unknown, b: unknown) => num(a) * num(b),
			params: [
				{ name: "a", type: { type: "number" }, description: "First factor" },
				{ name: "b", type: { type: "number" }, description: "Second factor" },
			],
			returnType: { type: "number" },
			description: "Multiplies two numbers: {{ multiply a b }}",
		};
		defs.set("multiply", multiplyDef);
		defs.set("mul", multiplyDef);

		// divide / div — Division: {{ divide a b }} or {{ div a b }}
		const divideDef: HelperDefinition = {
			fn: (a: unknown, b: unknown) => {
				const divisor = num(b);
				return divisor === 0 ? Infinity : num(a) / divisor;
			},
			params: [
				{ name: "a", type: { type: "number" }, description: "Dividend" },
				{ name: "b", type: { type: "number" }, description: "Divisor" },
			],
			returnType: { type: "number" },
			description:
				"Divides a by b: {{ divide a b }}. Returns Infinity if b is 0.",
		};
		defs.set("divide", divideDef);
		defs.set("div", divideDef);

		// modulo / mod — Modulo: {{ modulo a b }} or {{ mod a b }}
		const moduloDef: HelperDefinition = {
			fn: (a: unknown, b: unknown) => {
				const divisor = num(b);
				return divisor === 0 ? NaN : num(a) % divisor;
			},
			params: [
				{ name: "a", type: { type: "number" }, description: "Dividend" },
				{ name: "b", type: { type: "number" }, description: "Divisor" },
			],
			returnType: { type: "number" },
			description: "Returns the remainder of a divided by b: {{ modulo a b }}",
		};
		defs.set("modulo", moduloDef);
		defs.set("mod", moduloDef);

		// pow — Exponentiation : {{ pow base exponent }}
		defs.set("pow", {
			fn: (base: unknown, exponent: unknown) => num(base) ** num(exponent),
			params: [
				{ name: "base", type: { type: "number" }, description: "The base" },
				{
					name: "exponent",
					type: { type: "number" },
					description: "The exponent",
				},
			],
			returnType: { type: "number" },
			description:
				"Raises base to the power of exponent: {{ pow base exponent }}",
		});
	}

	// ── Unary functions ──────────────────────────────────────────────

	/** Registers abs, ceil, floor, round, sqrt */
	private registerUnaryFunctions(defs: Map<string, HelperDefinition>): void {
		// abs — Absolute value: {{ abs value }}
		defs.set("abs", {
			fn: (value: unknown) => Math.abs(num(value)),
			params: [
				{ name: "value", type: { type: "number" }, description: "The number" },
			],
			returnType: { type: "number" },
			description: "Returns the absolute value: {{ abs value }}",
		});

		// ceil — Round up: {{ ceil value }}
		defs.set("ceil", {
			fn: (value: unknown) => Math.ceil(num(value)),
			params: [
				{
					name: "value",
					type: { type: "number" },
					description: "The number to round up",
				},
			],
			returnType: { type: "number" },
			description: "Rounds up to the nearest integer: {{ ceil value }}",
		});

		// floor — Round down: {{ floor value }}
		defs.set("floor", {
			fn: (value: unknown) => Math.floor(num(value)),
			params: [
				{
					name: "value",
					type: { type: "number" },
					description: "The number to round down",
				},
			],
			returnType: { type: "number" },
			description: "Rounds down to the nearest integer: {{ floor value }}",
		});

		// round — Rounding: {{ round value }} or {{ round value precision }}
		// With precision: {{ round 3.14159 2 }} → 3.14
		defs.set("round", {
			fn: (value: unknown, precision: unknown) => {
				const n = num(value);
				// If precision is a Handlebars options object (not a number),
				// it means the second parameter was not provided.
				if (
					precision === undefined ||
					precision === null ||
					typeof precision === "object"
				) {
					return Math.round(n);
				}
				const p = num(precision);
				const factor = 10 ** p;
				return Math.round(n * factor) / factor;
			},
			params: [
				{
					name: "value",
					type: { type: "number" },
					description: "The number to round",
				},
				{
					name: "precision",
					type: { type: "number" },
					description: "Number of decimal places (default: 0)",
					optional: true,
				},
			],
			returnType: { type: "number" },
			description:
				"Rounds to the nearest integer or to a given precision: {{ round value }} or {{ round value 2 }}",
		});

		// sqrt — Square root: {{ sqrt value }}
		defs.set("sqrt", {
			fn: (value: unknown) => Math.sqrt(num(value)),
			params: [
				{ name: "value", type: { type: "number" }, description: "The number" },
			],
			returnType: { type: "number" },
			description: "Returns the square root: {{ sqrt value }}",
		});
	}

	// ── Min / Max ────────────────────────────────────────────────────

	/** Registers min and max */
	private registerMinMax(defs: Map<string, HelperDefinition>): void {
		// min — Minimum : {{ min a b }}
		defs.set("min", {
			fn: (a: unknown, b: unknown) => Math.min(num(a), num(b)),
			params: [
				{ name: "a", type: { type: "number" }, description: "First number" },
				{ name: "b", type: { type: "number" }, description: "Second number" },
			],
			returnType: { type: "number" },
			description: "Returns the smaller of two numbers: {{ min a b }}",
		});

		// max — Maximum : {{ max a b }}
		defs.set("max", {
			fn: (a: unknown, b: unknown) => Math.max(num(a), num(b)),
			params: [
				{ name: "a", type: { type: "number" }, description: "First number" },
				{ name: "b", type: { type: "number" }, description: "Second number" },
			],
			returnType: { type: "number" },
			description: "Returns the larger of two numbers: {{ max a b }}",
		});
	}

	// ── Generic helper ───────────────────────────────────────────────

	/** Registers the generic `math` helper with operator as a parameter */
	private registerGenericMath(defs: Map<string, HelperDefinition>): void {
		// Usage : {{ math a "+" b }}, {{ math a "/" b }}, {{ math a "**" b }}
		defs.set("math", {
			fn: (a: unknown, operator: unknown, b: unknown) => {
				const op = String(operator);
				if (!SUPPORTED_OPERATORS.has(op)) {
					throw new Error(
						`[math helper] Unknown operator "${op}". ` +
							`Supported: ${[...SUPPORTED_OPERATORS].join(", ")} `,
					);
				}
				return applyOperator(num(a), op as MathOperator, num(b));
			},
			params: [
				{ name: "a", type: { type: "number" }, description: "Left operand" },
				{
					name: "operator",
					type: { type: "string", enum: ["+", "-", "*", "/", "%", "**"] },
					description: 'Arithmetic operator: "+", "-", "*", "/", "%", "**"',
				},
				{ name: "b", type: { type: "number" }, description: "Right operand" },
			],
			returnType: { type: "number" },
			description:
				'Generic math helper with operator as parameter: {{ math a "+" b }}, {{ math a "/" b }}. ' +
				"Supported operators: +, -, *, /, %, **",
		});
	}
}
