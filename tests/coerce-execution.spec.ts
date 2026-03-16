import { beforeEach, describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { clearCompilationCache, execute } from "../src/executor.ts";
import { Typebars } from "../src/typebars.ts";
import { userData, userSchema } from "./fixtures.ts";

// ─── Coercion at Execution Time ──────────────────────────────────────────────
// Tests verifying that:
// 1. Static pure templates (no {{}}) are auto-coerced via coerceLiteral
//    (e.g. "123" → 123, "true" → true, "null" → null)
// 2. coerceSchema overrides auto-detection at execution time
//    (e.g. "123" + coerceSchema string → "123")
// 3. coerceSchema propagates through object templates at every depth
// 4. CompiledTemplate benefits from the same coercion behavior

const engine = new Typebars();

const complexSchema: JSONSchema7 = {
	type: "object",
	properties: {
		name: { type: "string" },
		age: { type: "number" },
		active: { type: "boolean" },
		score: { type: "integer" },
		accountId: { type: "string" },
		balance: { type: "number" },
		config: {
			type: "object",
			properties: {
				maxRetries: { type: "string" },
				timeout: { type: "number" },
				enabled: { type: "boolean" },
				nested: {
					type: "object",
					properties: {
						deep: {
							type: "object",
							properties: {
								value: { type: "string" },
								count: { type: "integer" },
								flag: { type: "boolean" },
							},
						},
					},
				},
			},
		},
		metadata: {
			type: "object",
			properties: {
				role: { type: "string" },
				level: { type: "number" },
			},
		},
	},
	required: ["name", "age"],
};

const complexData: Record<string, unknown> = {
	name: "Alice",
	age: 30,
	active: true,
	score: 95,
	accountId: "ACC-12345",
	balance: 1500.5,
	config: {
		maxRetries: "3",
		timeout: 5000,
		enabled: true,
		nested: {
			deep: {
				value: "hello",
				count: 42,
				flag: false,
			},
		},
	},
	metadata: {
		role: "admin",
		level: 5,
	},
};

// ─── Default Auto-Coercion (no coerceSchema) ────────────────────────────────

describe("default auto-coercion of static templates (no coerceSchema)", () => {
	beforeEach(() => {
		clearCompilationCache();
	});

	describe("standalone execute()", () => {
		test("static '123' → number 123", () => {
			const result = execute("123", {});
			expect(result).toBe(123);
			expect(typeof result).toBe("number");
		});

		test("static '0' → number 0", () => {
			expect(execute("0", {})).toBe(0);
		});

		test("static '-42' → number -42", () => {
			expect(execute("-42", {})).toBe(-42);
		});

		test("static '3.14' → number 3.14", () => {
			expect(execute("3.14", {})).toBe(3.14);
		});

		test("static 'true' → boolean true", () => {
			const result = execute("true", {});
			expect(result).toBe(true);
			expect(typeof result).toBe("boolean");
		});

		test("static 'false' → boolean false", () => {
			const result = execute("false", {});
			expect(result).toBe(false);
			expect(typeof result).toBe("boolean");
		});

		test("static 'null' → null", () => {
			const result = execute("null", {});
			expect(result).toBe(null);
		});

		test("static 'hello' → string 'hello' (non-literal)", () => {
			const result = execute("hello", {});
			expect(result).toBe("hello");
			expect(typeof result).toBe("string");
		});

		test("static 'Just text' → string (non-literal)", () => {
			expect(execute("Just text", {})).toBe("Just text");
		});

		test("static empty string → string ''", () => {
			expect(execute("", {})).toBe("");
		});

		test("static whitespace → string (not a literal)", () => {
			const result = execute("   ", {});
			expect(typeof result).toBe("string");
		});
	});

	describe("Typebars.execute()", () => {
		test("static '123' → number 123", () => {
			expect(engine.execute("123", {})).toBe(123);
		});

		test("static 'true' → boolean true", () => {
			expect(engine.execute("true", {})).toBe(true);
		});

		test("static 'null' → null", () => {
			expect(engine.execute("null", {})).toBe(null);
		});

		test("static 'hello world' → string", () => {
			expect(engine.execute("hello world", {})).toBe("hello world");
		});

		test("object template with static literals → auto-coerced values", () => {
			const result = engine.execute(
				{
					num: "123",
					bool: "true",
					nil: "null",
					text: "hello",
				},
				{},
			);
			expect(result).toEqual({
				num: 123,
				bool: true,
				nil: null,
				text: "hello",
			});
		});

		test("nested object with static literals → auto-coerced at every level", () => {
			const result = engine.execute(
				{
					outer: {
						inner: "42",
						text: "ok",
					},
					top: "true",
				},
				{},
			);
			expect(result).toEqual({
				outer: {
					inner: 42,
					text: "ok",
				},
				top: true,
			});
		});
	});

	describe("CompiledTemplate", () => {
		test("compiled static '123' → number 123", () => {
			const tpl = engine.compile("123");
			expect(tpl.execute({})).toBe(123);
		});

		test("compiled static 'true' → boolean true", () => {
			const tpl = engine.compile("true");
			expect(tpl.execute({})).toBe(true);
		});

		test("compiled static 'null' → null", () => {
			const tpl = engine.compile("null");
			expect(tpl.execute({})).toBe(null);
		});

		test("compiled static 'hello' → string 'hello'", () => {
			const tpl = engine.compile("hello");
			expect(tpl.execute({})).toBe("hello");
		});

		test("compiled object with static literals → auto-coerced", () => {
			const tpl = engine.compile({
				num: "456",
				bool: "false",
				text: "world",
			});
			expect(tpl.execute({})).toEqual({
				num: 456,
				bool: false,
				text: "world",
			});
		});
	});
});

// ─── coerceSchema at Execution Time ─────────────────────────────────────────

describe("coerceSchema at execution time", () => {
	beforeEach(() => {
		clearCompilationCache();
	});

	// ─── Typebars.execute() with coerceSchema ────────────────────────────

	describe("Typebars.execute() with coerceSchema", () => {
		test("static '123' + coerceSchema string → stays string '123'", () => {
			const result = engine.execute(
				"123",
				{},
				{
					coerceSchema: { type: "string" },
				},
			);
			expect(result).toBe("123");
			expect(typeof result).toBe("string");
		});

		test("static '123' + coerceSchema number → number 123", () => {
			const result = engine.execute(
				"123",
				{},
				{
					coerceSchema: { type: "number" },
				},
			);
			expect(result).toBe(123);
			expect(typeof result).toBe("number");
		});

		test("static '123' + coerceSchema integer → number 123", () => {
			const result = engine.execute(
				"123",
				{},
				{
					coerceSchema: { type: "integer" },
				},
			);
			expect(result).toBe(123);
			expect(typeof result).toBe("number");
		});

		test("static 'true' + coerceSchema string → stays string 'true'", () => {
			const result = engine.execute(
				"true",
				{},
				{
					coerceSchema: { type: "string" },
				},
			);
			expect(result).toBe("true");
			expect(typeof result).toBe("string");
		});

		test("static 'true' + coerceSchema boolean → boolean true", () => {
			const result = engine.execute(
				"true",
				{},
				{
					coerceSchema: { type: "boolean" },
				},
			);
			expect(result).toBe(true);
			expect(typeof result).toBe("boolean");
		});

		test("static 'false' + coerceSchema string → stays string 'false'", () => {
			expect(
				engine.execute("false", {}, { coerceSchema: { type: "string" } }),
			).toBe("false");
		});

		test("static 'null' + coerceSchema string → stays string 'null'", () => {
			expect(
				engine.execute("null", {}, { coerceSchema: { type: "string" } }),
			).toBe("null");
		});

		test("static 'null' + coerceSchema null → null", () => {
			expect(
				engine.execute("null", {}, { coerceSchema: { type: "null" } }),
			).toBe(null);
		});

		test("static 'hello' + coerceSchema string → stays string 'hello'", () => {
			expect(
				engine.execute("hello", {}, { coerceSchema: { type: "string" } }),
			).toBe("hello");
		});

		test("static 'hello' + coerceSchema number → undefined (non-numeric string)", () => {
			const result = engine.execute(
				"hello",
				{},
				{
					coerceSchema: { type: "number" },
				},
			);
			expect(result).toBeUndefined();
		});

		test("Handlebars expression is NOT affected by coerceSchema", () => {
			// {{name}} resolves from data → "Alice", coerceSchema should not interfere
			const result = engine.execute("{{name}}", userData, {
				coerceSchema: { type: "number" },
			});
			expect(result).toBe("Alice");
		});

		test("single expression {{age}} preserves raw value regardless of coerceSchema", () => {
			const result = engine.execute("{{age}}", userData, {
				coerceSchema: { type: "string" },
			});
			// Single expression returns raw value from data (number 30), not coerced
			expect(result).toBe(30);
		});

		test("mixed template is always string regardless of coerceSchema", () => {
			const result = engine.execute("Hello {{name}}!", userData, {
				coerceSchema: { type: "number" },
			});
			expect(result).toBe("Hello Alice!");
		});
	});

	// ─── Typebars.execute() with coerceSchema on objects ─────────────────

	describe("Typebars.execute() with coerceSchema on object templates", () => {
		test("object with coerceSchema — property coerced to string", () => {
			const result = engine.execute(
				{ meetingId: "123" },
				{},
				{
					coerceSchema: {
						type: "object",
						properties: { meetingId: { type: "string" } },
					},
				},
			);
			expect(result).toEqual({ meetingId: "123" });
		});

		test("object with coerceSchema — property coerced to number", () => {
			const result = engine.execute(
				{ meetingId: "123" },
				{},
				{
					coerceSchema: {
						type: "object",
						properties: { meetingId: { type: "number" } },
					},
				},
			);
			expect(result).toEqual({ meetingId: 123 });
		});

		test("object without coerceSchema — default auto-detect", () => {
			const result = engine.execute({ meetingId: "123" }, {});
			// Without coerceSchema, auto-detect → number
			expect(result).toEqual({ meetingId: 123 });
		});

		test("object with partial coerceSchema — some coerced, some auto-detected", () => {
			const result = engine.execute(
				{
					accountId: "12345",
					balance: "100.50",
					unknown: "999",
				},
				{},
				{
					coerceSchema: {
						type: "object",
						properties: {
							accountId: { type: "string" },
							// balance and unknown not in coerceSchema
						},
					},
				},
			);
			expect(result).toEqual({
				// coerceSchema says string → stays "12345"
				accountId: "12345",
				// auto-detect → number
				balance: 100.5,
				// auto-detect → number
				unknown: 999,
			});
		});

		test("nested object with coerceSchema — deep propagation", () => {
			const result = engine.execute(
				{
					config: {
						maxRetries: "3",
						timeout: "5000",
					},
					metadata: {
						role: "admin",
						level: "5",
					},
				},
				{},
				{ coerceSchema: complexSchema },
			);
			expect(result).toEqual({
				config: {
					// coerceSchema says string → stays "3"
					maxRetries: "3",
					// coerceSchema says number → 5000
					timeout: 5000,
				},
				metadata: {
					// coerceSchema says string → stays "admin"
					role: "admin",
					// coerceSchema says number → 5
					level: 5,
				},
			});
		});

		test("deeply nested (3+ levels) with coerceSchema", () => {
			const result = engine.execute(
				{
					config: {
						nested: {
							deep: {
								value: "42",
								count: "10",
								flag: "true",
							},
						},
					},
				},
				{},
				{ coerceSchema: complexSchema },
			);
			const config = (result as Record<string, unknown>).config as Record<
				string,
				unknown
			>;
			const nested = config.nested as Record<string, unknown>;
			const deep = nested.deep as Record<string, unknown>;
			// coerceSchema: string → stays "42"
			expect(deep.value).toBe("42");
			// coerceSchema: integer → 10
			expect(deep.count).toBe(10);
			// coerceSchema: boolean → true
			expect(deep.flag).toBe(true);
		});

		test("object mixing Handlebars expressions + static coerced values", () => {
			const result = engine.execute(
				{
					accountId: "12345",
					name: "{{name}}",
					age: "{{age}}",
					balance: "500.25",
				},
				complexData,
				{ coerceSchema: complexSchema },
			);
			expect(result).toEqual({
				// coerceSchema: string → stays "12345"
				accountId: "12345",
				// Handlebars → "Alice"
				name: "Alice",
				// Handlebars → 30
				age: 30,
				// coerceSchema: number → 500.25
				balance: 500.25,
			});
		});
	});

	// ─── CompiledTemplate.execute() with coerceSchema ────────────────────

	describe("CompiledTemplate.execute() with coerceSchema", () => {
		test("compiled static '123' + coerceSchema string → stays string", () => {
			const tpl = engine.compile("123");
			const result = tpl.execute({}, { coerceSchema: { type: "string" } });
			expect(result).toBe("123");
			expect(typeof result).toBe("string");
		});

		test("compiled static '123' + coerceSchema number → number", () => {
			const tpl = engine.compile("123");
			const result = tpl.execute({}, { coerceSchema: { type: "number" } });
			expect(result).toBe(123);
		});

		test("compiled static 'true' + coerceSchema string → stays string", () => {
			const tpl = engine.compile("true");
			const result = tpl.execute({}, { coerceSchema: { type: "string" } });
			expect(result).toBe("true");
		});

		test("compiled static 'null' + coerceSchema string → stays string", () => {
			const tpl = engine.compile("null");
			const result = tpl.execute({}, { coerceSchema: { type: "string" } });
			expect(result).toBe("null");
		});

		test("compiled object with coerceSchema — deep propagation", () => {
			const tpl = engine.compile({
				accountId: "12345",
				balance: "500.25",
				config: {
					maxRetries: "3",
					timeout: "5000",
				},
			});
			const result = tpl.execute({}, { coerceSchema: complexSchema });
			expect(result).toEqual({
				accountId: "12345",
				balance: 500.25,
				config: {
					maxRetries: "3",
					timeout: 5000,
				},
			});
		});

		test("compiled object without coerceSchema → auto-detect", () => {
			const tpl = engine.compile({
				accountId: "12345",
				balance: "500.25",
			});
			const result = tpl.execute({});
			expect(result).toEqual({
				// auto-detect → number
				accountId: 12345,
				balance: 500.25,
			});
		});

		test("compiled object mixing expressions + coerced static values", () => {
			const tpl = engine.compile({
				accountId: "12345",
				name: "{{name}}",
				balance: "500.25",
			});
			const result = tpl.execute(complexData, { coerceSchema: complexSchema });
			expect(result).toEqual({
				accountId: "12345",
				name: "Alice",
				balance: 500.25,
			});
		});
	});

	// ─── CompiledTemplate.analyze() with coerceSchema ────────────────────

	describe("CompiledTemplate.analyze() with coerceSchema", () => {
		test("compiled static '123' + coerceSchema string → outputSchema string", () => {
			const tpl = engine.compile("123");
			const result = tpl.analyze(
				{ type: "object", properties: {} },
				{ coerceSchema: { type: "string" } },
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string", const: "123" });
		});

		test("compiled static '123' without coerceSchema → outputSchema number", () => {
			const tpl = engine.compile("123");
			const result = tpl.analyze({ type: "object", properties: {} });
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("compiled object with coerceSchema — property types coerced", () => {
			const tpl = engine.compile({
				meetingId: "123",
				count: "42",
			});
			const result = tpl.analyze(complexSchema, {
				coerceSchema: {
					type: "object",
					properties: {
						meetingId: { type: "string" },
						count: { type: "integer" },
					},
				},
			});
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					meetingId: { type: "string", const: "123" },
					count: { type: "integer", const: 42 },
				},
				required: ["meetingId", "count"],
			});
		});

		test("compiled object without coerceSchema — detectLiteralType", () => {
			const tpl = engine.compile({
				meetingId: "123",
				count: "42",
			});
			const result = tpl.analyze(complexSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					meetingId: { type: "number" },
					count: { type: "number" },
				},
				required: ["meetingId", "count"],
			});
		});

		test("compiled nested object with coerceSchema — deep propagation", () => {
			const tpl = engine.compile({
				config: {
					maxRetries: "3",
					timeout: "5000",
					nested: {
						deep: {
							value: "42",
							count: "10",
						},
					},
				},
			});
			const result = tpl.analyze(complexSchema, {
				coerceSchema: complexSchema,
			});
			expect(result.valid).toBe(true);
			// maxRetries: coerceSchema string → string
			const outputProps = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown>;
			const configProps = (outputProps?.config as Record<string, unknown>)
				?.properties as Record<string, unknown>;
			expect(configProps?.maxRetries).toEqual({ type: "string", const: "3" });
			expect(configProps?.timeout).toEqual({ type: "number", const: 5000 });

			const nestedProps = (configProps?.nested as Record<string, unknown>)
				?.properties as Record<string, unknown>;
			const deepProps = (nestedProps?.deep as Record<string, unknown>)
				?.properties as Record<string, unknown>;
			expect(deepProps?.value).toEqual({ type: "string", const: "42" });
			expect(deepProps?.count).toEqual({ type: "integer", const: 10 });
		});

		test("compiled Handlebars expression ignores coerceSchema", () => {
			const tpl = engine.compile("{{name}}");
			const result = tpl.analyze(userSchema, {
				coerceSchema: { type: "number" },
			});
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});
	});

	// ─── CompiledTemplate.validate() with coerceSchema ───────────────────

	describe("CompiledTemplate.validate() with coerceSchema", () => {
		test("compiled valid template with coerceSchema → valid true", () => {
			const tpl = engine.compile({ name: "{{name}}", code: "123" });
			const result = tpl.validate(userSchema, {
				coerceSchema: {
					type: "object",
					properties: { code: { type: "string" } },
				},
			});
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});

		test("compiled invalid template with coerceSchema → valid false", () => {
			const tpl = engine.compile({ bad: "{{nope}}" });
			const result = tpl.validate(userSchema, {
				coerceSchema: {
					type: "object",
					properties: { bad: { type: "string" } },
				},
			});
			expect(result.valid).toBe(false);
		});
	});

	// ─── CompiledTemplate.analyzeAndExecute() with coerceSchema ──────────

	describe("CompiledTemplate.analyzeAndExecute() with coerceSchema", () => {
		test("compiled object — analysis + execution both respect coerceSchema", () => {
			const tpl = engine.compile({
				accountId: "12345",
				name: "{{name}}",
				balance: "500.25",
			});
			const { analysis, value } = tpl.analyzeAndExecute(
				complexSchema,
				complexData,
				{
					coerceSchema: complexSchema,
				},
			);
			expect(analysis.valid).toBe(true);

			// Analysis: types reflect coerceSchema
			const props = (analysis.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown>;
			expect(props?.accountId).toEqual({ type: "string", const: "12345" });
			expect(props?.name).toEqual({ type: "string" });
			expect(props?.balance).toEqual({ type: "number", const: 500.25 });

			// Execution: values reflect coerceSchema
			const v = value as Record<string, unknown>;
			expect(v.accountId).toBe("12345");
			expect(v.name).toBe("Alice");
			expect(v.balance).toBe(500.25);
		});

		test("compiled object without coerceSchema — default behavior", () => {
			const tpl = engine.compile({
				accountId: "12345",
				balance: "500.25",
			});
			const { analysis, value } = tpl.analyzeAndExecute(
				complexSchema,
				complexData,
			);
			expect(analysis.valid).toBe(true);

			// Without coerceSchema: detectLiteralType → number
			const props = (analysis.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown>;
			expect(props?.accountId).toEqual({ type: "number" });
			expect(props?.balance).toEqual({ type: "number" });

			// Execution: auto-coerced
			const v = value as Record<string, unknown>;
			expect(v.accountId).toBe(12345);
			expect(v.balance).toBe(500.25);
		});

		test("compiled nested object — deep coerceSchema propagation for both analysis + execution", () => {
			const tpl = engine.compile({
				config: {
					maxRetries: "3",
					timeout: "5000",
				},
				metadata: {
					role: "admin",
					level: "5",
				},
			});
			const { analysis, value } = tpl.analyzeAndExecute(
				complexSchema,
				complexData,
				{ coerceSchema: complexSchema },
			);
			expect(analysis.valid).toBe(true);

			// Analysis
			const outputProps = (analysis.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown>;
			const configProps = (outputProps?.config as Record<string, unknown>)
				?.properties as Record<string, unknown>;
			expect(configProps?.maxRetries).toEqual({ type: "string", const: "3" });
			expect(configProps?.timeout).toEqual({ type: "number", const: 5000 });

			const metaProps = (outputProps?.metadata as Record<string, unknown>)
				?.properties as Record<string, unknown>;
			expect(metaProps?.role).toEqual({ type: "string", const: "admin" });
			expect(metaProps?.level).toEqual({ type: "number", const: 5 });

			// Execution
			const v = value as Record<string, unknown>;
			const vConfig = v.config as Record<string, unknown>;
			expect(vConfig.maxRetries).toBe("3");
			expect(vConfig.timeout).toBe(5000);

			const vMeta = v.metadata as Record<string, unknown>;
			expect(vMeta.role).toBe("admin");
			expect(vMeta.level).toBe(5);
		});

		test("compiled template with error → analysis invalid, value undefined", () => {
			const tpl = engine.compile({ bad: "{{nope}}" });
			const { analysis, value } = tpl.analyzeAndExecute(userSchema, userData, {
				coerceSchema: complexSchema,
			});
			expect(analysis.valid).toBe(false);
			expect(value).toBeUndefined();
		});

		test("compiled string template — coerceSchema string keeps string at execution", () => {
			const tpl = engine.compile("42");
			const { analysis, value } = tpl.analyzeAndExecute(
				{ type: "object", properties: {} },
				{},
				{ coerceSchema: { type: "string" } },
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "string", const: "42" });
			expect(value).toBe("42");
		});

		test("compiled string template — coerceSchema number coerces at execution", () => {
			const tpl = engine.compile("42");
			const { analysis, value } = tpl.analyzeAndExecute(
				{ type: "object", properties: {} },
				{},
				{ coerceSchema: { type: "number" } },
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "number", const: 42 });
			expect(value).toBe(42);
		});
	});

	// ─── Typebars.analyzeAndExecute() with coerceSchema ──────────────────

	describe("Typebars.analyzeAndExecute() with coerceSchema — execution values", () => {
		test("string template — coerceSchema string → analysis + execution both string", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				"123",
				{ type: "object", properties: {} },
				{},
				{ coerceSchema: { type: "string" } },
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "string", const: "123" });
			expect(value).toBe("123");
		});

		test("string template — coerceSchema number → analysis + execution both number", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				"123",
				{ type: "object", properties: {} },
				{},
				{ coerceSchema: { type: "number" } },
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "number", const: 123 });
			expect(value).toBe(123);
		});

		test("object template — coerceSchema propagates to execution values", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				{
					accountId: "12345",
					balance: "500.25",
					name: "{{name}}",
				},
				complexSchema,
				complexData,
				{ coerceSchema: complexSchema },
			);
			expect(analysis.valid).toBe(true);

			const v = value as Record<string, unknown>;
			// coerceSchema: string → stays "12345"
			expect(v.accountId).toBe("12345");
			// coerceSchema: number → 500.25
			expect(v.balance).toBe(500.25);
			// Handlebars → "Alice"
			expect(v.name).toBe("Alice");
		});

		test("without coerceSchema — execution uses auto-detect", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				{
					accountId: "12345",
					balance: "500.25",
				},
				complexSchema,
				complexData,
			);
			expect(analysis.valid).toBe(true);

			const v = value as Record<string, unknown>;
			// auto-detect → number
			expect(v.accountId).toBe(12345);
			expect(v.balance).toBe(500.25);
		});
	});

	// ─── Edge Cases ──────────────────────────────────────────────────────────

	describe("edge cases", () => {
		test("coerceSchema with non-primitive type → falls back to auto-detect", () => {
			const result = engine.execute(
				"123",
				{},
				{
					coerceSchema: { type: "object", properties: {} },
				},
			);
			// "object" is not a primitive → fallback to coerceLiteral → 123
			expect(result).toBe(123);
		});

		test("coerceSchema with no type → falls back to auto-detect", () => {
			const result = engine.execute(
				"123",
				{},
				{
					coerceSchema: {},
				},
			);
			expect(result).toBe(123);
		});

		test("coerceSchema with array type → falls back to auto-detect", () => {
			const result = engine.execute(
				"123",
				{},
				{
					coerceSchema: { type: "array", items: { type: "string" } },
				},
			);
			expect(result).toBe(123);
		});

		test("empty string with coerceSchema string → empty string", () => {
			const result = engine.execute(
				"",
				{},
				{
					coerceSchema: { type: "string" },
				},
			);
			expect(result).toBe("");
		});

		test("JS literal passthrough ignores coerceSchema", () => {
			// JS literals are passthrough at the TemplateInput level,
			// never going through executeFromAst
			expect(engine.execute(42, {}, { coerceSchema: { type: "string" } })).toBe(
				42,
			);
			expect(
				engine.execute(true, {}, { coerceSchema: { type: "string" } }),
			).toBe(true);
			expect(
				engine.execute(null, {}, { coerceSchema: { type: "string" } }),
			).toBe(null);
		});

		test("negative number with coerceSchema string → stays string", () => {
			const result = engine.execute(
				"-42",
				{},
				{
					coerceSchema: { type: "string" },
				},
			);
			expect(result).toBe("-42");
		});

		test("decimal number with coerceSchema string → stays string", () => {
			const result = engine.execute(
				"3.14",
				{},
				{
					coerceSchema: { type: "string" },
				},
			);
			expect(result).toBe("3.14");
		});

		test("single block #if with coerceSchema → coerceSchema wins", () => {
			// Single block goes through coerceLiteral/coerceValue
			const result = engine.execute(
				"{{#if active}}123{{else}}456{{/if}}",
				{ active: true },
				{ coerceSchema: { type: "string" } },
			);
			expect(result).toBe("123");
			expect(typeof result).toBe("string");
		});

		test("single block #if without coerceSchema → auto-detect number", () => {
			const result = engine.execute("{{#if active}}123{{else}}456{{/if}}", {
				active: true,
			});
			expect(result).toBe(123);
			expect(typeof result).toBe("number");
		});

		test("analysis and execution consistent without coerceSchema", () => {
			// Both analysis and execution should agree: "123" → number
			const analysis = engine.analyze("123", {
				type: "object",
				properties: {},
			});
			const value = engine.execute("123", {});
			expect(analysis.outputSchema).toEqual({ type: "number" });
			expect(value).toBe(123);
			expect(typeof value).toBe("number");
		});

		test("analysis and execution consistent with coerceSchema string", () => {
			const analysis = engine.analyze(
				"123",
				{ type: "object", properties: {} },
				{ coerceSchema: { type: "string" } },
			);
			const value = engine.execute(
				"123",
				{},
				{
					coerceSchema: { type: "string" },
				},
			);
			expect(analysis.outputSchema).toEqual({ type: "string", const: "123" });
			expect(value).toBe("123");
			expect(typeof value).toBe("string");
		});
	});

	// ─── Boolean Coercion Case-Insensitivity ─────────────────────────────

	describe("boolean coercion case-insensitivity", () => {
		test("'true' → true", () => {
			const result = engine.execute(
				"true",
				{},
				{ coerceSchema: { type: "boolean" } },
			);
			expect(result).toBe(true);
		});

		test("'false' → false", () => {
			const result = engine.execute(
				"false",
				{},
				{ coerceSchema: { type: "boolean" } },
			);
			expect(result).toBe(false);
		});

		test("'True' → true (case-insensitive)", () => {
			const result = engine.execute(
				"True",
				{},
				{ coerceSchema: { type: "boolean" } },
			);
			expect(result).toBe(true);
		});

		test("'TRUE' → true (case-insensitive)", () => {
			const result = engine.execute(
				"TRUE",
				{},
				{ coerceSchema: { type: "boolean" } },
			);
			expect(result).toBe(true);
		});

		test("'False' → false (case-insensitive)", () => {
			const result = engine.execute(
				"False",
				{},
				{ coerceSchema: { type: "boolean" } },
			);
			expect(result).toBe(false);
		});

		test("'FALSE' → false (case-insensitive)", () => {
			const result = engine.execute(
				"FALSE",
				{},
				{ coerceSchema: { type: "boolean" } },
			);
			expect(result).toBe(false);
		});

		test("'' → undefined (empty string is not a boolean)", () => {
			const result = engine.execute(
				"",
				{},
				{ coerceSchema: { type: "boolean" } },
			);
			expect(result).toBeUndefined();
		});

		test("'  true  ' → true (whitespace trimmed)", () => {
			const result = engine.execute(
				"  true  ",
				{},
				{ coerceSchema: { type: "boolean" } },
			);
			expect(result).toBe(true);
		});

		test("'  FALSE  ' → false (whitespace trimmed + case-insensitive)", () => {
			const result = engine.execute(
				"  FALSE  ",
				{},
				{ coerceSchema: { type: "boolean" } },
			);
			expect(result).toBe(false);
		});

		test("'yes' → undefined (not a valid boolean string)", () => {
			const result = engine.execute(
				"yes",
				{},
				{ coerceSchema: { type: "boolean" } },
			);
			expect(result).toBeUndefined();
		});

		test("'1' → undefined (not a valid boolean string)", () => {
			const result = engine.execute(
				"1",
				{},
				{ coerceSchema: { type: "boolean" } },
			);
			expect(result).toBeUndefined();
		});

		test("'0' → undefined (not a valid boolean string)", () => {
			const result = engine.execute(
				"0",
				{},
				{ coerceSchema: { type: "boolean" } },
			);
			expect(result).toBeUndefined();
		});
	});

	// ─── Number Coercion Edge Cases ──────────────────────────────────────

	describe("number coercion edge cases", () => {
		test("'42' → 42", () => {
			const result = engine.execute(
				"42",
				{},
				{ coerceSchema: { type: "number" } },
			);
			expect(result).toBe(42);
		});

		test("'3.14' → 3.14", () => {
			const result = engine.execute(
				"3.14",
				{},
				{ coerceSchema: { type: "number" } },
			);
			expect(result).toBe(3.14);
		});

		test("'-7' → -7", () => {
			const result = engine.execute(
				"-7",
				{},
				{ coerceSchema: { type: "number" } },
			);
			expect(result).toBe(-7);
		});

		test("'' → undefined (not 0)", () => {
			const result = engine.execute(
				"",
				{},
				{ coerceSchema: { type: "number" } },
			);
			expect(result).toBeUndefined();
		});

		test("'  ' → undefined (not 0)", () => {
			const result = engine.execute(
				"  ",
				{},
				{ coerceSchema: { type: "number" } },
			);
			expect(result).toBeUndefined();
		});

		test("'hello' → undefined (not NaN)", () => {
			const result = engine.execute(
				"hello",
				{},
				{ coerceSchema: { type: "number" } },
			);
			expect(result).toBeUndefined();
		});

		test("'3.14' with integer schema → undefined (not an integer)", () => {
			const result = engine.execute(
				"3.14",
				{},
				{ coerceSchema: { type: "integer" } },
			);
			expect(result).toBeUndefined();
		});

		test("'-7' with integer schema → -7", () => {
			const result = engine.execute(
				"-7",
				{},
				{ coerceSchema: { type: "integer" } },
			);
			expect(result).toBe(-7);
		});

		test("'42' with integer schema → 42", () => {
			const result = engine.execute(
				"42",
				{},
				{ coerceSchema: { type: "integer" } },
			);
			expect(result).toBe(42);
		});

		test("'0' with number schema → 0", () => {
			const result = engine.execute(
				"0",
				{},
				{ coerceSchema: { type: "number" } },
			);
			expect(result).toBe(0);
		});

		test("'  42  ' with number schema → 42 (whitespace trimmed)", () => {
			const result = engine.execute(
				"  42  ",
				{},
				{ coerceSchema: { type: "number" } },
			);
			expect(result).toBe(42);
		});

		test("'' with integer schema → undefined (not 0)", () => {
			const result = engine.execute(
				"",
				{},
				{ coerceSchema: { type: "integer" } },
			);
			expect(result).toBeUndefined();
		});

		test("'abc' with integer schema → undefined", () => {
			const result = engine.execute(
				"abc",
				{},
				{ coerceSchema: { type: "integer" } },
			);
			expect(result).toBeUndefined();
		});
	});
});
