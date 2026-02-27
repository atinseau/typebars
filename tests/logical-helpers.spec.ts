import { beforeEach, describe, expect, it } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { LogicalHelpers } from "../src/helpers/logical-helpers.ts";
import { Typebars } from "../src/typebars.ts";

const logicalHelpers = new LogicalHelpers();

// ─── Shared schema & data ────────────────────────────────────────────────────

const schema: JSONSchema7 = {
	type: "object",
	properties: {
		a: { type: "number" },
		b: { type: "number" },
		zero: { type: "number" },
		negative: { type: "number" },
		name: { type: "string" },
		other: { type: "string" },
		active: { type: "boolean" },
		inactive: { type: "boolean" },
		tags: { type: "array", items: { type: "string" } },
		status: { type: "string" },
		empty: { type: "string" },
		count: { type: "number" },
	},
	required: [
		"a",
		"b",
		"zero",
		"negative",
		"name",
		"other",
		"active",
		"inactive",
		"tags",
		"status",
		"empty",
		"count",
	],
} as const;

const data = {
	a: 10,
	b: 3,
	zero: 0,
	negative: -7,
	name: "Alice",
	other: "Bob",
	active: true,
	inactive: false,
	tags: ["developer", "typescript", "open-source"],
	status: "active",
	empty: "",
	count: 5,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function run(engine: Typebars, template: string) {
	return engine.analyzeAndExecute(template, schema, data);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("LogicalHelpers", () => {
	let engine: Typebars;

	beforeEach(() => {
		engine = new Typebars();
	});

	// ─── Built-in registration ───────────────────────────────────────────

	describe("pre-registration (built-in)", () => {
		it("all logical helpers are available without calling register()", () => {
			const names = logicalHelpers.getHelperNames();
			for (const name of names) {
				expect(engine.hasHelper(name)).toBe(true);
			}
		});

		it("a fresh engine can directly use logical helpers", () => {
			const { analysis, value } = run(
				engine,
				'{{#if (eq name "Alice")}}yes{{else}}no{{/if}}',
			);
			expect(analysis.valid).toBe(true);
			expect(value).toBe("yes");
		});
	});

	// ─── Register / unregister ─────────────────────────────────────────

	describe("explicit register / unregister", () => {
		it("unregister removes all helpers", () => {
			logicalHelpers.unregister(engine);
			const names = logicalHelpers.getHelperNames();
			for (const name of names) {
				expect(engine.hasHelper(name)).toBe(false);
			}
		});

		it("register re-registers after an unregister", () => {
			logicalHelpers.unregister(engine);
			expect(engine.hasHelper("eq")).toBe(false);

			logicalHelpers.register(engine);
			expect(engine.hasHelper("eq")).toBe(true);
		});

		it("register is idempotent (no error if called twice)", () => {
			logicalHelpers.register(engine);
			expect(engine.hasHelper("eq")).toBe(true);
		});
	});

	// ─── getDefinitions ────────────────────────────────────────────────

	describe("getDefinitions", () => {
		it("returns a Map with all definitions", () => {
			const defs = logicalHelpers.getDefinitions();
			expect(defs).toBeInstanceOf(Map);
			expect(defs.size).toBeGreaterThanOrEqual(
				logicalHelpers.getHelperNames().length,
			);
		});

		it("every definition has fn and returnType boolean", () => {
			const defs = logicalHelpers.getDefinitions();
			for (const [, def] of defs) {
				expect(typeof def.fn).toBe("function");
				expect(def.returnType).toEqual({ type: "boolean" });
			}
		});
	});

	// ─── params metadata ──────────────────────────────────────────────

	describe("params metadata", () => {
		it("every definition has a non-empty params array", () => {
			const defs = logicalHelpers.getDefinitions();
			for (const [_name, def] of defs) {
				expect(def.params).toBeDefined();
				expect(def.params?.length).toBeGreaterThan(0);
			}
		});

		it("every param has a name", () => {
			const defs = logicalHelpers.getDefinitions();
			for (const [, def] of defs) {
				for (const param of def.params ?? []) {
					expect(typeof param.name).toBe("string");
					expect(param.name.length).toBeGreaterThan(0);
				}
			}
		});

		it("every definition has a description", () => {
			const defs = logicalHelpers.getDefinitions();
			for (const [, def] of defs) {
				expect(typeof def.description).toBe("string");
				expect(def.description?.length).toBeGreaterThan(0);
			}
		});

		it("compare has an operator parameter with enum", () => {
			const defs = logicalHelpers.getDefinitions();
			const compareDef = defs.get("compare");
			expect(compareDef).toBeDefined();
			expect(compareDef?.params?.length).toBe(3);

			const operatorParam = compareDef?.params?.[1];
			expect(operatorParam?.name).toBe("operator");
			expect(operatorParam?.type).toEqual({
				type: "string",
				enum: ["==", "===", "!=", "!==", "<", "<=", ">", ">="],
			});
		});

		it("not has exactly 1 param", () => {
			const defs = logicalHelpers.getDefinitions();
			const notDef = defs.get("not");
			expect(notDef?.params?.length).toBe(1);
		});

		it("binary helpers have exactly 2 params", () => {
			const defs = logicalHelpers.getDefinitions();
			const binaryHelpers = [
				"eq",
				"ne",
				"lt",
				"lte",
				"gt",
				"gte",
				"and",
				"or",
				"contains",
			];
			for (const name of binaryHelpers) {
				const def = defs.get(name);
				expect(def?.params?.length).toBe(2);
			}
		});
	});

	// ─── isHelper ─────────────────────────────────────────────────────

	describe("isHelper", () => {
		it("returns true for a known logical helper", () => {
			expect(logicalHelpers.isHelper("eq")).toBe(true);
			expect(logicalHelpers.isHelper("lt")).toBe(true);
			expect(logicalHelpers.isHelper("not")).toBe(true);
			expect(logicalHelpers.isHelper("compare")).toBe(true);
		});

		it("returns false for an unknown helper", () => {
			expect(logicalHelpers.isHelper("add")).toBe(false);
			expect(logicalHelpers.isHelper("unknown")).toBe(false);
		});
	});

	// ─── eq ────────────────────────────────────────────────────────────

	describe("eq", () => {
		it("returns true for equal values", () => {
			const { value } = run(
				engine,
				'{{#if (eq name "Alice")}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("returns false for different values", () => {
			const { value } = run(
				engine,
				'{{#if (eq name "Bob")}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("no");
		});

		it("compares numbers", () => {
			const { value } = run(engine, "{{#if (eq a 10)}}yes{{else}}no{{/if}}");
			expect(value).toBe("yes");
		});

		it("strict equality — number vs string is false", () => {
			const { value } = run(engine, '{{#if (eq a "10")}}yes{{else}}no{{/if}}');
			expect(value).toBe("no");
		});

		it("compares booleans", () => {
			const { value } = run(
				engine,
				"{{#if (eq active true)}}yes{{else}}no{{/if}}",
			);
			expect(value).toBe("yes");
		});

		it("static analysis returns valid", () => {
			const { analysis } = run(engine, "{{#if (eq a b)}}yes{{else}}no{{/if}}");
			expect(analysis.valid).toBe(true);
		});
	});

	// ─── ne / neq ─────────────────────────────────────────────────────

	describe("ne / neq", () => {
		it("returns true for different values", () => {
			const { value } = run(
				engine,
				'{{#if (ne name "Bob")}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("returns false for equal values", () => {
			const { value } = run(
				engine,
				'{{#if (ne name "Alice")}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("no");
		});

		it("neq alias works identically", () => {
			const { value } = run(
				engine,
				'{{#if (neq name "Bob")}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("compares numbers", () => {
			const { value } = run(engine, "{{#if (ne a 5)}}yes{{else}}no{{/if}}");
			expect(value).toBe("yes");
		});
	});

	// ─── lt ────────────────────────────────────────────────────────────

	describe("lt", () => {
		it("returns true when a < b", () => {
			const { value } = run(engine, "{{#if (lt b a)}}yes{{else}}no{{/if}}");
			expect(value).toBe("yes");
		});

		it("returns false when a >= b", () => {
			const { value } = run(engine, "{{#if (lt a b)}}yes{{else}}no{{/if}}");
			expect(value).toBe("no");
		});

		it("returns false when equal", () => {
			const { value } = run(engine, "{{#if (lt a 10)}}yes{{else}}no{{/if}}");
			expect(value).toBe("no");
		});

		it("works with negative numbers", () => {
			const { value } = run(
				engine,
				"{{#if (lt negative zero)}}yes{{else}}no{{/if}}",
			);
			expect(value).toBe("yes");
		});

		it("works with a literal on the right", () => {
			const { value } = run(
				engine,
				"{{#if (lt count 500)}}low{{else}}high{{/if}}",
			);
			expect(value).toBe("low");
		});
	});

	// ─── lte / le ─────────────────────────────────────────────────────

	describe("lte / le", () => {
		it("returns true when a < b", () => {
			const { value } = run(engine, "{{#if (lte b a)}}yes{{else}}no{{/if}}");
			expect(value).toBe("yes");
		});

		it("returns true when equal", () => {
			const { value } = run(engine, "{{#if (lte a 10)}}yes{{else}}no{{/if}}");
			expect(value).toBe("yes");
		});

		it("returns false when a > b", () => {
			const { value } = run(engine, "{{#if (lte a b)}}yes{{else}}no{{/if}}");
			expect(value).toBe("no");
		});

		it("le alias works identically", () => {
			const { value } = run(engine, "{{#if (le a 10)}}yes{{else}}no{{/if}}");
			expect(value).toBe("yes");
		});
	});

	// ─── gt ────────────────────────────────────────────────────────────

	describe("gt", () => {
		it("returns true when a > b", () => {
			const { value } = run(engine, "{{#if (gt a b)}}yes{{else}}no{{/if}}");
			expect(value).toBe("yes");
		});

		it("returns false when a <= b", () => {
			const { value } = run(engine, "{{#if (gt b a)}}yes{{else}}no{{/if}}");
			expect(value).toBe("no");
		});

		it("returns false when equal", () => {
			const { value } = run(engine, "{{#if (gt a 10)}}yes{{else}}no{{/if}}");
			expect(value).toBe("no");
		});

		it("works with negative numbers", () => {
			const { value } = run(
				engine,
				"{{#if (gt zero negative)}}yes{{else}}no{{/if}}",
			);
			expect(value).toBe("yes");
		});
	});

	// ─── gte / ge ─────────────────────────────────────────────────────

	describe("gte / ge", () => {
		it("returns true when a > b", () => {
			const { value } = run(engine, "{{#if (gte a b)}}yes{{else}}no{{/if}}");
			expect(value).toBe("yes");
		});

		it("returns true when equal", () => {
			const { value } = run(engine, "{{#if (gte a 10)}}yes{{else}}no{{/if}}");
			expect(value).toBe("yes");
		});

		it("returns false when a < b", () => {
			const { value } = run(engine, "{{#if (gte b a)}}yes{{else}}no{{/if}}");
			expect(value).toBe("no");
		});

		it("ge alias works identically", () => {
			const { value } = run(engine, "{{#if (ge a 10)}}yes{{else}}no{{/if}}");
			expect(value).toBe("yes");
		});
	});

	// ─── not ───────────────────────────────────────────────────────────

	describe("not", () => {
		it("returns true for a falsy value (false)", () => {
			const { value } = run(
				engine,
				"{{#if (not inactive)}}yes{{else}}no{{/if}}",
			);
			expect(value).toBe("yes");
		});

		it("returns false for a truthy value (true)", () => {
			const { value } = run(engine, "{{#if (not active)}}yes{{else}}no{{/if}}");
			expect(value).toBe("no");
		});

		it("returns true for zero", () => {
			const { value } = run(engine, "{{#if (not zero)}}yes{{else}}no{{/if}}");
			expect(value).toBe("yes");
		});

		it("returns true for empty string", () => {
			const { value } = run(engine, "{{#if (not empty)}}yes{{else}}no{{/if}}");
			expect(value).toBe("yes");
		});

		it("returns false for a non-empty string", () => {
			const { value } = run(engine, "{{#if (not name)}}yes{{else}}no{{/if}}");
			expect(value).toBe("no");
		});
	});

	// ─── and ───────────────────────────────────────────────────────────

	describe("and", () => {
		it("returns true when both values are truthy", () => {
			const { value } = run(
				engine,
				"{{#if (and active name)}}yes{{else}}no{{/if}}",
			);
			expect(value).toBe("yes");
		});

		it("returns false when first is falsy", () => {
			const { value } = run(
				engine,
				"{{#if (and inactive name)}}yes{{else}}no{{/if}}",
			);
			expect(value).toBe("no");
		});

		it("returns false when second is falsy", () => {
			const { value } = run(
				engine,
				"{{#if (and active inactive)}}yes{{else}}no{{/if}}",
			);
			expect(value).toBe("no");
		});

		it("returns false when both are falsy", () => {
			const { value } = run(
				engine,
				"{{#if (and inactive zero)}}yes{{else}}no{{/if}}",
			);
			expect(value).toBe("no");
		});
	});

	// ─── or ────────────────────────────────────────────────────────────

	describe("or", () => {
		it("returns true when both values are truthy", () => {
			const { value } = run(
				engine,
				"{{#if (or active name)}}yes{{else}}no{{/if}}",
			);
			expect(value).toBe("yes");
		});

		it("returns true when first is truthy", () => {
			const { value } = run(
				engine,
				"{{#if (or active inactive)}}yes{{else}}no{{/if}}",
			);
			expect(value).toBe("yes");
		});

		it("returns true when second is truthy", () => {
			const { value } = run(
				engine,
				"{{#if (or inactive name)}}yes{{else}}no{{/if}}",
			);
			expect(value).toBe("yes");
		});

		it("returns false when both are falsy", () => {
			const { value } = run(
				engine,
				"{{#if (or inactive zero)}}yes{{else}}no{{/if}}",
			);
			expect(value).toBe("no");
		});
	});

	// ─── contains ──────────────────────────────────────────────────────

	describe("contains", () => {
		it("returns true when string contains substring", () => {
			const { value } = run(
				engine,
				'{{#if (contains name "lic")}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("returns false when string does not contain substring", () => {
			const { value } = run(
				engine,
				'{{#if (contains name "xyz")}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("no");
		});

		it("returns true when array contains element", () => {
			const { value } = run(
				engine,
				'{{#if (contains tags "typescript")}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("returns false when array does not contain element", () => {
			const { value } = run(
				engine,
				'{{#if (contains tags "python")}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("no");
		});

		it("is case-sensitive for strings", () => {
			const { value } = run(
				engine,
				'{{#if (contains name "alice")}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("no");
		});
	});

	// ─── in ────────────────────────────────────────────────────────────

	describe("in", () => {
		it("returns true when value is in the list", () => {
			const { value } = run(
				engine,
				'{{#if (in status "active" "pending" "draft")}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("returns false when value is not in the list", () => {
			const { value } = run(
				engine,
				'{{#if (in status "closed" "archived")}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("no");
		});

		it("works with a single candidate", () => {
			const { value } = run(
				engine,
				'{{#if (in status "active")}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("works with boolean values", () => {
			const { value } = run(
				engine,
				"{{#if (in active true)}}yes{{else}}no{{/if}}",
			);
			expect(value).toBe("yes");
		});
	});

	// ─── compare (generic helper) ─────────────────────────────────────

	describe("compare (generic helper)", () => {
		it("strict equality with ===", () => {
			const { value } = run(
				engine,
				'{{#if (compare name "===" "Alice")}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("strict inequality with !==", () => {
			const { value } = run(
				engine,
				'{{#if (compare name "!==" "Bob")}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("loose equality with ==", () => {
			const { value } = run(
				engine,
				'{{#if (compare a "==" 10)}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("loose inequality with !=", () => {
			const { value } = run(
				engine,
				'{{#if (compare a "!=" 5)}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("less than with <", () => {
			const { value } = run(
				engine,
				'{{#if (compare b "<" a)}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("less than or equal with <=", () => {
			const { value } = run(
				engine,
				'{{#if (compare a "<=" 10)}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("greater than with >", () => {
			const { value } = run(
				engine,
				'{{#if (compare a ">" b)}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("greater than or equal with >=", () => {
			const { value } = run(
				engine,
				'{{#if (compare a ">=" 10)}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("static analysis returns valid", () => {
			const { analysis } = run(
				engine,
				'{{#if (compare a "<" b)}}yes{{else}}no{{/if}}',
			);
			expect(analysis.valid).toBe(true);
		});
	});

	// ─── Combination with other helpers ────────────────────────────────

	describe("combination with other helpers", () => {
		it("nested logical helpers: and + eq", () => {
			const { value } = run(
				engine,
				'{{#if (and (eq name "Alice") active)}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("nested logical helpers: or + not", () => {
			const { value } = run(
				engine,
				'{{#if (or (not active) (eq name "Alice"))}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("logical helpers with math helpers", () => {
			const { value } = run(
				engine,
				"{{#if (gt (add a b) 10)}}big{{else}}small{{/if}}",
			);
			expect(value).toBe("big");
		});

		it("lt inside a conditional block", () => {
			const { value } = run(
				engine,
				"{{#if (lt count 500)}}low{{else}}high{{/if}}",
			);
			expect(value).toBe("low");
		});
	});

	// ─── Integration in templates ──────────────────────────────────────

	describe("integration in templates", () => {
		it("logical helper in a template with text", () => {
			const { analysis, value } = run(
				engine,
				'Status: {{#if (eq status "active")}}ON{{else}}OFF{{/if}}',
			);
			expect(analysis.valid).toBe(true);
			expect(value).toBe("Status: ON");
		});

		it("multiple logical checks in the same template", () => {
			const { value } = run(
				engine,
				"{{#if (gt a 5)}}big{{else}}small{{/if}}-{{#if (lt b 5)}}low{{else}}high{{/if}}",
			);
			expect(value).toBe("big-low");
		});

		it("logical helper with #each", () => {
			const { analysis, value } = run(
				engine,
				"{{#if (gt tags.length 0)}}has tags{{else}}no tags{{/if}}",
			);
			expect(analysis.valid).toBe(true);
			expect(value).toBe("has tags");
		});
	});

	// ─── Edge cases ────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("eq with zero and false are not equal (strict)", () => {
			const { value } = run(
				engine,
				"{{#if (eq zero false)}}yes{{else}}no{{/if}}",
			);
			expect(value).toBe("no");
		});

		it("ne with zero and false are not equal (strict) → true", () => {
			const { value } = run(
				engine,
				"{{#if (ne zero false)}}yes{{else}}no{{/if}}",
			);
			expect(value).toBe("yes");
		});

		it("not with a truthy number returns false", () => {
			const { value } = run(engine, "{{#if (not a)}}yes{{else}}no{{/if}}");
			expect(value).toBe("no");
		});

		it("contains with empty string always matches", () => {
			const { value } = run(
				engine,
				'{{#if (contains name "")}}yes{{else}}no{{/if}}',
			);
			expect(value).toBe("yes");
		});

		it("lt with equal values returns false", () => {
			const { value } = run(engine, "{{#if (lt a a)}}yes{{else}}no{{/if}}");
			expect(value).toBe("no");
		});

		it("gt with equal values returns false", () => {
			const { value } = run(engine, "{{#if (gt a a)}}yes{{else}}no{{/if}}");
			expect(value).toBe("no");
		});

		it("lte with equal values returns true", () => {
			const { value } = run(engine, "{{#if (lte a a)}}yes{{else}}no{{/if}}");
			expect(value).toBe("yes");
		});

		it("gte with equal values returns true", () => {
			const { value } = run(engine, "{{#if (gte a a)}}yes{{else}}no{{/if}}");
			expect(value).toBe("yes");
		});
	});

	// ─── Coexistence with math helpers ─────────────────────────────────

	describe("coexistence with math helpers", () => {
		it("math helpers are still available alongside logical helpers", () => {
			expect(engine.hasHelper("add")).toBe(true);
			expect(engine.hasHelper("eq")).toBe(true);
		});

		it("unregistering logical helpers does not affect math helpers", () => {
			logicalHelpers.unregister(engine);
			expect(engine.hasHelper("add")).toBe(true);
			expect(engine.hasHelper("mul")).toBe(true);
			expect(engine.hasHelper("eq")).toBe(false);
		});
	});
});
