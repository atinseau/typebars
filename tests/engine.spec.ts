import { beforeEach, describe, expect, test } from "bun:test";
import { analyze } from "../src/analyzer.ts";
import { TemplateAnalysisError } from "../src/errors.ts";
import { clearCompilationCache, execute } from "../src/executor.ts";
import { Typebars } from "../src/typebars.ts";
import { userData, userSchema } from "./fixtures.ts";

describe("Typebars", () => {
	beforeEach(() => {
		clearCompilationCache();
	});

	describe("isValidSyntax", () => {
		const engine = new Typebars();

		test("returns true for a valid simple template", () => {
			expect(engine.isValidSyntax("Hello {{name}}")).toBe(true);
		});

		test("returns true for a valid block", () => {
			expect(engine.isValidSyntax("{{#if x}}yes{{/if}}")).toBe(true);
		});

		test("returns false for an incorrect closing tag", () => {
			expect(engine.isValidSyntax("{{#if x}}oops{{/each}}")).toBe(false);
		});

		test("returns false for an unclosed block", () => {
			expect(engine.isValidSyntax("{{#if x}}")).toBe(false);
		});

		test("returns true for plain text", () => {
			expect(engine.isValidSyntax("no expressions")).toBe(true);
		});

		test("returns true for an empty template", () => {
			expect(engine.isValidSyntax("")).toBe(true);
		});
	});

	describe("strict mode (default)", () => {
		const engine = new Typebars();

		test("execute throws TemplateAnalysisError when schema invalidates the template", () => {
			expect(() =>
				engine.execute("{{badProp}}", { badProp: "x" }, { schema: userSchema }),
			).toThrow(TemplateAnalysisError);
		});

		test("execute works when schema validates the template", () => {
			const result = engine.execute("{{name}}", userData, {
				schema: userSchema,
			});
			expect(result).toBe("Alice");
		});

		test("execute works without schema (no validation)", () => {
			const result = engine.execute("{{anything}}", { anything: 42 });
			expect(result).toBe(42);
		});
	});

	describe("analyze", () => {
		const engine = new Typebars();

		test("returns an AnalysisResult with valid, diagnostics, outputSchema", () => {
			const result = engine.analyze("{{name}}", userSchema);
			expect(result).toHaveProperty("valid");
			expect(result).toHaveProperty("diagnostics");
			expect(result).toHaveProperty("outputSchema");
		});

		test("outputSchema reflects the type of a single expression", () => {
			expect(engine.analyze("{{age}}", userSchema).outputSchema).toEqual({
				type: "number",
			});
		});

		test("outputSchema is string for a mixed template", () => {
			expect(engine.analyze("Hello {{name}}", userSchema).outputSchema).toEqual(
				{ type: "string" },
			);
		});
	});

	describe("analyzeAndExecute", () => {
		const engine = new Typebars();

		test("returns analysis and value when the template is valid", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				"{{age}}",
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "number" });
			expect(value).toBe(30);
		});

		test("returns undefined value when the template is invalid in strict mode", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				"{{badProp}}",
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(false);
			expect(value).toBeUndefined();
		});
	});
});

