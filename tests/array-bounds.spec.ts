import { describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { analyze } from "../src/analyzer.ts";
import { Typebars } from "../src/typebars.ts";
import { userData, userSchema } from "./fixtures.ts";

// ─── Array Bounds (minItems / maxItems) Tests ────────────────────────────────
// Verifies that `aggregateArrayAnalysis` and `aggregateArrayAnalysisAndExecution`
// correctly emit `minItems` and `maxItems` in the output schema, reflecting the
// statically-known element count of literal template arrays.

const engine = new Typebars();

describe("array bounds (minItems / maxItems)", () => {
	// ─── Basic cases ─────────────────────────────────────────────────────────

	describe("basic cases", () => {
		test("empty array → minItems: 0, maxItems: 0", () => {
			const result = engine.analyze([], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: {},
				minItems: 0,
				maxItems: 0,
			});
		});

		test("single template element → minItems: 1, maxItems: 1", () => {
			const result = engine.analyze(["{{name}}"], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
				minItems: 1,
				maxItems: 1,
			});
		});

		test("three template elements → minItems: 3, maxItems: 3", () => {
			const result = engine.analyze(
				["{{name}}", "{{name}}", "{{name}}"],
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
				minItems: 3,
				maxItems: 3,
			});
		});

		test("only literal strings → minItems: 2, maxItems: 2", () => {
			const result = engine.analyze(["hello", "world"], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
				minItems: 2,
				maxItems: 2,
			});
		});

		test("mixed literals and templates → minItems: 2, maxItems: 2", () => {
			const result = engine.analyze(["static", "{{name}}"], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
				minItems: 2,
				maxItems: 2,
			});
		});
	});

	// ─── Primitive literal elements ──────────────────────────────────────────

	describe("primitive literal elements", () => {
		test("array with null literal → minItems: 1, maxItems: 1", () => {
			const result = engine.analyze([null], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "null" },
				minItems: 1,
				maxItems: 1,
			});
		});

		test("array with false literal → minItems: 1, maxItems: 1", () => {
			const result = engine.analyze([false], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "boolean" },
				minItems: 1,
				maxItems: 1,
			});
		});

		test("array with integer literal → minItems: 1, maxItems: 1", () => {
			const result = engine.analyze([42], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "integer" },
				minItems: 1,
				maxItems: 1,
			});
		});

		test("mixed primitive literals → correct count and oneOf", () => {
			const result = engine.analyze([42, true, null, "hello"], userSchema);
			expect(result.valid).toBe(true);
			const schema = result.outputSchema;
			expect(schema).toHaveProperty("minItems", 4);
			expect(schema).toHaveProperty("maxItems", 4);
		});
	});

	// ─── excludeTemplateExpression ───────────────────────────────────────────

	describe("excludeTemplateExpression", () => {
		const opts = { excludeTemplateExpression: true } as const;

		test("all templates excluded → minItems: 0, maxItems: 0", () => {
			const result = engine.analyze(["{{name}}", "{{age}}"], userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: {},
				minItems: 0,
				maxItems: 0,
			});
		});

		test("mix of static and templates — only static kept → minItems: 1, maxItems: 1", () => {
			const result = engine.analyze(["static", "{{name}}"], userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
				minItems: 1,
				maxItems: 1,
			});
		});

		test("only static values — all kept → minItems: 2, maxItems: 2", () => {
			const result = engine.analyze(["hello", "world"], userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
				minItems: 2,
				maxItems: 2,
			});
		});

		test("empty array with excludeTemplateExpression → minItems: 0, maxItems: 0", () => {
			const result = engine.analyze([], userSchema, opts);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: {},
				minItems: 0,
				maxItems: 0,
			});
		});

		test("3-element array with 2 templates excluded → minItems: 1, maxItems: 1", () => {
			const result = engine.analyze(
				["{{name}}", "keep-me", "{{age}}"],
				userSchema,
				opts,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
				minItems: 1,
				maxItems: 1,
			});
		});
	});

	// ─── Nested arrays ──────────────────────────────────────────────────────

	describe("nested arrays", () => {
		test("nested arrays propagate bounds at each level", () => {
			const result = engine.analyze(
				[["{{name}}"], ["{{age}}", "{{active}}"]],
				userSchema,
			);
			expect(result.valid).toBe(true);
			const schema = result.outputSchema;

			// Outer array: 2 elements
			expect(schema).toHaveProperty("minItems", 2);
			expect(schema).toHaveProperty("maxItems", 2);

			// Inner arrays: oneOf with 2 distinct schemas (1-elem and 2-elem)
			const items = (schema as Record<string, unknown>).items as JSONSchema7;
			expect(items).toHaveProperty("oneOf");
			const branches = (items as { oneOf: JSONSchema7[] }).oneOf;
			expect(branches).toHaveLength(2);

			// Each branch should have its own minItems/maxItems
			const branch1 = branches[0] as JSONSchema7;
			const branch2 = branches[1] as JSONSchema7;
			expect(branch1).toHaveProperty("minItems", 1);
			expect(branch1).toHaveProperty("maxItems", 1);
			expect(branch2).toHaveProperty("minItems", 2);
			expect(branch2).toHaveProperty("maxItems", 2);
		});

		test("nested arrays (one optional) → oneOf with bounds", () => {
			const result = engine.analyze(
				[["{{name}}"], ["{{address.city}}"]],
				userSchema,
			);
			expect(result.valid).toBe(true);
			// name is required, address.city is optional → distinct nested arrays
			expect(result.outputSchema).toEqual({
				type: "array",
				items: {
					oneOf: [
						{
							type: "array",
							items: { type: "string" },
							minItems: 1,
							maxItems: 1,
						},
						{
							type: "array",
							items: { type: ["string", "null"] },
							minItems: 1,
							maxItems: 1,
						},
					],
				},
				minItems: 2,
				maxItems: 2,
			});
		});
	});

	// ─── Array inside object ─────────────────────────────────────────────────

	describe("array inside object", () => {
		test("array property in object template (one optional) → oneOf items with bounds", () => {
			const result = engine.analyze(
				{ ids: ["{{name}}", "{{address.city}}"] },
				userSchema,
			);
			expect(result.valid).toBe(true);
			// name is required (string), address.city is optional (string|null)
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					ids: {
						type: "array",
						items: {
							oneOf: [{ type: "string" }, { type: ["string", "null"] }],
						},
						minItems: 2,
						maxItems: 2,
					},
				},
				required: ["ids"],
			});
		});

		test("empty array property in object template → minItems: 0", () => {
			const result = engine.analyze({ list: [] }, userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					list: {
						type: "array",
						items: {},
						minItems: 0,
						maxItems: 0,
					},
				},
				required: ["list"],
			});
		});
	});

	// ─── analyzeAndExecute ──────────────────────────────────────────────────

	describe("analyzeAndExecute", () => {
		test("simple array → bounds in analysis + correct value", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				["{{name}}", "{{age}}"],
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toHaveProperty("minItems", 2);
			expect(analysis.outputSchema).toHaveProperty("maxItems", 2);
			expect(value).toEqual(["Alice", 30]);
		});

		test("empty array → bounds 0 in analysis + empty value", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				[],
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toHaveProperty("minItems", 0);
			expect(analysis.outputSchema).toHaveProperty("maxItems", 0);
			expect(value).toEqual([]);
		});

		test("nested array in object → bounds on inner array", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				{ items: ["{{name}}", "static"] },
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			const props = (
				analysis.outputSchema as { properties: Record<string, JSONSchema7> }
			).properties;
			expect(props.items).toHaveProperty("minItems", 2);
			expect(props.items).toHaveProperty("maxItems", 2);
			expect(value).toEqual({ items: ["Alice", "static"] });
		});

		test("array with literals → bounds match element count", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				[42, true, null],
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toHaveProperty("minItems", 3);
			expect(analysis.outputSchema).toHaveProperty("maxItems", 3);
			expect(value).toEqual([42, true, null]);
		});

		test("nested arrays → bounds at each level", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				[["{{name}}"], ["{{age}}"]],
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			// Outer: 2 elements
			expect(analysis.outputSchema).toHaveProperty("minItems", 2);
			expect(analysis.outputSchema).toHaveProperty("maxItems", 2);
			// Inner items should also have bounds
			const items = (analysis.outputSchema as Record<string, unknown>)
				.items as JSONSchema7;
			if ("oneOf" in items) {
				for (const branch of (items as { oneOf: JSONSchema7[] }).oneOf) {
					expect(branch).toHaveProperty("minItems", 1);
					expect(branch).toHaveProperty("maxItems", 1);
				}
			} else {
				expect(items).toHaveProperty("minItems", 1);
				expect(items).toHaveProperty("maxItems", 1);
			}
			expect(value).toEqual([["Alice"], [30]]);
		});
	});

	// ─── CompiledTemplate ───────────────────────────────────────────────────

	describe("CompiledTemplate", () => {
		test("compiled array analyze → bounds present", () => {
			const tpl = engine.compile(["{{name}}", "{{age}}", "static"]);
			const result = tpl.analyze(userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toHaveProperty("minItems", 3);
			expect(result.outputSchema).toHaveProperty("maxItems", 3);
		});

		test("compiled empty array analyze → bounds 0", () => {
			const tpl = engine.compile([]);
			const result = tpl.analyze(userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toHaveProperty("minItems", 0);
			expect(result.outputSchema).toHaveProperty("maxItems", 0);
		});

		test("compiled array analyzeAndExecute → bounds present", () => {
			const tpl = engine.compile(["{{name}}", "{{age}}"]);
			const { analysis, value } = tpl.analyzeAndExecute(userSchema, userData);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toHaveProperty("minItems", 2);
			expect(analysis.outputSchema).toHaveProperty("maxItems", 2);
			expect(value).toEqual(["Alice", 30]);
		});

		test("compiled nested array → bounds at each level", () => {
			const tpl = engine.compile([["{{name}}"], ["{{age}}"]]);
			const result = tpl.analyze(userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toHaveProperty("minItems", 2);
			expect(result.outputSchema).toHaveProperty("maxItems", 2);
		});
	});

	// ─── Standalone analyze() ───────────────────────────────────────────────

	describe("standalone analyze()", () => {
		test("standalone analyze with array → bounds present", () => {
			const result = analyze(["{{name}}", "{{age}}"], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toHaveProperty("minItems", 2);
			expect(result.outputSchema).toHaveProperty("maxItems", 2);
		});

		test("standalone analyze with empty array → bounds 0", () => {
			const result = analyze([], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toHaveProperty("minItems", 0);
			expect(result.outputSchema).toHaveProperty("maxItems", 0);
		});

		test("standalone analyze with single element → bounds 1", () => {
			const result = analyze(["{{name}}"], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toHaveProperty("minItems", 1);
			expect(result.outputSchema).toHaveProperty("maxItems", 1);
		});
	});

	// ─── Invalid templates still have bounds ────────────────────────────────

	describe("invalid templates still have bounds", () => {
		test("array with invalid property → valid false but bounds present", () => {
			const result = engine.analyze(["{{nope}}", "{{name}}"], userSchema);
			expect(result.valid).toBe(false);
			expect(result.outputSchema).toHaveProperty("minItems", 2);
			expect(result.outputSchema).toHaveProperty("maxItems", 2);
		});

		test("array with all invalid properties → bounds reflect element count", () => {
			const result = engine.analyze(
				["{{bad1}}", "{{bad2}}", "{{bad3}}"],
				userSchema,
			);
			expect(result.valid).toBe(false);
			expect(result.outputSchema).toHaveProperty("minItems", 3);
			expect(result.outputSchema).toHaveProperty("maxItems", 3);
		});
	});

	// ─── minItems and maxItems are always equal ─────────────────────────────

	describe("minItems always equals maxItems (static structure)", () => {
		test("single element", () => {
			const schema = engine.analyze(["{{name}}"], userSchema).outputSchema;
			expect((schema as JSONSchema7).minItems).toBe(
				(schema as JSONSchema7).maxItems,
			);
		});

		test("five elements", () => {
			const schema = engine.analyze(
				["a", "b", "c", "d", "e"],
				userSchema,
			).outputSchema;
			expect((schema as JSONSchema7).minItems).toBe(5);
			expect((schema as JSONSchema7).maxItems).toBe(5);
		});

		test("zero elements", () => {
			const schema = engine.analyze([], userSchema).outputSchema;
			expect((schema as JSONSchema7).minItems).toBe(0);
			expect((schema as JSONSchema7).maxItems).toBe(0);
		});
	});
});
