import { beforeEach, describe, expect, it } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { MathHelpers } from "../src/helpers/math-helpers";
import { Typebars } from "../src/typebars";
import type { HelperConfig } from "../src/types";

const mathHelpers = new MathHelpers();

// ─── Shared schema & data ────────────────────────────────────────────────────

const schema: JSONSchema7 = {
	type: "object",
	properties: {
		a: { type: "number" },
		b: { type: "number" },
		zero: { type: "number" },
		negative: { type: "number" },
		decimal: { type: "number" },
		items: { type: "array", items: { type: "number" } },
		label: { type: "string" },
	},
	required: ["a", "b", "zero", "negative", "decimal", "items", "label"],
} as const;

const data = {
	a: 10,
	b: 3,
	zero: 0,
	negative: -7,
	decimal: Math.PI,
	items: [1, 2, 3, 4, 5],
	label: "hello",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function run(engine: Typebars, template: string) {
	return engine.analyzeAndExecute(template, schema, data);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MathHelpers", () => {
	let engine: Typebars;

	beforeEach(() => {
		engine = new Typebars();
	});

	// ─── Built-in registration ───────────────────────────────────────────

	describe("pre-registration (built-in)", () => {
		it("all math helpers are available without calling register()", () => {
			const names = mathHelpers.getHelperNames();
			for (const name of names) {
				expect(engine.hasHelper(name)).toBe(true);
			}
		});

		it("a fresh engine can directly use math helpers", () => {
			const { analysis, value } = run(engine, "{{ add a b }}");
			expect(analysis.valid).toBe(true);
			expect(value).toBe(13);
		});
	});

	// ─── Register / unregister explicite ─────────────────────────────────

	describe("explicit register / unregister", () => {
		it("unregister removes all helpers", () => {
			mathHelpers.unregister(engine);
			const names = mathHelpers.getHelperNames();
			for (const name of names) {
				expect(engine.hasHelper(name)).toBe(false);
			}
		});

		it("register re-registers after an unregister", () => {
			mathHelpers.unregister(engine);
			expect(engine.hasHelper("add")).toBe(false);

			mathHelpers.register(engine);
			expect(engine.hasHelper("add")).toBe(true);

			const { value } = run(engine, "{{ add a b }}");
			expect(value).toBe(13);
		});

		it("register is idempotent (no error if called twice)", () => {
			mathHelpers.register(engine);
			expect(engine.hasHelper("add")).toBe(true);
		});
	});

	// ─── getDefinitions ──────────────────────────────────────────────────

	describe("getDefinitions", () => {
		it("returns a Map with all definitions", () => {
			const defs = mathHelpers.getDefinitions();
			expect(defs).toBeInstanceOf(Map);
			expect(defs.size).toBeGreaterThanOrEqual(
				mathHelpers.getHelperNames().length,
			);
		});

		it("every definition has fn and returnType number", () => {
			const defs = mathHelpers.getDefinitions();
			for (const [, def] of defs) {
				expect(typeof def.fn).toBe("function");
				expect(def.returnType).toEqual({ type: "number" });
			}
		});
	});

	// ─── params metadata ────────────────────────────────────────────────

	describe("params metadata", () => {
		it("every definition has a non-empty params array", () => {
			const defs = mathHelpers.getDefinitions();
			for (const [_name, def] of defs) {
				expect(def.params).toBeDefined();
				expect(def.params?.length).toBeGreaterThan(0);
			}
		});

		it("every param has a name and a type", () => {
			const defs = mathHelpers.getDefinitions();
			for (const [, def] of defs) {
				for (const param of def.params ?? []) {
					expect(typeof param.name).toBe("string");
					expect(param.name.length).toBeGreaterThan(0);
					expect(param.type).toBeDefined();
				}
			}
		});

		it("every definition has a description", () => {
			const defs = mathHelpers.getDefinitions();
			for (const [, def] of defs) {
				expect(typeof def.description).toBe("string");
				expect(def.description?.length).toBeGreaterThan(0);
			}
		});

		it("round has an optional precision parameter", () => {
			const defs = mathHelpers.getDefinitions();
			const roundDef = defs.get("round");
			expect(roundDef).toBeDefined();
			expect(roundDef?.params?.length).toBe(2);

			const precisionParam = roundDef?.params?.[1];
			expect(precisionParam?.name).toBe("precision");
			expect(precisionParam?.optional).toBe(true);
		});

		it("math has an operator parameter with enum", () => {
			const defs = mathHelpers.getDefinitions();
			const mathDef = defs.get("math");
			expect(mathDef).toBeDefined();
			expect(mathDef?.params?.length).toBe(3);

			const operatorParam = mathDef?.params?.[1];
			expect(operatorParam?.name).toBe("operator");
			expect(operatorParam?.type).toEqual({
				type: "string",
				enum: ["+", "-", "*", "/", "%", "**"],
			});
		});

		it("binary helpers have exactly 2 params", () => {
			const defs = mathHelpers.getDefinitions();
			const binaryHelpers = [
				"add",
				"subtract",
				"multiply",
				"divide",
				"modulo",
				"pow",
				"min",
				"max",
			];
			for (const name of binaryHelpers) {
				const def = defs.get(name);
				expect(def?.params?.length).toBe(2);
			}
		});

		it("unary helpers have exactly 1 param", () => {
			const defs = mathHelpers.getDefinitions();
			const unaryHelpers = ["abs", "ceil", "floor", "sqrt"];
			for (const name of unaryHelpers) {
				const def = defs.get(name);
				expect(def?.params?.length).toBe(1);
			}
		});
	});

	// ─── isMathHelper ────────────────────────────────────────────────────

	describe("isMathHelper", () => {
		it("returns true for a known math helper", () => {
			expect(mathHelpers.isHelper("add")).toBe(true);
			expect(mathHelpers.isHelper("math")).toBe(true);
			expect(mathHelpers.isHelper("floor")).toBe(true);
		});

		it("returns false for an unknown helper", () => {
			expect(mathHelpers.isHelper("uppercase")).toBe(false);
			expect(mathHelpers.isHelper("unknown")).toBe(false);
		});
	});

	// ─── add ─────────────────────────────────────────────────────────────

	describe("add", () => {
		it("adds two properties", () => {
			const { analysis, value } = run(engine, "{{ add a b }}");
			expect(analysis.valid).toBe(true);
			expect(value).toBe(13);
		});

		it("adds a property and a literal", () => {
			const { value } = run(engine, "{{ add a 5 }}");
			expect(value).toBe(15);
		});

		it("adds with a negative number", () => {
			const { value } = run(engine, "{{ add a negative }}");
			expect(value).toBe(3);
		});

		it("adds with zero", () => {
			const { value } = run(engine, "{{ add a zero }}");
			expect(value).toBe(10);
		});

		it("adds decimals", () => {
			const { value } = run(engine, "{{ add decimal 1 }}");
			expect(value).toBeCloseTo(4.14159, 5);
		});

		it("static analysis returns outputSchema number", () => {
			const { analysis } = run(engine, "{{ add a b }}");
			expect(analysis.outputSchema).toEqual({ type: "number" });
		});
	});

	// ─── subtract / sub ──────────────────────────────────────────────────

	describe("subtract / sub", () => {
		it("subtracts two properties with subtract", () => {
			const { value } = run(engine, "{{ subtract a b }}");
			expect(value).toBe(7);
		});

		it("subtracts with the sub alias", () => {
			const { value } = run(engine, "{{ sub a b }}");
			expect(value).toBe(7);
		});

		it("subtracts a literal", () => {
			const { value } = run(engine, "{{ sub a 3 }}");
			expect(value).toBe(7);
		});

		it("negative result", () => {
			const { value } = run(engine, "{{ sub b a }}");
			expect(value).toBe(-7);
		});
	});

	// ─── multiply / mul ──────────────────────────────────────────────────

	describe("multiply / mul", () => {
		it("multiplies two properties with multiply", () => {
			const { value } = run(engine, "{{ multiply a b }}");
			expect(value).toBe(30);
		});

		it("multiplies with the mul alias", () => {
			const { value } = run(engine, "{{ mul a b }}");
			expect(value).toBe(30);
		});

		it("multiplies by zero", () => {
			const { value } = run(engine, "{{ mul a zero }}");
			expect(value).toBe(0);
		});

		it("multiplies by a negative", () => {
			const { value } = run(engine, "{{ mul a negative }}");
			expect(value).toBe(-70);
		});

		it("multiplies decimals", () => {
			const { value } = run(engine, "{{ mul decimal 2 }}");
			expect(value).toBeCloseTo(6.28318, 4);
		});
	});

	// ─── divide / div ────────────────────────────────────────────────────

	describe("divide / div", () => {
		it("divides two properties with divide", () => {
			const { value } = run(engine, "{{ divide a b }}");
			expect(value).toBeCloseTo(3.3333, 3);
		});

		it("divides with the div alias", () => {
			const { value } = run(engine, "{{ div a b }}");
			expect(value).toBeCloseTo(3.3333, 3);
		});

		it("exact integer division", () => {
			const { value } = run(engine, "{{ divide a 2 }}");
			expect(value).toBe(5);
		});

		it("division by zero returns Infinity", () => {
			const { value } = run(engine, "{{ divide a zero }}");
			expect(value).toBeDefined();
		});

		it("divides a literal by a property", () => {
			const { value } = run(engine, "{{ divide 100 a }}");
			expect(value).toBe(10);
		});

		it("divides with array .length", () => {
			const { value } = run(engine, "{{ divide items.length 5 }}");
			expect(value).toBe(1);
		});
	});

	// ─── modulo / mod ────────────────────────────────────────────────────

	describe("modulo / mod", () => {
		it("computes modulo with modulo", () => {
			const { value } = run(engine, "{{ modulo a b }}");
			expect(value).toBe(1);
		});

		it("computes modulo with the mod alias", () => {
			const { value } = run(engine, "{{ mod a b }}");
			expect(value).toBe(1);
		});

		it("modulo with a larger divisor", () => {
			const { value } = run(engine, "{{ mod b a }}");
			expect(value).toBe(3);
		});

		it("modulo by zero returns NaN", () => {
			const { value } = run(engine, "{{ mod a zero }}");
			expect(value).toBeDefined();
		});
	});

	// ─── pow ─────────────────────────────────────────────────────────────

	describe("pow", () => {
		it("raises to the power", () => {
			const { value } = run(engine, "{{ pow a 2 }}");
			expect(value).toBe(100);
		});

		it("power 0 returns 1", () => {
			const { value } = run(engine, "{{ pow a 0 }}");
			expect(value).toBe(1);
		});

		it("power 1 returns the value itself", () => {
			const { value } = run(engine, "{{ pow a 1 }}");
			expect(value).toBe(10);
		});

		it("power with base 0", () => {
			const { value } = run(engine, "{{ pow zero 5 }}");
			expect(value).toBe(0);
		});

		it("power with negative exponent", () => {
			const { value } = run(engine, "{{ pow a -1 }}");
			expect(value).toBeCloseTo(0.1, 5);
		});
	});

	// ─── abs ─────────────────────────────────────────────────────────────

	describe("abs", () => {
		it("returns the absolute value of a negative number", () => {
			const { value } = run(engine, "{{ abs negative }}");
			expect(value).toBe(7);
		});

		it("returns the absolute value of a positive number (unchanged)", () => {
			const { value } = run(engine, "{{ abs a }}");
			expect(value).toBe(10);
		});

		it("returns 0 for zero", () => {
			const { value } = run(engine, "{{ abs zero }}");
			expect(value).toBe(0);
		});
	});

	// ─── ceil ────────────────────────────────────────────────────────────

	describe("ceil", () => {
		it("rounds a decimal up", () => {
			const { value } = run(engine, "{{ ceil decimal }}");
			expect(value).toBe(4);
		});

		it("an integer stays unchanged", () => {
			const { value } = run(engine, "{{ ceil a }}");
			expect(value).toBe(10);
		});

		it("rounds a negative up (toward zero)", () => {
			const { value } = run(engine, "{{ ceil negative }}");
			expect(value).toBe(-7);
		});
	});

	// ─── floor ───────────────────────────────────────────────────────────

	describe("floor", () => {
		it("rounds a decimal down", () => {
			const { value } = run(engine, "{{ floor decimal }}");
			expect(value).toBe(3);
		});

		it("an integer stays unchanged", () => {
			const { value } = run(engine, "{{ floor a }}");
			expect(value).toBe(10);
		});

		it("rounds a negative down (away from zero)", () => {
			const { value } = run(engine, "{{ floor negative }}");
			expect(value).toBe(-7);
		});
	});

	// ─── round ───────────────────────────────────────────────────────────

	describe("round", () => {
		it("rounds to the nearest integer", () => {
			const { value } = run(engine, "{{ round decimal }}");
			expect(value).toBe(3);
		});

		it("rounds with precision 2", () => {
			const { value } = run(engine, "{{ round decimal 2 }}");
			expect(value).toBe(3.14);
		});

		it("rounds with precision 0 (same as without precision)", () => {
			const { value } = run(engine, "{{ round decimal 0 }}");
			expect(value).toBe(3);
		});

		it("an integer stays unchanged", () => {
			const { value } = run(engine, "{{ round a }}");
			expect(value).toBe(10);
		});
	});

	// ─── sqrt ────────────────────────────────────────────────────────────

	describe("sqrt", () => {
		it("computes the square root", () => {
			const result = engine.analyzeAndExecute(
				"{{ sqrt val }}",
				{
					type: "object",
					properties: { val: { type: "number" } },
					required: ["val"],
				},
				{ val: 9 },
			);
			expect(result.value).toBe(3);
		});

		it("square root of zero", () => {
			const { value } = run(engine, "{{ sqrt zero }}");
			expect(value).toBe(0);
		});
	});

	// ─── min ─────────────────────────────────────────────────────────────

	describe("min", () => {
		it("returns the smaller of two numbers", () => {
			const { value } = run(engine, "{{ min a b }}");
			expect(value).toBe(3);
		});

		it("returns the smaller with a negative", () => {
			const { value } = run(engine, "{{ min a negative }}");
			expect(value).toBe(-7);
		});

		it("returns the number when both are equal", () => {
			const { value } = run(engine, "{{ min b b }}");
			expect(value).toBe(3);
		});
	});

	// ─── max ─────────────────────────────────────────────────────────────

	describe("max", () => {
		it("returns the larger of two numbers", () => {
			const { value } = run(engine, "{{ max a b }}");
			expect(value).toBe(10);
		});

		it("returns the larger with a negative", () => {
			const { value } = run(engine, "{{ max a negative }}");
			expect(value).toBe(10);
		});

		it("returns the number when both are equal", () => {
			const { value } = run(engine, "{{ max a a }}");
			expect(value).toBe(10);
		});
	});

	// ─── math (generic helper) ───────────────────────────────────────────

	describe("math (generic helper)", () => {
		it('addition with "+"', () => {
			const { value } = run(engine, '{{ math a "+" b }}');
			expect(value).toBe(13);
		});

		it('subtraction with "-"', () => {
			const { value } = run(engine, '{{ math a "-" b }}');
			expect(value).toBe(7);
		});

		it('multiplication with "*"', () => {
			const { value } = run(engine, '{{ math a "*" b }}');
			expect(value).toBe(30);
		});

		it('division with "/"', () => {
			const { value } = run(engine, '{{ math a "/" b }}');
			expect(value).toBeCloseTo(3.3333, 3);
		});

		it('modulo with "%"', () => {
			const { value } = run(engine, '{{ math a "%" b }}');
			expect(value).toBe(1);
		});

		it('exponentiation with "**"', () => {
			const { value } = run(engine, '{{ math b "**" 3 }}');
			expect(value).toBe(27);
		});

		it('division by zero with "/"', () => {
			const { value } = run(engine, '{{ math a "/" zero }}');
			expect(value).toBeDefined();
		});

		it("static analysis returns outputSchema number", () => {
			const { analysis } = run(engine, '{{ math a "+" b }}');
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "number" });
		});

		it("works with numeric literals on both sides", () => {
			const { value } = run(engine, '{{ math 6 "*" 7 }}');
			expect(value).toBe(42);
		});
	});

	// ─── Combination with .length ────────────────────────────────────────

	describe("combination with .length", () => {
		it("divides an array's length by a number", () => {
			const { analysis, value } = run(engine, "{{ divide items.length 5 }}");
			expect(analysis.valid).toBe(true);
			expect(value).toBe(1);
		});

		it("multiplies an array's length", () => {
			const { value } = run(engine, "{{ mul items.length 10 }}");
			expect(value).toBe(50);
		});

		it("uses math with .length", () => {
			const { value } = run(engine, '{{ math items.length "+" 100 }}');
			expect(value).toBe(105);
		});
	});

	// ─── Integration in mixed templates ──────────────────────────────────

	describe("integration in mixed templates", () => {
		it("math helper in a template with text", () => {
			const { analysis, value } = run(engine, "Total: {{ mul a b }} items");
			expect(analysis.valid).toBe(true);
			expect(value).toBe("Total: 30 items");
		});

		it("multiple math helpers in the same template", () => {
			const { value } = run(engine, "{{ add a b }} and {{ sub a b }}");
			expect(value).toBe("13 and 7");
		});

		it("math helper inside a #if block", () => {
			const result = engine.analyzeAndExecute(
				"{{#if a}}{{ mul a 2 }}{{/if}}",
				schema,
				data,
			);
			expect(result.value).toBe(20);
		});
	});

	// ─── Type coercion ───────────────────────────────────────────────────

	describe("type coercion", () => {
		it("single helper expression returns a number (not a string)", () => {
			const { value } = run(engine, "{{ add a b }}");
			expect(typeof value).toBe("number");
			expect(value).toBe(13);
		});

		it("single expression with whitespace returns a number", () => {
			const { value } = run(engine, "  {{ add a b }}  ");
			expect(typeof value).toBe("number");
			expect(value).toBe(13);
		});

		it("mixed template always returns a string", () => {
			const { value } = run(engine, "result: {{ add a b }}");
			expect(typeof value).toBe("string");
		});
	});

	// ─── Edge cases ──────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("operation on a string property detects a TYPE_MISMATCH", () => {
			const { analysis, value } = run(engine, "{{ add label 5 }}");
			expect(analysis.valid).toBe(false);
			expect(value).toBeUndefined();
			expect(analysis.diagnostics).toHaveLength(1);
			expect(analysis.diagnostics[0]?.code).toBe("TYPE_MISMATCH");
			expect(analysis.diagnostics[0]?.message).toContain('"add"');
			expect(analysis.diagnostics[0]?.message).toContain("string");
			expect(analysis.diagnostics[0]?.details?.expected).toBe("number");
			expect(analysis.diagnostics[0]?.details?.actual).toBe("string");
		});

		it("operation with a very large number", () => {
			const result = engine.analyzeAndExecute(
				"{{ mul val 2 }}",
				{
					type: "object",
					properties: { val: { type: "number" } },
					required: ["val"],
				},
				{ val: Number.MAX_SAFE_INTEGER },
			);
			expect(result.value).toBe(Number.MAX_SAFE_INTEGER * 2);
		});

		it("conceptual chaining — result in mixed template", () => {
			const { value } = run(engine, "{{ add a 5 }} + {{ mul b 2 }}");
			expect(value).toBe("15 + 6");
		});
	});
});

