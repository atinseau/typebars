import { describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { Typebars } from "../src/typebars.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const usersSchema: JSONSchema7 = {
	type: "object",
	properties: {
		users: {
			type: "array",
			items: {
				type: "object",
				properties: {
					name: { type: "string" },
					age: { type: "number" },
					active: { type: "boolean" },
					score: { type: "integer" },
				},
			},
		},
		tags: {
			type: "array",
			items: { type: "string" },
		},
		label: { type: "string" },
		count: { type: "number" },
		nested: {
			type: "object",
			properties: {
				items: {
					type: "array",
					items: {
						type: "object",
						properties: {
							id: { type: "number" },
							value: { type: "string" },
						},
					},
				},
			},
		},
	},
};

const usersData = {
	users: [
		{ name: "Alice", age: 30, active: true, score: 95 },
		{ name: "Bob", age: 25, active: false, score: 80 },
		{ name: "Charlie", age: 35, active: true, score: 70 },
	],
	tags: ["a", "b", "c"],
	label: "test",
	count: 42,
	nested: {
		items: [
			{ id: 1, value: "first" },
			{ id: 2, value: "second" },
		],
	},
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("map helper", () => {
	// ── Execution ────────────────────────────────────────────────────────

	describe("execution", () => {
		test("extracts string property from array of objects → string[]", () => {
			const tp = new Typebars();
			const result = tp.execute(`{{ map users "name" }}`, usersData);
			expect(result).toEqual(["Alice", "Bob", "Charlie"]);
		});

		test("extracts number property from array of objects → number[]", () => {
			const tp = new Typebars();
			const result = tp.execute(`{{ map users "age" }}`, usersData);
			expect(result).toEqual([30, 25, 35]);
		});

		test("extracts boolean property from array of objects → boolean[]", () => {
			const tp = new Typebars();
			const result = tp.execute(`{{ map users "active" }}`, usersData);
			expect(result).toEqual([true, false, true]);
		});

		test("extracts integer property from array of objects → number[]", () => {
			const tp = new Typebars();
			const result = tp.execute(`{{ map users "score" }}`, usersData);
			expect(result).toEqual([95, 80, 70]);
		});

		test("extracts property from nested array → value[]", () => {
			const tp = new Typebars();
			const result = tp.execute(`{{ map nested.items "value" }}`, usersData);
			expect(result).toEqual(["first", "second"]);
		});

		test("extracts number property from nested array → number[]", () => {
			const tp = new Typebars();
			const result = tp.execute(`{{ map nested.items "id" }}`, usersData);
			expect(result).toEqual([1, 2]);
		});

		test("returns empty array when the mapion is empty", () => {
			const tp = new Typebars();
			const result = tp.execute(`{{ map users "name" }}`, { users: [] });
			expect(result).toEqual([]);
		});

		test("returns empty array when the mapion is not an array", () => {
			const tp = new Typebars();
			const result = tp.execute(`{{ map label "name" }}`, usersData);
			expect(result).toEqual([]);
		});

		test("returns undefined values for items missing the property", () => {
			const tp = new Typebars();
			const result = tp.execute(`{{ map users "missing" }}`, usersData);
			expect(result).toEqual([undefined, undefined, undefined]);
		});

		test("handles single-element arrays", () => {
			const tp = new Typebars();
			const result = tp.execute(`{{ map users "name" }}`, {
				users: [{ name: "Solo" }],
			});
			expect(result).toEqual(["Solo"]);
		});

		test("returns array (not string) even with whitespace around expression", () => {
			const tp = new Typebars();
			const result = tp.execute(`  {{ map users "name" }}  `, usersData);
			expect(result).toEqual(["Alice", "Bob", "Charlie"]);
		});

		test("works with Typebars.compile() pattern", () => {
			const tp = new Typebars();
			const compiled = tp.compile(`{{ map users "name" }}`);
			const result = compiled.execute(usersData);
			expect(result).toEqual(["Alice", "Bob", "Charlie"]);
		});

		test("works with analyzeAndExecute()", () => {
			const tp = new Typebars();
			const { analysis, value } = tp.analyzeAndExecute(
				`{{ map users "name" }}`,
				usersSchema,
				usersData,
			);
			expect(analysis.valid).toBe(true);
			expect(value).toEqual(["Alice", "Bob", "Charlie"]);
		});
	});

	// ── Static Analysis — valid cases ────────────────────────────────────

	describe("static analysis — valid cases", () => {
		test("valid: string property → output schema is { type: 'array', items: { type: 'string' } }", () => {
			const tp = new Typebars();
			const result = tp.analyze(`{{ map users "name" }}`, usersSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("valid: number property → output schema is { type: 'array', items: { type: 'number' } }", () => {
			const tp = new Typebars();
			const result = tp.analyze(`{{ map users "age" }}`, usersSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "number" },
			});
		});

		test("valid: boolean property → output schema is { type: 'array', items: { type: 'boolean' } }", () => {
			const tp = new Typebars();
			const result = tp.analyze(`{{ map users "active" }}`, usersSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "boolean" },
			});
		});

		test("valid: integer property → output schema is { type: 'array', items: { type: 'integer' } }", () => {
			const tp = new Typebars();
			const result = tp.analyze(`{{ map users "score" }}`, usersSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "integer" },
			});
		});

		test("valid: nested array path → correct output schema", () => {
			const tp = new Typebars();
			const result = tp.analyze(`{{ map nested.items "value" }}`, usersSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("valid: nested array with number property → correct output schema", () => {
			const tp = new Typebars();
			const result = tp.analyze(`{{ map nested.items "id" }}`, usersSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "number" },
			});
		});
	});

	// ── Static Analysis — invalid cases ──────────────────────────────────

	describe("static analysis — invalid cases", () => {
		test("invalid: first argument is not an array → TYPE_MISMATCH", () => {
			const tp = new Typebars();
			const result = tp.analyze(`{{ map label "name" }}`, usersSchema);
			expect(result.valid).toBe(false);
			expect(result.diagnostics.length).toBeGreaterThan(0);
			const error = result.diagnostics.find((d) => d.code === "TYPE_MISMATCH");
			expect(error).toBeDefined();
			expect(error?.severity).toBe("error");
			expect(error?.message).toContain("map");
			expect(error?.message).toContain("array");
		});

		test("invalid: first argument is a number → TYPE_MISMATCH", () => {
			const tp = new Typebars();
			const result = tp.analyze(`{{ map count "name" }}`, usersSchema);
			expect(result.valid).toBe(false);
			const error = result.diagnostics.find((d) => d.code === "TYPE_MISMATCH");
			expect(error).toBeDefined();
			expect(error?.message).toContain("array");
		});

		test("invalid: array of non-objects (string[]) → TYPE_MISMATCH", () => {
			const tp = new Typebars();
			const result = tp.analyze(`{{ map tags "name" }}`, usersSchema);
			expect(result.valid).toBe(false);
			const error = result.diagnostics.find((d) => d.code === "TYPE_MISMATCH");
			expect(error).toBeDefined();
			expect(error?.message).toContain("array of objects");
		});

		test("invalid: property does not exist in item schema → UNKNOWN_PROPERTY", () => {
			const tp = new Typebars();
			const result = tp.analyze(`{{ map users "nonexistent" }}`, usersSchema);
			expect(result.valid).toBe(false);
			const error = result.diagnostics.find(
				(d) => d.code === "UNKNOWN_PROPERTY",
			);
			expect(error).toBeDefined();
			expect(error?.message).toContain("nonexistent");
		});

		test("invalid: mapion path does not exist → UNKNOWN_PROPERTY", () => {
			const tp = new Typebars();
			const result = tp.analyze(`{{ map unknownArray "name" }}`, usersSchema);
			expect(result.valid).toBe(false);
			const error = result.diagnostics.find(
				(d) => d.code === "UNKNOWN_PROPERTY",
			);
			expect(error).toBeDefined();
			expect(error?.message).toContain("unknownArray");
		});

		test("invalid: missing arguments (0 args) → MISSING_ARGUMENT", () => {
			const tp = new Typebars();
			// Handlebars parses `{{ map }}` as a simple expression, not a helper.
			// We need at least 1 param for it to be recognized as a helper call.
			// With 1 param it triggers MISSING_ARGUMENT since map needs 2.
			const result = tp.analyze("{{ map users }}", usersSchema);
			expect(result.valid).toBe(false);
			const error = result.diagnostics.find(
				(d) => d.code === "MISSING_ARGUMENT",
			);
			expect(error).toBeDefined();
			expect(error?.message).toContain("2");
		});
	});

	// ── Edge cases ───────────────────────────────────────────────────────

	describe("edge cases", () => {
		test("map is registered as a built-in helper", () => {
			const tp = new Typebars();
			expect(tp.hasHelper("map")).toBe(true);
		});

		test("works with $ref in schema", () => {
			const schema: JSONSchema7 = {
				type: "object",
				definitions: {
					User: {
						type: "object",
						properties: {
							name: { type: "string" },
						},
					},
				},
				properties: {
					users: {
						type: "array",
						items: { $ref: "#/definitions/User" },
					},
				},
			};
			const tp = new Typebars();
			const analysis = tp.analyze(`{{ map users "name" }}`, schema);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("works with additionalProperties in item schema", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					items: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: { type: "string" },
						},
					},
				},
			};
			const tp = new Typebars();
			const analysis = tp.analyze(`{{ map items "whatever" }}`, schema);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("array with no items schema → item type is unknown, property resolves to unknown", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					things: { type: "array" },
				},
			};
			const tp = new Typebars();
			// The items schema is {} (unknown), so any property access
			// should fail because there's no properties defined.
			const analysis = tp.analyze(`{{ map things "name" }}`, schema);
			// The items schema is {} which has no `type` and no `properties`,
			// so we can't confirm it's an object. However, it also has no
			// type at all, so the isObject check will pass the !itemType case.
			// Then resolving "name" on {} should fail → UNKNOWN_PROPERTY.
			expect(analysis.valid).toBe(false);
		});

		test("execution with object template containing map", () => {
			const tp = new Typebars();
			const result = tp.execute(
				{
					names: `{{ map users "name" }}`,
					ages: `{{ map users "age" }}`,
				},
				usersData,
			);
			expect(result).toEqual({
				names: ["Alice", "Bob", "Charlie"],
				ages: [30, 25, 35],
			});
		});

		test("analysis of object template containing map", () => {
			const tp = new Typebars();
			const result = tp.analyze(
				{
					names: `{{ map users "name" }}`,
					ages: `{{ map users "age" }}`,
				},
				usersSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					names: { type: "array", items: { type: "string" } },
					ages: { type: "array", items: { type: "number" } },
				},
				required: ["names", "ages"],
			});
		});

		test("schema with oneOf array items", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					mixed: {
						type: "array",
						items: {
							oneOf: [
								{
									type: "object",
									properties: { name: { type: "string" } },
								},
								{
									type: "object",
									properties: { name: { type: "number" } },
								},
							],
						},
					},
				},
			};
			const tp = new Typebars();
			const analysis = tp.analyze(`{{ map mixed "name" }}`, schema);
			// The items have oneOf, which is complex — this may or may not resolve
			// depending on how the schema resolver handles the combinator.
			// The key thing is it should not crash.
			expect(typeof analysis.valid).toBe("boolean");
		});

		test("execution preserves original value types in the array", () => {
			const tp = new Typebars();
			const data = {
				items: [{ val: 0 }, { val: null }, { val: "" }, { val: false }],
			};
			const result = tp.execute(`{{ map items "val" }}`, data);
			expect(result).toEqual([0, null, "", false]);
		});
	});

	// ── Bare-identifier rejection ────────────────────────────────────────
	// The property argument of `map` MUST be a quoted string literal.
	// A bare identifier like `name` is parsed by Handlebars as a PathExpression
	// and resolved as a data path, which silently yields `undefined` at runtime.
	// The analyzer must reject this with a clear error message.

	describe("bare-identifier rejection", () => {
		test("{{ map users name }} (bare identifier) → TYPE_MISMATCH error", () => {
			const tp = new Typebars();
			const result = tp.analyze("{{ map users name }}", usersSchema);
			expect(result.valid).toBe(false);
			const error = result.diagnostics.find((d) => d.code === "TYPE_MISMATCH");
			expect(error).toBeDefined();
			expect(error?.message).toContain("quoted string");
			expect(error?.message).toContain('"name"');
		});

		test("{{ map users age }} (bare identifier) → TYPE_MISMATCH error", () => {
			const tp = new Typebars();
			const result = tp.analyze("{{ map users age }}", usersSchema);
			expect(result.valid).toBe(false);
			const error = result.diagnostics.find((d) => d.code === "TYPE_MISMATCH");
			expect(error).toBeDefined();
			expect(error?.message).toContain('"age"');
		});

		test("error message suggests correct syntax with quotes", () => {
			const tp = new Typebars();
			const result = tp.analyze("{{ map users name }}", usersSchema);
			expect(result.valid).toBe(false);
			const error = result.diagnostics.find((d) => d.code === "TYPE_MISMATCH");
			expect(error).toBeDefined();
			// The error message should guide the user to the correct syntax
			expect(error?.message).toMatch(/map.*"name"/);
		});

		test("bare identifier in nested path → TYPE_MISMATCH error", () => {
			const tp = new Typebars();
			const result = tp.analyze("{{ map nested.items value }}", usersSchema);
			expect(result.valid).toBe(false);
			const error = result.diagnostics.find((d) => d.code === "TYPE_MISMATCH");
			expect(error).toBeDefined();
			expect(error?.message).toContain('"value"');
		});

		test("details include expected StringLiteral and actual PathExpression", () => {
			const tp = new Typebars();
			const result = tp.analyze("{{ map users name }}", usersSchema);
			expect(result.valid).toBe(false);
			const error = result.diagnostics.find((d) => d.code === "TYPE_MISMATCH");
			expect(error?.details?.expected).toContain("StringLiteral");
			expect(error?.details?.actual).toContain("PathExpression");
		});
	});

	// ── Pre-execution validation ─────────────────────────────────────────

	describe("pre-execution validation", () => {
		test("execute with schema validation — valid case does not throw", () => {
			const tp = new Typebars();
			const result = tp.execute(`{{ map users "name" }}`, usersData, {
				schema: usersSchema,
			});
			expect(result).toEqual(["Alice", "Bob", "Charlie"]);
		});

		test("execute with schema validation — invalid mapion throws TemplateAnalysisError", () => {
			const tp = new Typebars();
			expect(() => {
				tp.execute(`{{ map label "name" }}`, usersData, {
					schema: usersSchema,
				});
			}).toThrow();
		});

		test("execute with schema validation — unknown property throws TemplateAnalysisError", () => {
			const tp = new Typebars();
			expect(() => {
				tp.execute(`{{ map users "nonexistent" }}`, usersData, {
					schema: usersSchema,
				});
			}).toThrow();
		});
	});

	// ── Mixed template contexts (map inside multi-expression templates) ──

	describe("mixed template — map joins array with ', '", () => {
		test("map in mixed template → array joined with ', '", () => {
			const tp = new Typebars();
			const result = tp.execute(`Names: {{ map users "name" }}`, usersData);
			expect(result).toBe("Names: Alice, Bob, Charlie");
		});

		test("map + other expression in multiline template → proper join", () => {
			const tp = new Typebars();
			const result = tp.execute(
				`{{ map users "name" }} ({{ count }})`,
				usersData,
			);
			expect(result).toBe("Alice, Bob, Charlie (42)");
		});

		test("map number property in mixed template → numbers joined", () => {
			const tp = new Typebars();
			const result = tp.execute(`Ages: {{ map users "age" }}`, usersData);
			expect(result).toBe("Ages: 30, 25, 35");
		});

		test("map boolean property in mixed template → booleans joined", () => {
			const tp = new Typebars();
			const result = tp.execute(`Active: {{ map users "active" }}`, usersData);
			expect(result).toBe("Active: true, false, true");
		});

		test("map from nested array in mixed template → proper join", () => {
			const tp = new Typebars();
			const result = tp.execute(
				`Values: {{ map nested.items "value" }}`,
				usersData,
			);
			expect(result).toBe("Values: first, second");
		});

		test("map empty array in mixed template → empty string segment", () => {
			const tp = new Typebars();
			const result = tp.execute(`Names: {{ map users "name" }}`, {
				users: [],
			});
			expect(result).toBe("Names: ");
		});

		test("multiple map calls in the same mixed template", () => {
			const tp = new Typebars();
			const result = tp.execute(
				`{{ map users "name" }} / {{ map users "age" }}`,
				usersData,
			);
			expect(result).toBe("Alice, Bob, Charlie / 30, 25, 35");
		});

		test("map in multiline mixed template with whitespace", () => {
			const tp = new Typebars();
			const template = `
  {{ map users "name" }}
  {{ users.length }}
`;
			const result = tp.execute(template, usersData);
			expect(typeof result).toBe("string");
			expect((result as string).trim()).toBe("Alice, Bob, Charlie\n  3");
		});

		test("map inside #if block in mixed template", () => {
			const tp = new Typebars();
			const result = tp.execute(
				`{{#if users}}{{ map users "name" }}{{/if}} done`,
				usersData,
			);
			expect(result).toBe("Alice, Bob, Charlie done");
		});

		test("map with Typebars.compile() in mixed template", () => {
			const tp = new Typebars();
			const compiled = tp.compile(`Names: {{ map users "name" }}!`);
			const result = compiled.execute(usersData);
			expect(result).toBe("Names: Alice, Bob, Charlie!");
		});

		test("single-element array in mixed template → no trailing comma", () => {
			const tp = new Typebars();
			const result = tp.execute(`Name: {{ map users "name" }}`, {
				users: [{ name: "Solo" }],
			});
			expect(result).toBe("Name: Solo");
		});

		test("single expression (no mix) still returns raw array", () => {
			const tp = new Typebars();
			const result = tp.execute(`{{ map users "name" }}`, usersData);
			expect(result).toEqual(["Alice", "Bob", "Charlie"]);
		});

		test("single expression with whitespace still returns raw array", () => {
			const tp = new Typebars();
			const result = tp.execute(`  {{ map users "name" }}  `, usersData);
			expect(result).toEqual(["Alice", "Bob", "Charlie"]);
		});

		test("map with string literal works natively through Handlebars in mixed template", () => {
			const tp = new Typebars();
			// With quoted string, Handlebars passes the string "name" correctly
			// to the map helper — no special pre-resolution needed
			const result = tp.execute(
				`{{ map users "name" }} (count: {{ count }})`,
				usersData,
			);
			expect(result).toBe("Alice, Bob, Charlie (count: 42)");
		});
	});

	// ─── Nested map (sub-expression) ─────────────────────────────────

	describe("nested map (sub-expression)", () => {
		const nestedSchema: JSONSchema7 = {
			type: "object",
			properties: {
				users: {
					type: "array",
					items: {
						type: "object",
						properties: {
							name: { type: "string" },
							cartItems: {
								type: "array",
								items: {
									type: "object",
									properties: {
										productId: { type: "string" },
										quantity: { type: "number" },
									},
									required: ["productId", "quantity"],
								},
							},
						},
					},
				},
			},
			required: ["users"],
		};

		const nestedData = {
			users: [
				{
					name: "Alice",
					cartItems: [{ productId: "p1", quantity: 2 }],
				},
				{
					name: "Bob",
					cartItems: [{ productId: "p2", quantity: 1 }],
				},
				{
					name: "Charlie",
					cartItems: [{ productId: "p3", quantity: 5 }],
				},
			],
		};

		// ── Execution ────────────────────────────────────────────────────

		test("nested map extracts property from flattened sub-arrays → string[]", () => {
			const tp = new Typebars();
			const result = tp.execute(
				`{{ map (map users 'cartItems') 'productId' }}`,
				nestedData,
			);
			expect(result).toEqual(["p1", "p2", "p3"]);
		});

		test("nested map extracts number property from flattened sub-arrays → number[]", () => {
			const tp = new Typebars();
			const result = tp.execute(
				`{{ map (map users 'cartItems') 'quantity' }}`,
				nestedData,
			);
			expect(result).toEqual([2, 1, 5]);
		});

		test("nested map with empty outer array → empty array", () => {
			const tp = new Typebars();
			const result = tp.execute(
				`{{ map (map users 'cartItems') 'productId' }}`,
				{ users: [] },
			);
			expect(result).toEqual([]);
		});

		test("nested map with empty inner arrays → empty array", () => {
			const tp = new Typebars();
			const result = tp.execute(
				`{{ map (map users 'cartItems') 'productId' }}`,
				{
					users: [
						{ name: "Alice", cartItems: [] },
						{ name: "Bob", cartItems: [] },
					],
				},
			);
			expect(result).toEqual([]);
		});

		test("nested map with multiple items per user → flattened result", () => {
			const tp = new Typebars();
			const result = tp.execute(
				`{{ map (map users 'cartItems') 'productId' }}`,
				{
					users: [
						{
							name: "Alice",
							cartItems: [
								{ productId: "p1", quantity: 1 },
								{ productId: "p2", quantity: 3 },
							],
						},
						{
							name: "Bob",
							cartItems: [{ productId: "p3", quantity: 2 }],
						},
					],
				},
			);
			expect(result).toEqual(["p1", "p2", "p3"]);
		});

		test("nested map works with analyzeAndExecute()", () => {
			const tp = new Typebars();
			const { analysis, value } = tp.analyzeAndExecute(
				`{{ map (map users 'cartItems') 'productId' }}`,
				nestedSchema,
				nestedData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.diagnostics).toHaveLength(0);
			expect(value).toEqual(["p1", "p2", "p3"]);
		});

		test("nested map works with compile() pattern", () => {
			const tp = new Typebars();
			const compiled = tp.compile(
				`{{ map (map users 'cartItems') 'productId' }}`,
			);
			const result = compiled.execute(nestedData);
			expect(result).toEqual(["p1", "p2", "p3"]);
		});

		// ── Static analysis — valid cases ────────────────────────────────

		test("valid: nested map → output schema { type: 'array', items: { type: 'string' } }", () => {
			const tp = new Typebars();
			const result = tp.analyze(
				`{{ map (map users 'cartItems') 'productId' }}`,
				nestedSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("valid: nested map with number property → output schema { type: 'array', items: { type: 'number' } }", () => {
			const tp = new Typebars();
			const result = tp.analyze(
				`{{ map (map users 'cartItems') 'quantity' }}`,
				nestedSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "number" },
			});
		});

		// ── Static analysis — invalid cases ──────────────────────────────

		test("invalid: nested map with unknown inner property → UNKNOWN_PROPERTY", () => {
			const tp = new Typebars();
			const result = tp.analyze(
				`{{ map (map users 'nonExistent') 'productId' }}`,
				nestedSchema,
			);
			expect(result.valid).toBe(false);
			const error = result.diagnostics.find(
				(d) => d.code === "UNKNOWN_PROPERTY",
			);
			expect(error).toBeDefined();
			expect(error?.message).toContain("nonExistent");
		});

		test("invalid: nested map with unknown outer property → UNKNOWN_PROPERTY", () => {
			const tp = new Typebars();
			const result = tp.analyze(
				`{{ map (map users 'cartItems') 'nonExistent' }}`,
				nestedSchema,
			);
			expect(result.valid).toBe(false);
			const error = result.diagnostics.find(
				(d) => d.code === "UNKNOWN_PROPERTY",
			);
			expect(error).toBeDefined();
			expect(error?.message).toContain("nonExistent");
		});

		test("invalid: nested map with bare identifier in sub-expression → TYPE_MISMATCH", () => {
			const tp = new Typebars();
			const result = tp.analyze(
				`{{ map (map users cartItems) 'productId' }}`,
				nestedSchema,
			);
			expect(result.valid).toBe(false);
			const error = result.diagnostics.find((d) => d.code === "TYPE_MISMATCH");
			expect(error).toBeDefined();
			expect(error?.message).toContain("quoted string");
		});

		test("invalid: nested map missing inner arguments → MISSING_ARGUMENT", () => {
			const tp = new Typebars();
			const result = tp.analyze(
				`{{ map (map users) 'productId' }}`,
				nestedSchema,
			);
			expect(result.valid).toBe(false);
			const error = result.diagnostics.find(
				(d) => d.code === "MISSING_ARGUMENT",
			);
			expect(error).toBeDefined();
		});
	});
});
