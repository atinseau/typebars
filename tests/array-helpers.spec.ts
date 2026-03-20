import { describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { Typebars } from "../src/typebars.ts";

// ─── array helper tests ─────────────────────────────────────────────────────

const engine = new Typebars();

// ─── Schema with various types ──────────────────────────────────────────────

const testSchema: JSONSchema7 = {
	type: "object",
	properties: {
		name: { type: "string" },
		status: { type: "string" },
		count: { type: "number" },
		score: { type: "number" },
		active: { type: "boolean" },
		tags: { type: "array", items: { type: "string" } },
	},
	required: ["name", "count"],
};

const testData = {
	name: "Alice",
	status: "active",
	count: 42,
	score: 9.5,
	active: true,
	tags: ["dev", "admin"],
};

// ─── Analysis ───────────────────────────────────────────────────────────────

describe("array helper — analysis", () => {
	test("valid: string args → string array", () => {
		const result = engine.analyze("{{array name status}}", testSchema);
		expect(result.valid).toBe(true);
		expect(
			result.diagnostics.filter((d) => d.severity === "error"),
		).toHaveLength(0);
	});

	test("valid: number args → number array", () => {
		const result = engine.analyze("{{array count score}}", testSchema);
		expect(result.valid).toBe(true);
		expect(
			result.diagnostics.filter((d) => d.severity === "error"),
		).toHaveLength(0);
	});

	test("valid: single argument", () => {
		const result = engine.analyze("{{array name}}", testSchema);
		expect(result.valid).toBe(true);
		expect(
			result.diagnostics.filter((d) => d.severity === "error"),
		).toHaveLength(0);
	});

	test("valid: string literal arguments", () => {
		const result = engine.analyze('{{array "a" "b" "c"}}', testSchema);
		expect(result.valid).toBe(true);
	});

	test("valid: number literal arguments", () => {
		const result = engine.analyze("{{array 1 2 3}}", testSchema);
		expect(result.valid).toBe(true);
	});

	test("valid: sub-expression arguments", () => {
		const result = engine.analyze("{{array (add count 1) 42}}", testSchema);
		expect(result.valid).toBe(true);
	});

	test("valid: mixed expression and literal of same type", () => {
		const result = engine.analyze('{{array name "fallback"}}', testSchema);
		expect(result.valid).toBe(true);
	});

	test("valid: identifier syntax", () => {
		const identifierSchemas = {
			1: {
				type: "object" as const,
				properties: { score: { type: "number" as const } },
				required: ["score"],
			},
		};
		const result = engine.analyze("{{array count score:1}}", testSchema, {
			identifierSchemas,
		});
		expect(result.valid).toBe(true);
	});

	test("error: no arguments", () => {
		// Without args, Handlebars parses "array" as a simple expression, not a helper.
		// It tries to resolve "array" as a property in the schema → PROPERTY_NOT_FOUND.
		const result = engine.analyze("{{array}}", testSchema);
		expect(result.valid).toBe(false);
	});

	test("valid: mixed types (string + number) → heterogeneous array", () => {
		const result = engine.analyze("{{array name count}}", testSchema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema?.type).toBe("array");
	});

	test("valid: mixed types (string + boolean) → heterogeneous array", () => {
		const result = engine.analyze("{{array name active}}", testSchema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema?.type).toBe("array");
	});

	// ── Output schema inference ──────────────────────────────────────────

	test("output schema: string args → { type: array, items: string }", () => {
		const result = engine.analyze("{{array name status}}", testSchema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({
			type: "array",
			items: { type: "string" },
		});
	});

	test("output schema: number args → { type: array, items: number }", () => {
		const result = engine.analyze("{{array count score}}", testSchema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({
			type: "array",
			items: { type: "number" },
		});
	});

	test("output schema: single string arg → { type: array, items: string }", () => {
		const result = engine.analyze("{{array name}}", testSchema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({
			type: "array",
			items: { type: "string" },
		});
	});

	test("output schema: literal strings → { type: array, items: string }", () => {
		const result = engine.analyze('{{array "a" "b"}}', testSchema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({
			type: "array",
			items: { type: "string" },
		});
	});

	test("output schema: number literals → { type: array, items: number }", () => {
		const result = engine.analyze("{{array 1 2 3}}", testSchema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({
			type: "array",
			items: { type: "number" },
		});
	});

	test("output schema: sub-expression result → number array", () => {
		const result = engine.analyze("{{array (add count 1) 42}}", testSchema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({
			type: "array",
			items: { type: "number" },
		});
	});
});

// ─── Sub-expression analysis ────────────────────────────────────────────────

describe("array helper — sub-expression analysis", () => {
	test("valid: array as sub-expression in if block", () => {
		const result = engine.analyze(
			'{{#if (array name "test")}}has value{{/if}}',
			testSchema,
		);
		expect(result.valid).toBe(true);
	});

	test("valid: sub-expression with mixed types", () => {
		const result = engine.analyze(
			"{{#if (array name count)}}has value{{/if}}",
			testSchema,
		);
		expect(result.valid).toBe(true);
	});
});

// ─── Execution ──────────────────────────────────────────────────────────────

describe("array helper — execution", () => {
	test("returns array of resolved string values", () => {
		const result = engine.execute("{{array name status}}", testData);
		expect(result).toEqual(["Alice", "active"]);
	});

	test("returns array of resolved number values", () => {
		const result = engine.execute("{{array count score}}", testData);
		expect(result).toEqual([42, 9.5]);
	});

	test("returns array with literal string values", () => {
		const result = engine.execute('{{array "a" "b" "c"}}', testData);
		expect(result).toEqual(["a", "b", "c"]);
	});

	test("returns array with literal number values", () => {
		const result = engine.execute("{{array 1 2 3}}", testData);
		expect(result).toEqual([1, 2, 3]);
	});

	test("returns array with sub-expression results", () => {
		const result = engine.execute("{{array (add count 1) 42}}", testData);
		expect(result).toEqual([43, 42]);
	});

	test("returns array with single element", () => {
		const result = engine.execute("{{array name}}", testData);
		expect(result).toEqual(["Alice"]);
	});

	test("returns array with mixed expressions and literals", () => {
		const result = engine.execute('{{array name "Bob"}}', testData);
		expect(result).toEqual(["Alice", "Bob"]);
	});

	test("handles undefined values (optional properties)", () => {
		const result = engine.execute("{{array name status}}", {
			name: "Alice",
		});
		expect(result).toEqual(["Alice", undefined]);
	});
});

// ─── Integration with object templates ──────────────────────────────────────

describe("array helper — object template integration", () => {
	test("valid: array helper in array-typed property", () => {
		const coerceSchema: JSONSchema7 = {
			type: "object",
			properties: {
				items: { type: "array", items: { type: "string" } },
			},
		};
		const result = engine.analyze(
			{ items: "{{array name status}}" },
			testSchema,
			{ coerceSchema },
		);
		expect(result.valid).toBe(true);
	});

	test("execution: array helper in object template", () => {
		const result = engine.execute({ items: "{{array name status}}" }, testData);
		expect(result).toEqual({ items: ["Alice", "active"] });
	});

	test("execution: array helper with numbers in object template", () => {
		const result = engine.execute(
			{ scores: "{{array count score}}" },
			testData,
		);
		expect(result).toEqual({ scores: [42, 9.5] });
	});

	test("execution: array helper with sub-expressions in object template", () => {
		const result = engine.execute(
			{ values: "{{array (add count 1) 42}}" },
			testData,
		);
		expect(result).toEqual({ values: [43, 42] });
	});
});

// ─── Exotic / edge-case tests ───────────────────────────────────────────────

describe("array helper — nested object templates", () => {
	test("execution: array in deeply nested object", () => {
		const result = engine.execute(
			{
				level1: {
					level2: {
						tags: "{{array name status}}",
					},
				},
			},
			testData,
		);
		expect(result).toEqual({
			level1: {
				level2: {
					tags: ["Alice", "active"],
				},
			},
		});
	});

	test("execution: multiple array helpers in sibling properties", () => {
		const result = engine.execute(
			{
				names: "{{array name status}}",
				numbers: "{{array count score}}",
			},
			testData,
		);
		expect(result).toEqual({
			names: ["Alice", "active"],
			numbers: [42, 9.5],
		});
	});

	test("execution: array helper alongside regular templates in nested object", () => {
		const result = engine.execute(
			{
				info: {
					label: "{{name}}",
					tags: '{{array name "extra"}}',
					count: "{{count}}",
				},
			},
			testData,
		);
		expect(result).toEqual({
			info: {
				label: "Alice",
				tags: ["Alice", "extra"],
				count: 42,
			},
		});
	});

	test("execution: array helper at multiple nesting levels", () => {
		const result = engine.execute(
			{
				topTags: "{{array name status}}",
				nested: {
					innerTags: '{{array "x" "y" "z"}}',
				},
			},
			testData,
		);
		expect(result).toEqual({
			topTags: ["Alice", "active"],
			nested: {
				innerTags: ["x", "y", "z"],
			},
		});
	});

	test("execution: array inside a 3-level deep object", () => {
		const result = engine.execute(
			{
				a: {
					b: {
						c: {
							values: "{{array count score}}",
						},
					},
				},
			},
			testData,
		);
		const a = result as Record<string, unknown>;
		const b = (a.a as Record<string, unknown>).b as Record<string, unknown>;
		const c = b.c as Record<string, unknown>;
		expect(c.values).toEqual([42, 9.5]);
		expect(Array.isArray(c.values)).toBe(true);
	});
});

describe("array helper — output schema with mixed / union types", () => {
	test("output schema: number + string args → oneOf union in items", () => {
		// Uses a permissive schema where the property has no type constraint
		const permissiveSchema: JSONSchema7 = {
			type: "object",
			properties: {
				a: {},
				b: {},
			},
			required: ["a", "b"],
		};
		const result = engine.analyze("{{array a b}}", permissiveSchema);
		// Both args have no type info → should be valid (no type to compare)
		expect(result.valid).toBe(true);
		expect(result.outputSchema?.type).toBe("array");
	});

	test("output schema: integer is compatible with number", () => {
		const schemaWithInteger: JSONSchema7 = {
			type: "object",
			properties: {
				intVal: { type: "integer" },
				numVal: { type: "number" },
			},
			required: ["intVal", "numVal"],
		};
		const result = engine.analyze("{{array intVal numVal}}", schemaWithInteger);
		// integer is compatible with number
		expect(result.valid).toBe(true);
		expect(result.outputSchema?.type).toBe("array");
	});

	test("output schema: number literal + number expression → number items", () => {
		const result = engine.analyze("{{array count 100}}", testSchema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({
			type: "array",
			items: { type: "number" },
		});
	});

	test("output schema: string + number → oneOf union in items", () => {
		const result = engine.analyze("{{array name count}}", testSchema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({
			type: "array",
			items: { oneOf: [{ type: "string" }, { type: "number" }] },
		});
	});

	test("output schema: string + boolean → oneOf union in items", () => {
		const result = engine.analyze("{{array name active}}", testSchema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({
			type: "array",
			items: { oneOf: [{ type: "string" }, { type: "boolean" }] },
		});
	});

	test("output schema: string + number + boolean → oneOf union in items", () => {
		const result = engine.analyze("{{array name count active}}", testSchema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({
			type: "array",
			items: {
				oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
			},
		});
	});
});

describe("array helper — conditional blocks (#if)", () => {
	test("execution: array in #if true branch", () => {
		const result = engine.execute(
			"{{#if active}}{{array name status}}{{/if}}",
			testData,
		);
		expect(result).toEqual(["Alice", "active"]);
	});

	test("execution: array in #if false branch → empty string", () => {
		const result = engine.execute(
			"{{#if active}}{{array name status}}{{/if}}",
			{ active: false, name: "Alice", status: "active" },
		);
		expect(result).toBe("");
	});

	test("execution: array in #if else branch", () => {
		const result = engine.execute(
			'{{#if active}}{{array name status}}{{else}}{{array "none"}}{{/if}}',
			{ active: false, name: "Alice", status: "active" },
		);
		expect(result).toEqual(["none"]);
	});
});

describe("array helper — many arguments", () => {
	test("execution: 5+ arguments", () => {
		const result = engine.execute('{{array "a" "b" "c" "d" "e" "f"}}', {});
		expect(result).toEqual(["a", "b", "c", "d", "e", "f"]);
	});

	test("analysis: 5+ literal arguments → valid", () => {
		const result = engine.analyze('{{array "a" "b" "c" "d" "e"}}', testSchema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({
			type: "array",
			items: { type: "string" },
		});
	});
});

describe("array helper — analyzeAndExecute", () => {
	test("nested object with array helper → analysis valid + execution returns array", () => {
		const { analysis, value } = engine.analyzeAndExecute(
			{
				meta: {
					tags: "{{array name status}}",
				},
			},
			testSchema,
			testData,
		);
		expect(analysis.valid).toBe(true);
		expect(value).toEqual({
			meta: {
				tags: ["Alice", "active"],
			},
		});
		const tags = (
			(value as Record<string, unknown>).meta as Record<string, unknown>
		).tags;
		expect(Array.isArray(tags)).toBe(true);
	});

	test("analyzeAndExecute: mixed types → valid with heterogeneous array", () => {
		const { analysis, value } = engine.analyzeAndExecute(
			{ items: "{{array name count}}" },
			testSchema,
			testData,
		);
		expect(analysis.valid).toBe(true);
		expect(value).toEqual({ items: ["Alice", 42] });
	});
});

describe("array helper — compiled template", () => {
	test("compiled template preserves array in nested object", () => {
		const compiled = engine.compile({
			data: {
				ids: "{{array name status}}",
			},
		});
		const result = compiled.execute(testData);
		expect(result).toEqual({
			data: {
				ids: ["Alice", "active"],
			},
		});
		const ids = (
			(result as Record<string, unknown>).data as Record<string, unknown>
		).ids;
		expect(Array.isArray(ids)).toBe(true);
	});

	test("compiled template: array with sub-expressions", () => {
		const compiled = engine.compile({
			values: "{{array (add count 1) score}}",
		});
		const result = compiled.execute(testData);
		expect(result).toEqual({
			values: [43, 9.5],
		});
	});
});
