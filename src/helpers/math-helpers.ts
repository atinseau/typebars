import type { HelperDefinition } from "../types.ts";

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
//   MathHelpers.register(engine);   // registers all helpers
//   MathHelpers.unregister(engine); // removes all helpers
//
// ─── Supported operators (generic `math` helper) ─────────────────────────────
//   +   Addition
//   -   Subtraction
//   *   Multiplication
//   /   Division
//   %   Modulo
//   **  Exponentiation

// ─── Types ───────────────────────────────────────────────────────────────────

/** Minimal registration interface — avoids tight coupling with Typebars */
interface HelperRegistry {
	registerHelper(name: string, definition: HelperDefinition): unknown;
	unregisterHelper(name: string): unknown;
}

/** Operators supported by the generic `math` helper */
type MathOperator = "+" | "-" | "*" | "/" | "%" | "**";

const SUPPORTED_OPERATORS = new Set<string>(["+", "-", "*", "/", "%", "**"]);

// ─── Internal utilities ─────────────────────────────────────────────────────

/**
 * Converts an unknown value to a number.
 * Returns `0` when conversion fails (non-numeric string, object, etc.).
 */
function toNumber(value: unknown): number {
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const n = Number(value);
		return Number.isNaN(n) ? 0 : n;
	}
	return 0;
}

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

export class MathHelpers {
	// ─── All registered helper names ─────────────────────────────────────
	// Used by `register()` and `unregister()` to iterate.
	private static readonly HELPER_NAMES: readonly string[] = [
		// Binary operators
		"add",
		"subtract",
		"sub",
		"multiply",
		"mul",
		"divide",
		"div",
		"modulo",
		"mod",
		"pow",

		// Unary functions
		"abs",
		"ceil",
		"floor",
		"round",
		"sqrt",

		// Min / Max (binary)
		"min",
		"max",

		// Generic helper
		"math",
	];

	/** Set derived from `HELPER_NAMES` for O(1) lookup in `isMathHelper()` */
	private static readonly HELPER_NAMES_SET: ReadonlySet<string> = new Set(
		MathHelpers.HELPER_NAMES,
	);

	// ─── Helper definitions ─────────────────────────────────────────────

	/** Returns all definitions as a `Map<name, HelperDefinition>` */
	static getDefinitions(): Map<string, HelperDefinition> {
		const defs = new Map<string, HelperDefinition>();

		MathHelpers.registerBinaryOperators(defs);
		MathHelpers.registerUnaryFunctions(defs);
		MathHelpers.registerMinMax(defs);
		MathHelpers.registerGenericMath(defs);

		return defs;
	}

	// ── Binary operators ─────────────────────────────────────────────

	/** Registers add, subtract/sub, multiply/mul, divide/div, modulo/mod, pow */
	private static registerBinaryOperators(
		defs: Map<string, HelperDefinition>,
	): void {
		// add — Addition : {{ add a b }}
		const addDef: HelperDefinition = {
			fn: (a: unknown, b: unknown) => toNumber(a) + toNumber(b),
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
			fn: (a: unknown, b: unknown) => toNumber(a) - toNumber(b),
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
			fn: (a: unknown, b: unknown) => toNumber(a) * toNumber(b),
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
				const divisor = toNumber(b);
				return divisor === 0 ? Infinity : toNumber(a) / divisor;
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
				const divisor = toNumber(b);
				return divisor === 0 ? NaN : toNumber(a) % divisor;
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
			fn: (base: unknown, exponent: unknown) =>
				toNumber(base) ** toNumber(exponent),
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
	private static registerUnaryFunctions(
		defs: Map<string, HelperDefinition>,
	): void {
		// abs — Absolute value: {{ abs value }}
		defs.set("abs", {
			fn: (value: unknown) => Math.abs(toNumber(value)),
			params: [
				{ name: "value", type: { type: "number" }, description: "The number" },
			],
			returnType: { type: "number" },
			description: "Returns the absolute value: {{ abs value }}",
		});

		// ceil — Round up: {{ ceil value }}
		defs.set("ceil", {
			fn: (value: unknown) => Math.ceil(toNumber(value)),
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
			fn: (value: unknown) => Math.floor(toNumber(value)),
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
				const n = toNumber(value);
				// If precision is a Handlebars options object (not a number),
				// it means the second parameter was not provided.
				if (
					precision === undefined ||
					precision === null ||
					typeof precision === "object"
				) {
					return Math.round(n);
				}
				const p = toNumber(precision);
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
			fn: (value: unknown) => Math.sqrt(toNumber(value)),
			params: [
				{ name: "value", type: { type: "number" }, description: "The number" },
			],
			returnType: { type: "number" },
			description: "Returns the square root: {{ sqrt value }}",
		});
	}

	// ── Min / Max ────────────────────────────────────────────────────

	/** Registers min and max */
	private static registerMinMax(defs: Map<string, HelperDefinition>): void {
		// min — Minimum : {{ min a b }}
		defs.set("min", {
			fn: (a: unknown, b: unknown) => Math.min(toNumber(a), toNumber(b)),
			params: [
				{ name: "a", type: { type: "number" }, description: "First number" },
				{ name: "b", type: { type: "number" }, description: "Second number" },
			],
			returnType: { type: "number" },
			description: "Returns the smaller of two numbers: {{ min a b }}",
		});

		// max — Maximum : {{ max a b }}
		defs.set("max", {
			fn: (a: unknown, b: unknown) => Math.max(toNumber(a), toNumber(b)),
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
	private static registerGenericMath(
		defs: Map<string, HelperDefinition>,
	): void {
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
				return applyOperator(toNumber(a), op as MathOperator, toNumber(b));
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

	// ─── Registration / Unregistration ───────────────────────────────────

	/**
	 * Registers all math helpers on a `Typebars` instance
	 * (or any object implementing `HelperRegistry`).
	 *
	 * **Note:** MathHelpers are automatically pre-registered by the
	 * `Typebars` constructor. This method is only useful if you have
	 * called `unregister()` and want to re-enable them, or if you are
	 * registering on a custom registry.
	 *
	 * @param registry - The engine or target registry
	 *
	 * @example
	 * ```
	 * const engine = new Typebars();
	 * // Math helpers are already available!
	 * engine.analyzeAndExecute("{{ divide total count }}", schema, data);
	 * engine.analyzeAndExecute("{{ math price '*' quantity }}", schema, data);
	 * ```
	 */
	static register(registry: HelperRegistry): void {
		const defs = MathHelpers.getDefinitions();
		for (const [name, def] of defs) {
			registry.registerHelper(name, def);
		}
	}

	/**
	 * Removes all math helpers from the registry.
	 *
	 * @param registry - The engine or target registry
	 */
	static unregister(registry: HelperRegistry): void {
		for (const name of MathHelpers.HELPER_NAMES) {
			registry.unregisterHelper(name);
		}
	}

	/**
	 * Returns the list of all math helper names.
	 * Useful for checking whether a given helper belongs to the math pack.
	 */
	static getHelperNames(): readonly string[] {
		return MathHelpers.HELPER_NAMES;
	}

	/**
	 * Checks whether a helper name belongs to the math pack.
	 *
	 * @param name - The helper name to check
	 */
	static isMathHelper(name: string): boolean {
		return MathHelpers.HELPER_NAMES_SET.has(name);
	}
}