describe("literal input (non-string TemplateInput)", () => {
	beforeEach(() => {
		clearCompilationCache();
	});

	const engine = new Typebars();

	describe("analyze", () => {
		test("integer number → { type: 'integer' }", () => {
			const result = engine.analyze(10, { type: "number" });
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test("decimal number → { type: 'number' }", () => {
			const result = engine.analyze(3.14, { type: "number" });
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("number 0 → { type: 'integer' }", () => {
			const result = engine.analyze(0, { type: "number" });
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test("negative number → { type: 'integer' }", () => {
			const result = engine.analyze(-5, { type: "number" });
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test("boolean true → { type: 'boolean' }", () => {
			const result = engine.analyze(true, { type: "boolean" });
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		});

		test("boolean false → { type: 'boolean' }", () => {
			const result = engine.analyze(false, { type: "boolean" });
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		});

		test("null → { type: 'null' }", () => {
			const result = engine.analyze(null, { type: "null" });
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
			expect(result.outputSchema).toEqual({ type: "null" });
		});

		test("inputSchema is ignored for literals", () => {
			const result = engine.analyze(42, userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test("identifierSchemas is ignored for literals", () => {
			const result = engine.analyze(42, userSchema, {
				identifierSchemas: {
					1: { type: "object", properties: { x: { type: "string" } } },
				},
			});
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});
	});

	describe("execute", () => {
		test("number returns the value as-is", () => {
			expect(engine.execute(10, {})).toBe(10);
		});

		test("number 0 returns 0", () => {
			expect(engine.execute(0, {})).toBe(0);
		});

		test("decimal number returns the value", () => {
			expect(engine.execute(3.14, {})).toBe(3.14);
		});

		test("negative number returns the value", () => {
			expect(engine.execute(-42, {})).toBe(-42);
		});

		test("boolean true returns true", () => {
			expect(engine.execute(true, {})).toBe(true);
		});

		test("boolean false returns false", () => {
			expect(engine.execute(false, {})).toBe(false);
		});

		test("null returns null", () => {
			expect(engine.execute(null, {})).toBe(null);
		});

		test("data is ignored for literals", () => {
			expect(engine.execute(99, userData)).toBe(99);
		});

		test("schema is ignored for literals (no validation)", () => {
			expect(engine.execute(99, userData, { schema: userSchema })).toBe(99);
		});
	});

	describe("validate", () => {
		test("number is always valid", () => {
			const result = engine.validate(42, userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});

		test("boolean is always valid", () => {
			const result = engine.validate(true, userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});

		test("null is always valid", () => {
			const result = engine.validate(null, userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});
	});

	describe("isValidSyntax", () => {
		test("number is syntactically valid", () => {
			expect(engine.isValidSyntax(42)).toBe(true);
		});

		test("boolean is syntactically valid", () => {
			expect(engine.isValidSyntax(false)).toBe(true);
		});

		test("null is syntactically valid", () => {
			expect(engine.isValidSyntax(null)).toBe(true);
		});
	});

	describe("compile", () => {
		test("compiles a number and executes → returns the value", () => {
			const tpl = engine.compile(42);
			expect(tpl.execute({})).toBe(42);
		});

		test("compiles a boolean and executes → returns the value", () => {
			const tpl = engine.compile(true);
			expect(tpl.execute({})).toBe(true);
		});

		test("compiles null and executes → returns null", () => {
			const tpl = engine.compile(null);
			expect(tpl.execute({})).toBe(null);
		});

		test("compiles a number and analyzes → outputSchema integer", () => {
			const tpl = engine.compile(10);
			const result = tpl.analyze(userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test("compiles a decimal and analyzes → outputSchema number", () => {
			const tpl = engine.compile(3.14);
			const result = tpl.analyze(userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("compiles a boolean and analyzes → outputSchema boolean", () => {
			const tpl = engine.compile(false);
			const result = tpl.analyze(userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		});

		test("compiles null and analyzes → outputSchema null", () => {
			const tpl = engine.compile(null);
			const result = tpl.analyze(userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "null" });
		});

		test("compiles a number and validates → always valid", () => {
			const tpl = engine.compile(42);
			const result = tpl.validate(userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});
	});

	describe("analyzeAndExecute", () => {
		test("number → valid analysis + value returned", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				10,
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "integer" });
			expect(value).toBe(10);
		});

		test("boolean → valid analysis + value returned", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				false,
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "boolean" });
			expect(value).toBe(false);
		});

		test("null → valid analysis + value returned", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				null,
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "null" });
			expect(value).toBe(null);
		});

		test("number 0 → valid analysis + value 0 (not falsy)", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				0,
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "integer" });
			expect(value).toBe(0);
		});
	});

	describe("standalone functions", () => {
		test("analyze() standalone with number", () => {
			const result = analyze(42, { type: "number" });
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test("analyze() standalone with boolean", () => {
			const result = analyze(true, { type: "boolean" });
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		});

		test("analyze() standalone with null", () => {
			const result = analyze(null, { type: "null" });
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "null" });
		});

		test("execute() standalone with number", () => {
			expect(execute(42, {})).toBe(42);
		});

		test("execute() standalone with boolean", () => {
			expect(execute(false, {})).toBe(false);
		});

		test("execute() standalone with null", () => {
			expect(execute(null, {})).toBe(null);
		});

		test("execute() standalone with 0", () => {
			expect(execute(0, {})).toBe(0);
		});
	});
});

describe("object template input (TemplateInputObject)", () => {
	beforeEach(() => {
		clearCompilationCache();
	});

	const engine = new Typebars();

	describe("analyze", () => {
		test("simple object with string templates → outputSchema object with resolved types", () => {
			const result = engine.analyze(
				{
					userName: "{{name}}",
					userAge: "{{age}}",
				},
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					userName: { type: "string" },
					userAge: { type: "number" },
				},
				required: ["userName", "userAge"],
			});
		});

		test("object with static string value → outputSchema string for that property", () => {
			const result = engine.analyze(
				{
					userName: "{{name}}",
					status: "success",
				},
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					userName: { type: "string" },
					status: { type: "string" },
				},
				required: ["userName", "status"],
			});
		});

		test("object with primitive literals → correctly inferred types", () => {
			const result = engine.analyze(
				{
					num: 42,
					flag: true,
					nothing: null,
				},
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					num: { type: "integer" },
					flag: { type: "boolean" },
					nothing: { type: "null" },
				},
				required: ["num", "flag", "nothing"],
			});
		});

		test("object with missing property → valid false + diagnostic", () => {
			const result = engine.analyze(
				{
					userName: "{{name}}",
					bad: "{{doesNotExist}}",
				},
				userSchema,
			);
			expect(result.valid).toBe(false);
			expect(result.diagnostics.length).toBeGreaterThan(0);
			expect(result.diagnostics[0]?.code).toBe("UNKNOWN_PROPERTY");
		});

		test("object with multiple errors → all diagnostics reported", () => {
			const result = engine.analyze(
				{
					a: "{{foo}}",
					b: "{{bar}}",
					c: "{{name}}",
				},
				userSchema,
			);
			expect(result.valid).toBe(false);
			const errors = result.diagnostics.filter((d) => d.severity === "error");
			expect(errors.length).toBe(2);
		});

		test("object with nested sub-object → nested outputSchema", () => {
			const result = engine.analyze(
				{
					user: {
						name: "{{name}}",
						age: "{{age}}",
					},
					meta: {
						active: "{{active}}",
					},
				},
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					user: {
						type: "object",
						properties: {
							name: { type: "string" },
							age: { type: "number" },
						},
						required: ["name", "age"],
					},
					meta: {
						type: "object",
						properties: {
							active: { type: "boolean" },
						},
						required: ["active"],
					},
				},
				required: ["user", "meta"],
			});
		});

		test("empty object → empty object outputSchema", () => {
			const result = engine.analyze({}, userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {},
				required: [],
			});
		});

		test("mixed object with templates + literals + nested → correct types", () => {
			const result = engine.analyze(
				{
					greeting: "Hello {{name}}",
					age: "{{age}}",
					count: 10,
					active: true,
					nested: {
						city: "{{address.city}}",
						fixed: 99,
					},
				},
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					greeting: { type: "string" },
					age: { type: "number" },
					count: { type: "integer" },
					active: { type: "boolean" },
					nested: {
						type: "object",
						properties: {
							city: { type: "string" },
							fixed: { type: "integer" },
						},
						required: ["city", "fixed"],
					},
				},
				required: ["greeting", "age", "count", "active", "nested"],
			});
		});

		describe("default behavior — no coercion from inputSchema", () => {
			test("string template '123' with inputSchema type string → detectLiteralType → number", () => {
				const result = engine.analyze("123", { type: "string" });
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "number" });
			});

			test("string template 'true' with inputSchema type string → detectLiteralType → boolean", () => {
				const result = engine.analyze("true", { type: "string" });
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "boolean" });
			});

			test("string template 'null' with inputSchema type string → detectLiteralType → null", () => {
				const result = engine.analyze("null", { type: "string" });
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "null" });
			});

			test("object template '123' with inputSchema string property → detectLiteralType → number", () => {
				// inputSchema should NOT influence output type coercion
				const result = engine.analyze(
					{ meetingId: "123" },
					{
						type: "object",
						properties: { meetingId: { type: "string" } },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({
					type: "object",
					properties: {
						meetingId: { type: "number" },
					},
					required: ["meetingId"],
				});
			});

			test("object template with non-numeric string → always string", () => {
				const result = engine.analyze(
					{ status: "success" },
					{
						type: "object",
						properties: { status: { type: "string" } },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({
					type: "object",
					properties: {
						status: { type: "string" },
					},
					required: ["status"],
				});
			});

			test("Handlebars expression resolves from inputSchema as usual", () => {
				const result = engine.analyze("{{name}}", userSchema);
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "string" });
			});
		});

		describe("explicit coerceSchema — overrides detectLiteralType", () => {
			test("string template '123' with coerceSchema string → outputSchema string", () => {
				const result = engine.analyze(
					"123",
					{ type: "string" },
					{
						coerceSchema: { type: "string" },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "string", const: "123" });
			});

			test("string template '123' with coerceSchema number → outputSchema number", () => {
				const result = engine.analyze(
					"123",
					{ type: "string" },
					{
						coerceSchema: { type: "number" },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "number", const: 123 });
			});

			test("string template 'true' with coerceSchema string → outputSchema string", () => {
				const result = engine.analyze(
					"true",
					{ type: "object", properties: {} },
					{
						coerceSchema: { type: "string" },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "string", const: "true" });
			});

			test("string template '123' with coerceSchema integer → outputSchema integer", () => {
				const result = engine.analyze(
					"123",
					{ type: "object", properties: {} },
					{
						coerceSchema: { type: "integer" },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "integer", const: 123 });
			});

			test("string template 'null' with coerceSchema string → outputSchema string", () => {
				const result = engine.analyze(
					"null",
					{ type: "object", properties: {} },
					{
						coerceSchema: { type: "string" },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "string", const: "null" });
			});

			test("object template with coerceSchema — property respects coercion", () => {
				const result = engine.analyze(
					{ meetingId: "123" },
					{
						type: "object",
						properties: { meetingId: { type: "string" } },
					},
					{
						coerceSchema: {
							type: "object",
							properties: { meetingId: { type: "string" } },
						},
					},
				);
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({
					type: "object",
					properties: {
						meetingId: { type: "string", const: "123" },
					},
					required: ["meetingId"],
				});
			});

			test("object template without coerceSchema — detectLiteralType wins", () => {
				const result = engine.analyze(
					{ meetingId: "123" },
					{
						type: "object",
						properties: { meetingId: { type: "string" } },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({
					type: "object",
					properties: {
						meetingId: { type: "number" },
					},
					required: ["meetingId"],
				});
			});

			test("object template with nested coerceSchema — deep propagation", () => {
				const result = engine.analyze(
					{
						outer: {
							count: "42",
						},
					},
					{
						type: "object",
						properties: {
							outer: {
								type: "object",
								properties: { count: { type: "number" } },
							},
						},
					},
					{
						coerceSchema: {
							type: "object",
							properties: {
								outer: {
									type: "object",
									properties: { count: { type: "string" } },
								},
							},
						},
					},
				);
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({
					type: "object",
					properties: {
						outer: {
							type: "object",
							properties: {
								count: { type: "string", const: "42" },
							},
							required: ["count"],
						},
					},
					required: ["outer"],
				});
			});

			test("Handlebars expression ignores coerceSchema — only static literals affected", () => {
				const result = engine.analyze("{{name}}", userSchema, {
					coerceSchema: { type: "number" },
				});
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "string" });
			});

			test("coerceSchema with non-primitive type → falls back to detectLiteralType", () => {
				const result = engine.analyze(
					"123",
					{ type: "object", properties: {} },
					{
						coerceSchema: { type: "object", properties: {} },
					},
				);
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "number" });
			});

			test("coerceSchema with no type → falls back to detectLiteralType", () => {
				const result = engine.analyze(
					"123",
					{ type: "object", properties: {} },
					{
						coerceSchema: {},
					},
				);
				expect(result.valid).toBe(true);
				expect(result.outputSchema).toEqual({ type: "number" });
			});
		});
	});

	describe("execute", () => {
		test("simple object with string templates → resolved values", () => {
			const result = engine.execute(
				{
					userName: "{{name}}",
					userAge: "{{age}}",
				},
				userData,
			);
			expect(result).toEqual({
				userName: "Alice",
				userAge: 30,
			});
		});

		test("object with static string value → passthrough", () => {
			const result = engine.execute(
				{
					userName: "{{name}}",
					status: "success",
				},
				userData,
			);
			expect(result).toEqual({
				userName: "Alice",
				status: "success",
			});
		});

		test("object with primitive literals → passthrough", () => {
			const result = engine.execute(
				{
					num: 42,
					flag: false,
					nothing: null,
					tpl: "{{age}}",
				},
				userData,
			);
			expect(result).toEqual({
				num: 42,
				flag: false,
				nothing: null,
				tpl: 30,
			});
		});

		test("nested object → recursive resolution", () => {
			const result = engine.execute(
				{
					user: {
						name: "{{name}}",
						age: "{{age}}",
					},
					static: 99,
				},
				userData,
			);
			expect(result).toEqual({
				user: {
					name: "Alice",
					age: 30,
				},
				static: 99,
			});
		});

		test("empty object → empty object", () => {
			expect(engine.execute({}, userData)).toEqual({});
		});

		test("object with mixed template → string for mixed values", () => {
			const result = engine.execute(
				{
					greeting: "Hello {{name}}!",
					age: "{{age}}",
				},
				userData,
			);
			expect(result).toEqual({
				greeting: "Hello Alice!",
				age: 30,
			});
		});
	});

	describe("validate", () => {
		test("valid object → valid true, no diagnostics", () => {
			const result = engine.validate(
				{ userName: "{{name}}", userAge: "{{age}}" },
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});

		test("object with missing property → valid false", () => {
			const result = engine.validate(
				{ userName: "{{name}}", bad: "{{nope}}" },
				userSchema,
			);
			expect(result.valid).toBe(false);
			expect(result.diagnostics.length).toBeGreaterThan(0);
		});

		test("object with only literals → always valid", () => {
			const result = engine.validate({ a: 42, b: true, c: null }, userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});
	});

	describe("isValidSyntax", () => {
		test("object with valid templates → true", () => {
			expect(
				engine.isValidSyntax({
					a: "{{name}}",
					b: "Hello {{age}}",
				}),
			).toBe(true);
		});

		test("object with a syntactically invalid template → false", () => {
			expect(
				engine.isValidSyntax({
					a: "{{name}}",
					b: "{{#if x}}oops",
				}),
			).toBe(false);
		});

		test("object with literals → true", () => {
			expect(engine.isValidSyntax({ a: 42, b: true, c: null })).toBe(true);
		});

		test("valid nested object → true", () => {
			expect(
				engine.isValidSyntax({
					nested: { a: "{{name}}", b: 42 },
				}),
			).toBe(true);
		});

		test("nested object with invalid syntax in a child → false", () => {
			expect(
				engine.isValidSyntax({
					nested: { a: "{{#if x}}" },
				}),
			).toBe(false);
		});
	});

	describe("compile", () => {
		test("compiles an object and executes → object with resolved values", () => {
			const tpl = engine.compile({
				userName: "{{name}}",
				userAge: "{{age}}",
				status: "ok",
			});
			const result = tpl.execute(userData);
			expect(result).toEqual({
				userName: "Alice",
				userAge: 30,
				status: "ok",
			});
		});

		test("compiles an object and analyzes → outputSchema object", () => {
			const tpl = engine.compile({
				userName: "{{name}}",
				count: 42,
			});
			const result = tpl.analyze(userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					userName: { type: "string" },
					count: { type: "integer" },
				},
				required: ["userName", "count"],
			});
		});

		test("compiles an object and validates → valid true", () => {
			const tpl = engine.compile({
				userName: "{{name}}",
				age: "{{age}}",
			});
			const result = tpl.validate(userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});

		test("compiles an object with error and validates → valid false", () => {
			const tpl = engine.compile({
				userName: "{{name}}",
				bad: "{{nope}}",
			});
			const result = tpl.validate(userSchema);
			expect(result.valid).toBe(false);
		});

		test("compiles a nested object and executes → recursive resolution", () => {
			const tpl = engine.compile({
				user: { name: "{{name}}", age: "{{age}}" },
				fixed: 99,
			});
			const result = tpl.execute(userData);
			expect(result).toEqual({
				user: { name: "Alice", age: 30 },
				fixed: 99,
			});
		});

		test("compiles an object and analyzeAndExecute → analysis + value", () => {
			const tpl = engine.compile({
				userName: "{{name}}",
				userAge: "{{age}}",
			});
			const { analysis, value } = tpl.analyzeAndExecute(userSchema, userData);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({
				type: "object",
				properties: {
					userName: { type: "string" },
					userAge: { type: "number" },
				},
				required: ["userName", "userAge"],
			});
			expect(value).toEqual({
				userName: "Alice",
				userAge: 30,
			});
		});

		test("compiles an object with error and analyzeAndExecute → value undefined", () => {
			const tpl = engine.compile({
				userName: "{{name}}",
				bad: "{{nope}}",
			});
			const { analysis, value } = tpl.analyzeAndExecute(userSchema, userData);
			expect(analysis.valid).toBe(false);
			expect(value).toBeUndefined();
		});
	});

	describe("analyzeAndExecute", () => {
		test("valid object → valid analysis + resolved object value", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				{
					userName: "{{name}}",
					userAge: "{{age}}",
					status: "ok",
				},
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({
				type: "object",
				properties: {
					userName: { type: "string" },
					userAge: { type: "number" },
					status: { type: "string" },
				},
				required: ["userName", "userAge", "status"],
			});
			expect(value).toEqual({
				userName: "Alice",
				userAge: 30,
				status: "ok",
			});
		});

		test("object with error → invalid analysis + undefined value", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				{
					userName: "{{name}}",
					bad: "{{doesNotExist}}",
				},
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(false);
			expect(value).toBeUndefined();
		});

		test("object with literals + templates → correct types + resolved values", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				{
					num: 42,
					flag: true,
					name: "{{name}}",
				},
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({
				type: "object",
				properties: {
					num: { type: "integer" },
					flag: { type: "boolean" },
					name: { type: "string" },
				},
				required: ["num", "flag", "name"],
			});
			expect(value).toEqual({
				num: 42,
				flag: true,
				name: "Alice",
			});
		});

		test("nested object → nested analysis and value", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				{
					user: {
						name: "{{name}}",
						age: "{{age}}",
					},
					fixed: 99,
				},
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({
				type: "object",
				properties: {
					user: {
						type: "object",
						properties: {
							name: { type: "string" },
							age: { type: "number" },
						},
						required: ["name", "age"],
					},
					fixed: { type: "integer" },
				},
				required: ["user", "fixed"],
			});
			expect(value).toEqual({
				user: { name: "Alice", age: 30 },
				fixed: 99,
			});
		});

		test("error in a sub-object → entire object is invalid", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				{
					ok: "{{name}}",
					nested: {
						bad: "{{nope}}",
					},
				},
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(false);
			expect(value).toBeUndefined();
		});
	});

	describe("standalone functions", () => {
		test("analyze() standalone with object", () => {
			const result = analyze(
				{ userName: "{{name}}", userAge: "{{age}}" },
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					userName: { type: "string" },
					userAge: { type: "number" },
				},
				required: ["userName", "userAge"],
			});
		});

		test("analyze() standalone with invalid object", () => {
			const result = analyze({ bad: "{{nope}}" }, userSchema);
			expect(result.valid).toBe(false);
		});

		test("execute() standalone with object", () => {
			const result = execute(
				{ userName: "{{name}}", userAge: "{{age}}" },
				userData,
			);
			expect(result).toEqual({
				userName: "Alice",
				userAge: 30,
			});
		});

		test("execute() standalone with nested object", () => {
			const result = execute(
				{
					user: { name: "{{name}}" },
					count: 42,
				},
				userData,
			);
			expect(result).toEqual({
				user: { name: "Alice" },
				count: 42,
			});
		});
	});
});