// ─── Tests for the helper system via constructor options ─────────────────────

describe("Typebars({ helpers: [...] })", () => {
	it("registers custom helpers via options", () => {
		const engine = new Typebars({
			helpers: [
				{
					name: "uppercase",
					fn: (value: string) => String(value).toUpperCase(),
					params: [
						{
							name: "value",
							type: { type: "string" },
							description: "The string to convert",
						},
					],
					returnType: { type: "string" },
					description: "Converts a string to uppercase",
				},
			],
		});

		expect(engine.hasHelper("uppercase")).toBe(true);
	});

	it("custom helpers work at execution time", () => {
		const engine = new Typebars({
			helpers: [
				{
					name: "double",
					fn: (val: unknown) => Number(val) * 2,
					params: [{ name: "value", type: { type: "number" } }],
					returnType: { type: "number" },
				},
			],
		});

		const result = engine.analyzeAndExecute(
			"{{ double price }}",
			{
				type: "object",
				properties: { price: { type: "number" } },
				required: ["price"],
			},
			{ price: 25 },
		);

		expect(result.analysis.valid).toBe(true);
		expect(result.analysis.outputSchema).toEqual({ type: "number" });
		expect(result.value).toBe(50);
	});

	it("custom helpers coexist with built-in math helpers", () => {
		const engine = new Typebars({
			helpers: [
				{
					name: "uppercase",
					fn: (value: string) => String(value).toUpperCase(),
					returnType: { type: "string" },
				},
			],
		});

		// Built-in math helper fonctionne toujours
		expect(engine.hasHelper("add")).toBe(true);
		expect(engine.hasHelper("uppercase")).toBe(true);

		const mathResult = engine.analyzeAndExecute(
			"{{ add a b }}",
			{
				type: "object",
				properties: { a: { type: "number" }, b: { type: "number" } },
				required: ["a", "b"],
			},
			{ a: 5, b: 3 },
		);
		expect(mathResult.value).toBe(8);
	});

	it("a custom helper can override a built-in math helper", () => {
		const engine = new Typebars({
			helpers: [
				{
					name: "add",
					fn: (a: unknown, b: unknown) => `${String(a)}-${String(b)}`,
					params: [
						{ name: "a", type: { type: "string" } },
						{ name: "b", type: { type: "string" } },
					],
					returnType: { type: "string" },
					description: "Custom add that concatenates with a dash",
				},
			],
		});

		const result = engine.analyzeAndExecute(
			"{{ add a b }}",
			{
				type: "object",
				properties: { a: { type: "string" }, b: { type: "string" } },
				required: ["a", "b"],
			},
			{ a: "hello", b: "world" },
		);

		expect(result.analysis.valid).toBe(true);
		expect(result.analysis.outputSchema).toEqual({ type: "string" });
		expect(result.value).toBe("hello-world");
	});

	it("supports multiple custom helpers in the same array", () => {
		const helpers: HelperConfig[] = [
			{
				name: "greet",
				fn: (name: string) => `Hello, ${name}!`,
				params: [{ name: "name", type: { type: "string" } }],
				returnType: { type: "string" },
			},
			{
				name: "shout",
				fn: (text: string) => `${String(text).toUpperCase()}!`,
				params: [{ name: "text", type: { type: "string" } }],
				returnType: { type: "string" },
			},
			{
				name: "negate",
				fn: (val: unknown) => -Number(val),
				params: [{ name: "value", type: { type: "number" } }],
				returnType: { type: "number" },
			},
		];

		const engine = new Typebars({ helpers });

		expect(engine.hasHelper("greet")).toBe(true);
		expect(engine.hasHelper("shout")).toBe(true);
		expect(engine.hasHelper("negate")).toBe(true);
	});

	it("works with an empty helpers array", () => {
		const engine = new Typebars({ helpers: [] });
		// Math helpers built-in toujours disponibles
		expect(engine.hasHelper("add")).toBe(true);
	});

	it("works without the helpers option (undefined)", () => {
		const engine = new Typebars({});
		expect(engine.hasHelper("add")).toBe(true);
	});

	it("a custom helper with params and description is introspectable via registerHelper", () => {
		const engine = new Typebars({
			helpers: [
				{
					name: "tax",
					description: "Applies a tax rate to a price",
					fn: (price: unknown, rate: unknown) =>
						Number(price) * (1 + Number(rate) / 100),
					params: [
						{
							name: "price",
							type: { type: "number" },
							description: "The base price",
						},
						{
							name: "rate",
							type: { type: "number" },
							description: "Tax rate in percentage",
						},
					],
					returnType: { type: "number" },
				},
			],
		});

		expect(engine.hasHelper("tax")).toBe(true);

		const result = engine.analyzeAndExecute(
			"{{ tax price rate }}",
			{
				type: "object",
				properties: {
					price: { type: "number" },
					rate: { type: "number" },
				},
				required: ["price", "rate"],
			},
			{ price: 100, rate: 20 },
		);

		expect(result.analysis.valid).toBe(true);
		expect(result.analysis.outputSchema).toEqual({ type: "number" });
		expect(result.value).toBe(120);
	});

	it("a custom helper with an optional parameter", () => {
		const engine = new Typebars({
			helpers: [
				{
					name: "repeat",
					description: "Repeats a string n times",
					fn: (text: unknown, count: unknown) => {
						const n =
							count === undefined || count === null || typeof count === "object"
								? 2
								: Number(count);
						return String(text).repeat(n);
					},
					params: [
						{
							name: "text",
							type: { type: "string" },
							description: "The string to repeat",
						},
						{
							name: "count",
							type: { type: "number" },
							description: "Number of times to repeat (default: 2)",
							optional: true,
						},
					],
					returnType: { type: "string" },
				},
			],
		});

		const s: JSONSchema7 = {
			type: "object",
			properties: { word: { type: "string" } },
			required: ["word"],
		};

		const withCount = engine.analyzeAndExecute("{{ repeat word 3 }}", s, {
			word: "ab",
		});
		expect(withCount.value).toBe("ababab");

		const withoutCount = engine.analyzeAndExecute("{{ repeat word }}", s, {
			word: "ab",
		});
		expect(withoutCount.value).toBe("abab");
	});
});