// ─── Array Template Input ────────────────────────────────────────────────────

describe("array template input (TemplateInputArray)", () => {
	beforeEach(() => {
		clearCompilationCache();
	});

	const engine = new Typebars();

	describe("analyze", () => {
		test("simple array with string templates → outputSchema array with string items", () => {
			const result = engine.analyze(["{{name}}"], userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("array with multiple same-type templates → single items schema", () => {
			const result = engine.analyze(
				["{{name}}", "{{address.city}}"],
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("array with different-type templates → oneOf items schema", () => {
			const result = engine.analyze(
				["{{name}}", "{{age}}", "{{active}}"],
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: {
					oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
				},
			});
		});

		test("array with primitive literals → correctly inferred types", () => {
			const result = engine.analyze([42, true, null], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: {
					oneOf: [{ type: "integer" }, { type: "boolean" }, { type: "null" }],
				},
			});
		});

		test("array with mixed templates and literals → correct oneOf", () => {
			const result = engine.analyze(["{{name}}", 42, true, null], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: {
					oneOf: [
						{ type: "string" },
						{ type: "integer" },
						{ type: "boolean" },
						{ type: "null" },
					],
				},
			});
		});

		test("empty array → empty items schema", () => {
			const result = engine.analyze([], userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: {},
			});
		});

		test("array with missing property → valid false + diagnostic", () => {
			const result = engine.analyze(["{{name}}", "{{nope}}"], userSchema);
			expect(result.valid).toBe(false);
			expect(result.diagnostics.length).toBeGreaterThan(0);
			expect(result.diagnostics[0]?.code).toBe("UNKNOWN_PROPERTY");
		});

		test("array with multiple errors → all diagnostics reported", () => {
			const result = engine.analyze(
				["{{bad1}}", "{{bad2}}", "{{name}}"],
				userSchema,
			);
			expect(result.valid).toBe(false);
			const errors = result.diagnostics.filter((d) => d.severity === "error");
			expect(errors.length).toBe(2);
		});

		test("array with nested object element → object items schema", () => {
			const result = engine.analyze(
				[{ user: "{{name}}", age: "{{age}}" }],
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: {
					type: "object",
					properties: {
						user: { type: "string" },
						age: { type: "number" },
					},
					required: ["user", "age"],
				},
			});
		});

		test("array with nested array element → nested array items schema", () => {
			const result = engine.analyze([["{{name}}"], ["{{age}}"]], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: {
					oneOf: [
						{ type: "array", items: { type: "string" } },
						{ type: "array", items: { type: "number" } },
					],
				},
			});
		});

		test("array with identical nested arrays → deduplicated items schema", () => {
			const result = engine.analyze(
				[["{{name}}"], ["{{address.city}}"]],
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "array", items: { type: "string" } },
			});
		});

		test("array with static string value → outputSchema string for that element", () => {
			const result = engine.analyze(["hello", "{{name}}"], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("array with duplicate literal types → deduplicated", () => {
			const result = engine.analyze([42, 99, 7], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "integer" },
			});
		});
	});

	describe("execute", () => {
		test("simple array with string templates → resolved values", () => {
			const result = engine.execute(["{{name}}", "{{age}}"], userData);
			expect(result).toEqual(["Alice", 30]);
		});

		test("array with static string value → passthrough", () => {
			const result = engine.execute(["{{name}}", "hello"], userData);
			expect(result).toEqual(["Alice", "hello"]);
		});

		test("array with primitive literals → passthrough", () => {
			const result = engine.execute([42, false, null, "{{name}}"], userData);
			expect(result).toEqual([42, false, null, "Alice"]);
		});

		test("array with nested object → recursive resolution", () => {
			const result = engine.execute(
				[{ name: "{{name}}", age: "{{age}}" }, "static"],
				userData,
			);
			expect(result).toEqual([{ name: "Alice", age: 30 }, "static"]);
		});

		test("array with nested array → recursive resolution", () => {
			const result = engine.execute([["{{name}}"], ["{{age}}"]], userData);
			expect(result).toEqual([["Alice"], [30]]);
		});

		test("empty array → empty array", () => {
			expect(engine.execute([], userData)).toEqual([]);
		});

		test("array with mixed template → string for mixed values", () => {
			const result = engine.execute(["Hello {{name}}", "{{age}}"], userData);
			expect(result).toEqual(["Hello Alice", 30]);
		});
	});

	describe("validate", () => {
		test("valid array → valid true, no diagnostics", () => {
			const result = engine.validate(["{{name}}", "{{age}}"], userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});

		test("array with missing property → valid false", () => {
			const result = engine.validate(["{{name}}", "{{nope}}"], userSchema);
			expect(result.valid).toBe(false);
			expect(result.diagnostics.length).toBeGreaterThan(0);
		});

		test("array with only literals → always valid", () => {
			const result = engine.validate([42, true, null], userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});

		test("empty array → always valid", () => {
			const result = engine.validate([], userSchema);
			expect(result.valid).toBe(true);
		});
	});

	describe("isValidSyntax", () => {
		test("array with valid templates → true", () => {
			expect(engine.isValidSyntax(["{{name}}", "{{age}}"])).toBe(true);
		});

		test("array with a syntactically invalid template → false", () => {
			expect(engine.isValidSyntax(["{{name}}", "{{#if}}"])).toBe(false);
		});

		test("array with literals → true", () => {
			expect(engine.isValidSyntax([42, true, null])).toBe(true);
		});

		test("empty array → true", () => {
			expect(engine.isValidSyntax([])).toBe(true);
		});

		test("nested array with valid syntax → true", () => {
			expect(engine.isValidSyntax([["{{name}}"], ["{{age}}"]])).toBe(true);
		});

		test("nested array with invalid syntax in a child → false", () => {
			expect(engine.isValidSyntax([["{{name}}"], ["{{#if}}"]])).toBe(false);
		});
	});

	describe("compile", () => {
		test("compiles an array and executes → array with resolved values", () => {
			const tpl = engine.compile(["{{name}}", "{{age}}", "ok"]);
			const result = tpl.execute(userData);
			expect(result).toEqual(["Alice", 30, "ok"]);
		});

		test("compiles an array and analyzes → outputSchema array", () => {
			const tpl = engine.compile(["{{name}}", 42]);
			const result = tpl.analyze(userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: {
					oneOf: [{ type: "string" }, { type: "integer" }],
				},
			});
		});

		test("compiles an array and validates → valid true", () => {
			const tpl = engine.compile(["{{name}}", "{{age}}"]);
			const result = tpl.validate(userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});

		test("compiles an array with error and validates → valid false", () => {
			const tpl = engine.compile(["{{name}}", "{{nope}}"]);
			const result = tpl.validate(userSchema);
			expect(result.valid).toBe(false);
		});

		test("compiles a nested array and executes → recursive resolution", () => {
			const tpl = engine.compile([["{{name}}"], { age: "{{age}}" }, 42]);
			const result = tpl.execute(userData);
			expect(result).toEqual([["Alice"], { age: 30 }, 42]);
		});

		test("compiles an array and analyzeAndExecute → analysis + value", () => {
			const tpl = engine.compile(["{{name}}", "{{age}}"]);
			const { analysis, value } = tpl.analyzeAndExecute(userSchema, userData);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({
				type: "array",
				items: {
					oneOf: [{ type: "string" }, { type: "number" }],
				},
			});
			expect(value).toEqual(["Alice", 30]);
		});

		test("compiles an array with error and analyzeAndExecute → value undefined", () => {
			const tpl = engine.compile(["{{name}}", "{{bad}}"]);
			const { analysis, value } = tpl.analyzeAndExecute(userSchema, userData);
			expect(analysis.valid).toBe(false);
			expect(value).toBeUndefined();
		});

		test("compiles an empty array → empty array result", () => {
			const tpl = engine.compile([]);
			const result = tpl.execute(userData);
			expect(result).toEqual([]);
			const analysis = tpl.analyze(userSchema);
			expect(analysis.outputSchema).toEqual({
				type: "array",
				items: {},
			});
		});
	});

	describe("analyzeAndExecute", () => {
		test("valid array → valid analysis + resolved array value", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				["{{name}}", "{{age}}", "static"],
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({
				type: "array",
				items: {
					oneOf: [{ type: "string" }, { type: "number" }],
				},
			});
			expect(value).toEqual(["Alice", 30, "static"]);
		});

		test("array with error → invalid analysis + undefined value", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				["{{name}}", "{{bad}}"],
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(false);
			expect(value).toBeUndefined();
		});

		test("array with literals + templates → correct types + resolved values", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				[42, true, "{{name}}"],
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({
				type: "array",
				items: {
					oneOf: [{ type: "integer" }, { type: "boolean" }, { type: "string" }],
				},
			});
			expect(value).toEqual([42, true, "Alice"]);
		});

		test("nested array → nested analysis and value", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				[{ name: "{{name}}" }, ["{{age}}"]],
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({
				type: "array",
				items: {
					oneOf: [
						{
							type: "object",
							properties: { name: { type: "string" } },
							required: ["name"],
						},
						{
							type: "array",
							items: { type: "number" },
						},
					],
				},
			});
			expect(value).toEqual([{ name: "Alice" }, [30]]);
		});

		test("error in a nested element → entire array is invalid", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				["{{name}}", { bad: "{{nope}}" }],
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(false);
			expect(value).toBeUndefined();
		});

		test("empty array → valid with empty items", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				[],
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({
				type: "array",
				items: {},
			});
			expect(value).toEqual([]);
		});
	});

	describe("standalone functions", () => {
		test("analyze() standalone with array", () => {
			const result = analyze(["{{name}}", "{{age}}"], userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: {
					oneOf: [{ type: "string" }, { type: "number" }],
				},
			});
		});

		test("analyze() standalone with invalid array", () => {
			const result = analyze(["{{nope}}"], userSchema);
			expect(result.valid).toBe(false);
		});

		test("execute() standalone with array", () => {
			const result = execute(["{{name}}", "{{age}}"], userData);
			expect(result).toEqual(["Alice", 30]);
		});

		test("execute() standalone with nested array", () => {
			const result = execute([["{{name}}"], 42], userData);
			expect(result).toEqual([["Alice"], 42]);
		});

		test("execute() standalone with empty array", () => {
			const result = execute([], userData);
			expect(result).toEqual([]);
		});
	});
});
