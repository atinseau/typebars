import { beforeEach, describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { analyze } from "../src/analyzer.ts";
import { clearCompilationCache } from "../src/executor.ts";
import { Typebars } from "../src/typebars.ts";
import type { TemplateInput } from "../src/types.ts";

// ─── Schema-Driven Type Coercion via coerceSchema ────────────────────────────
// Comprehensive tests verifying that:
// 1. By DEFAULT, `detectLiteralType` controls output type inference for static
//    literals (e.g. "123" → number, "true" → boolean, "null" → null).
//    The `inputSchema` must NEVER influence coercion.
// 2. When an explicit `coerceSchema` option is provided, it overrides
//    `detectLiteralType` for static literal values at every depth.
// 3. Handlebars expressions ({{expr}}) are NEVER affected by `coerceSchema`.

const engine = new Typebars();

// ─── Complex Schema ──────────────────────────────────────────────────────────
// A deeply nested schema used as both inputSchema and coerceSchema in tests.

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
								ultraDeep: {
									type: "object",
									properties: {
										finalValue: { type: "string" },
										finalNumber: { type: "number" },
									},
								},
							},
						},
					},
				},
			},
		},
		tags: {
			type: "array",
			items: { type: "string" },
		},
		orders: {
			type: "array",
			items: {
				type: "object",
				properties: {
					id: { type: "number" },
					product: { type: "string" },
					quantity: { type: "integer" },
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
				ultraDeep: {
					finalValue: "end",
					finalNumber: 99.9,
				},
			},
		},
	},
	tags: ["developer", "typescript"],
	orders: [
		{ id: 1, product: "Keyboard", quantity: 1 },
		{ id: 2, product: "Monitor", quantity: 2 },
	],
	metadata: {
		role: "admin",
		level: 5,
	},
};

// ─── Helper to dig into nested outputSchema properties ───────────────────────
function getProps(
	schema: JSONSchema7 | undefined,
): Record<string, JSONSchema7> | undefined {
	if (!schema || typeof schema === "boolean") return undefined;
	return schema.properties as Record<string, JSONSchema7> | undefined;
}

function getPropAt(
	schema: JSONSchema7,
	...path: string[]
): JSONSchema7 | undefined {
	let current: JSONSchema7 | undefined = schema;
	for (const key of path) {
		const props = getProps(current);
		if (!props) return undefined;
		current = props[key];
	}
	return current;
}

describe("schema-driven type coercion via coerceSchema", () => {
	beforeEach(() => {
		clearCompilationCache();
	});

	// ─── Default Behavior — No Coercion from inputSchema ─────────────────────

	describe("default behavior — inputSchema never influences coercion", () => {
		test("string template '123' → detectLiteralType → number (regardless of inputSchema)", () => {
			const result = engine.analyze("123", { type: "string" });
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("string template 'true' → detectLiteralType → boolean (regardless of inputSchema)", () => {
			const result = engine.analyze("true", { type: "string" });
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		});

		test("string template 'null' → detectLiteralType → null (regardless of inputSchema)", () => {
			const result = engine.analyze("null", { type: "string" });
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "null" });
		});

		test("string template '42' with inputSchema type integer → still number (no coercion)", () => {
			const result = engine.analyze("42", { type: "integer" });
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("object template '123' with inputSchema string property → detectLiteralType → number", () => {
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
				properties: { meetingId: { type: "number" } },
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
				properties: { status: { type: "string" } },
				required: ["status"],
			});
		});

		test("deeply nested object without coerceSchema → all detectLiteralType", () => {
			const result = engine.analyze(
				{
					config: {
						maxRetries: "3",
						timeout: "5000",
						nested: {
							deep: {
								value: "42",
								count: "10",
								ultraDeep: {
									finalValue: "100",
									finalNumber: "99",
								},
							},
						},
					},
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			// Without coerceSchema, everything uses detectLiteralType:
			// "3" → number, "5000" → number, "42" → number, "10" → number,
			// "100" → number, "99" → number
			expect(
				getPropAt(result.outputSchema as JSONSchema7, "config", "maxRetries"),
			).toEqual({ type: "number" });
			expect(
				getPropAt(result.outputSchema as JSONSchema7, "config", "timeout"),
			).toEqual({ type: "number" });
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"value",
				),
			).toEqual({ type: "number" });
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"count",
				),
			).toEqual({ type: "number" });
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"ultraDeep",
					"finalValue",
				),
			).toEqual({ type: "number" });
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"ultraDeep",
					"finalNumber",
				),
			).toEqual({ type: "number" });
		});

		test("Handlebars expression resolves from inputSchema as usual (no coercion involved)", () => {
			const result = engine.analyze("{{name}}", complexSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("standalone analyze() without coerceSchema → detectLiteralType", () => {
			const r1 = analyze("123", { type: "string" });
			expect(r1.outputSchema).toEqual({ type: "number" });

			const r2 = analyze("true", { type: "boolean" });
			expect(r2.outputSchema).toEqual({ type: "boolean" });

			const r3 = analyze("null", { type: "number" });
			expect(r3.outputSchema).toEqual({ type: "null" });

			const r4 = analyze("hello", { type: "number" });
			expect(r4.outputSchema).toEqual({ type: "string" });
		});
	});

	// ─── Explicit coerceSchema — Overrides detectLiteralType ─────────────────

	describe("explicit coerceSchema — overrides detectLiteralType", () => {
		test("string template '123' with coerceSchema string → outputSchema string", () => {
			const result = engine.analyze(
				"123",
				{ type: "object", properties: {} },
				{
					coerceSchema: { type: "string" },
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("string template '123' with coerceSchema number → outputSchema number", () => {
			const result = engine.analyze(
				"123",
				{ type: "object", properties: {} },
				{
					coerceSchema: { type: "number" },
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
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
			expect(result.outputSchema).toEqual({ type: "integer" });
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
			expect(result.outputSchema).toEqual({ type: "string" });
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
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("string template 'null' with coerceSchema null → outputSchema null", () => {
			const result = engine.analyze(
				"null",
				{ type: "object", properties: {} },
				{
					coerceSchema: { type: "null" },
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "null" });
		});

		test("string template 'true' with coerceSchema boolean → outputSchema boolean", () => {
			const result = engine.analyze(
				"true",
				{ type: "object", properties: {} },
				{
					coerceSchema: { type: "boolean" },
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		});
	});

	// ─── coerceSchema with Object Templates ──────────────────────────────────

	describe("coerceSchema with object templates", () => {
		test("object template with coerceSchema — property respects coercion", () => {
			const result = engine.analyze(
				{ meetingId: "123" },
				{
					type: "object",
					properties: { meetingId: { type: "number" } },
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
				properties: { meetingId: { type: "string" } },
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
				properties: { meetingId: { type: "number" } },
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
						properties: { count: { type: "string" } },
						required: ["count"],
					},
				},
				required: ["outer"],
			});
		});

		test("mixed: some properties in coerceSchema, some not → partial coercion", () => {
			const result = engine.analyze(
				{
					accountId: "12345",
					balance: "100.50",
					unknown: "999",
				},
				complexSchema,
				{
					coerceSchema: {
						type: "object",
						properties: {
							accountId: { type: "string" },
							// balance NOT in coerceSchema → detectLiteralType
							// unknown NOT in coerceSchema → detectLiteralType
						},
					},
				},
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// accountId: coerceSchema says string → "12345" stays string
			expect(props?.accountId).toEqual({ type: "string" });
			// balance: not in coerceSchema → detectLiteralType → number
			expect(props?.balance).toEqual({ type: "number" });
			// unknown: not in coerceSchema → detectLiteralType → number
			expect(props?.unknown).toEqual({ type: "number" });
		});
	});

	// ─── Deep Nesting with coerceSchema (4+ levels) ──────────────────────────

	describe("deep nesting with coerceSchema (4+ levels)", () => {
		test("4 levels deep — static '123' respects string coerceSchema at leaf", () => {
			const result = engine.analyze(
				{
					config: {
						nested: {
							deep: {
								value: "123",
							},
						},
					},
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			// complexSchema.config.nested.deep.value is { type: "string" }
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"value",
				),
			).toEqual({ type: "string" });
		});

		test("4 levels deep — static '42' respects integer coerceSchema at leaf", () => {
			const result = engine.analyze(
				{
					config: {
						nested: {
							deep: {
								count: "42",
							},
						},
					},
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"count",
				),
			).toEqual({ type: "integer" });
		});

		test("4 levels deep — static 'true' respects boolean coerceSchema at leaf", () => {
			const result = engine.analyze(
				{
					config: {
						nested: {
							deep: {
								flag: "true",
							},
						},
					},
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"flag",
				),
			).toEqual({ type: "boolean" });
		});

		test("5 levels deep — static '999' respects string coerceSchema at ultraDeep leaf", () => {
			const result = engine.analyze(
				{
					config: {
						nested: {
							deep: {
								ultraDeep: {
									finalValue: "999",
								},
							},
						},
					},
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"ultraDeep",
					"finalValue",
				),
			).toEqual({ type: "string" });
		});

		test("5 levels deep — static '3.14' respects number coerceSchema at ultraDeep leaf", () => {
			const result = engine.analyze(
				{
					config: {
						nested: {
							deep: {
								ultraDeep: {
									finalNumber: "3.14",
								},
							},
						},
					},
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"ultraDeep",
					"finalNumber",
				),
			).toEqual({ type: "number" });
		});

		test("multiple leaves at different depths — all respect coerceSchema", () => {
			const result = engine.analyze(
				{
					config: {
						maxRetries: "3",
						timeout: "5000",
						nested: {
							deep: {
								value: "42",
								count: "10",
								ultraDeep: {
									finalValue: "100",
									finalNumber: "99",
								},
							},
						},
					},
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);

			// maxRetries: coerceSchema says string → "3" stays string
			expect(
				getPropAt(result.outputSchema as JSONSchema7, "config", "maxRetries"),
			).toEqual({ type: "string" });
			// timeout: coerceSchema says number → "5000" → number
			expect(
				getPropAt(result.outputSchema as JSONSchema7, "config", "timeout"),
			).toEqual({ type: "number" });
			// value: coerceSchema says string → "42" stays string
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"value",
				),
			).toEqual({ type: "string" });
			// count: coerceSchema says integer → "10" → integer
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"count",
				),
			).toEqual({ type: "integer" });
			// finalValue: coerceSchema says string → "100" stays string
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"ultraDeep",
					"finalValue",
				),
			).toEqual({ type: "string" });
			// finalNumber: coerceSchema says number → "99" → number
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"ultraDeep",
					"finalNumber",
				),
			).toEqual({ type: "number" });
		});
	});

	// ─── Mixed: Static Literals + Handlebars Expressions with coerceSchema ───

	describe("mixed static literals and Handlebars expressions with coerceSchema", () => {
		test("sibling properties: static coerced + expressions → each correctly typed", () => {
			const result = engine.analyze(
				{
					accountId: "12345",
					name: "{{name}}",
					age: "{{age}}",
					balance: "100.50",
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// accountId: coerceSchema says string → "12345" stays string
			expect(props?.accountId).toEqual({ type: "string" });
			// name: Handlebars expression → resolved from inputSchema as string
			expect(props?.name).toEqual({ type: "string" });
			// age: Handlebars expression → resolved from inputSchema as number
			expect(props?.age).toEqual({ type: "number" });
			// balance: coerceSchema says number → "100.50" → number
			expect(props?.balance).toEqual({ type: "number" });
		});

		test("deep nesting: mix of static + expressions at the same level", () => {
			const result = engine.analyze(
				{
					config: {
						maxRetries: "5",
						nested: {
							deep: {
								value: "999",
								count: "{{score}}",
							},
						},
					},
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			// value: coerceSchema says string → "999" stays string
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"value",
				),
			).toEqual({ type: "string" });
			// count: {{score}} is a Handlebars expression → resolves to integer from inputSchema
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"count",
				),
			).toEqual({ type: "integer" });
		});

		test("mixed template (text + expression) is always string regardless of coerceSchema", () => {
			const result = engine.analyze(
				{
					accountId: "ACC-{{name}}",
				},
				complexSchema,
				{
					coerceSchema: {
						type: "object",
						properties: { accountId: { type: "number" } },
					},
				},
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// Mixed template → always string (concatenation), coerceSchema ignored
			expect(props?.accountId).toEqual({ type: "string" });
		});

		test("Handlebars expression ignores coerceSchema — only static literals affected", () => {
			const result = engine.analyze("{{name}}", complexSchema, {
				coerceSchema: { type: "number" },
			});
			expect(result.valid).toBe(true);
			// {{name}} resolves to string from inputSchema, not number from coerceSchema
			expect(result.outputSchema).toEqual({ type: "string" });
		});
	});

	// ─── Coexistence with Block Helpers ───────────────────────────────────────

	describe("coexistence with {{#if}} blocks + coerceSchema", () => {
		test("property with #if block — coerceSchema on sibling static literal", () => {
			const result = engine.analyze(
				{
					accountId: "12345",
					name: "{{#if active}}{{name}}{{else}}unknown{{/if}}",
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// Static literal + coerceSchema string → stays string
			expect(props?.accountId).toEqual({ type: "string" });
			// #if block: both branches are string
			expect(props?.name).toEqual({ type: "string" });
		});

		test("#if block returning different types → oneOf, coerceSchema on sibling", () => {
			const result = engine.analyze(
				{
					accountId: "67890",
					result: "{{#if active}}{{age}}{{else}}{{name}}{{/if}}",
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// Static → coerceSchema string
			expect(props?.accountId).toEqual({ type: "string" });
			// if block: age is number, name is string → oneOf
			expect(props?.result).toEqual({
				oneOf: [{ type: "number" }, { type: "string" }],
			});
		});

		test("nested object with some #if and some static literals + coerceSchema", () => {
			const result = engine.analyze(
				{
					config: {
						maxRetries: "3",
						enabled: "{{#if active}}true{{else}}false{{/if}}",
					},
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			// Static "3" with coerceSchema string → string
			expect(
				getPropAt(result.outputSchema as JSONSchema7, "config", "maxRetries"),
			).toEqual({ type: "string" });
			// #if returns "true"/"false" as static content → boolean (detectLiteralType in block)
			expect(
				getPropAt(result.outputSchema as JSONSchema7, "config", "enabled"),
			).toEqual({ type: "boolean" });
		});
	});

	describe("coexistence with {{#each}} blocks + coerceSchema", () => {
		test("property with #each block alongside coerced static values", () => {
			const result = engine.analyze(
				{
					accountId: "55555",
					tagList: "{{#each tags}}{{this}}, {{/each}}",
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// Static coercion: coerceSchema string
			expect(props?.accountId).toEqual({ type: "string" });
			// #each with text → mixed template → string
			expect(props?.tagList).toEqual({ type: "string" });
		});

		test("#each producing single expression alongside coerced static literals", () => {
			const result = engine.analyze(
				{
					accountId: "99",
					firstTag: "{{#each tags}}{{this}}{{/each}}",
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// "99" with coerceSchema string → string
			expect(props?.accountId).toEqual({ type: "string" });
			// #each always produces string
			expect(props?.firstTag).toEqual({ type: "string" });
		});
	});

	describe("coexistence with {{#with}} blocks + coerceSchema", () => {
		test("#with block alongside coerced static values", () => {
			const result = engine.analyze(
				{
					accountId: "42",
					metaRole: "{{#with metadata}}{{role}}{{/with}}",
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// "42" with coerceSchema string → string
			expect(props?.accountId).toEqual({ type: "string" });
			// #with resolves to metadata.role which is string
			expect(props?.metaRole).toEqual({ type: "string" });
		});
	});

	// ─── Properties Not In coerceSchema → Fallback to detectLiteralType ──────

	describe("properties not in coerceSchema → fallback to detectLiteralType", () => {
		test("unknown property with numeric string → defaults to number", () => {
			const result = engine.analyze({ unknownProp: "123" }, complexSchema, {
				coerceSchema: complexSchema,
			});
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// Not in coerceSchema → falls back to detectLiteralType → number
			expect(props?.unknownProp).toEqual({ type: "number" });
		});

		test("unknown property with boolean string → defaults to boolean", () => {
			const result = engine.analyze({ unknownProp: "true" }, complexSchema, {
				coerceSchema: complexSchema,
			});
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			expect(props?.unknownProp).toEqual({ type: "boolean" });
		});

		test("unknown property with null string → defaults to null", () => {
			const result = engine.analyze({ unknownProp: "null" }, complexSchema, {
				coerceSchema: complexSchema,
			});
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			expect(props?.unknownProp).toEqual({ type: "null" });
		});

		test("unknown property with non-literal string → defaults to string", () => {
			const result = engine.analyze(
				{ unknownProp: "hello world" },
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			expect(props?.unknownProp).toEqual({ type: "string" });
		});

		test("mix of coerced + unknown properties at the same level", () => {
			const result = engine.analyze(
				{
					accountId: "12345",
					notInSchema: "67890",
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// Known in coerceSchema: string → stays string
			expect(props?.accountId).toEqual({ type: "string" });
			// Unknown: no coerceSchema entry → detectLiteralType → number
			expect(props?.notInSchema).toEqual({ type: "number" });
		});

		test("deep unknown property — parent known but child unknown in coerceSchema", () => {
			const result = engine.analyze(
				{
					config: {
						notDeclared: "999",
					},
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			// config is in coerceSchema, but notDeclared is not → fallback to number
			expect(
				getPropAt(result.outputSchema as JSONSchema7, "config", "notDeclared"),
			).toEqual({ type: "number" });
		});
	});

	// ─── Standalone analyze() Function with coerceSchema ─────────────────────

	describe("standalone analyze() function with coerceSchema", () => {
		test("string template with coerceSchema → respects coercion", () => {
			const r1 = analyze(
				"123",
				{ type: "string" },
				{ coerceSchema: { type: "string" } },
			);
			expect(r1.outputSchema).toEqual({ type: "string" });

			const r2 = analyze(
				"123",
				{ type: "string" },
				{ coerceSchema: { type: "number" } },
			);
			expect(r2.outputSchema).toEqual({ type: "number" });

			const r3 = analyze(
				"true",
				{ type: "string" },
				{ coerceSchema: { type: "string" } },
			);
			expect(r3.outputSchema).toEqual({ type: "string" });

			const r4 = analyze(
				"null",
				{ type: "string" },
				{ coerceSchema: { type: "string" } },
			);
			expect(r4.outputSchema).toEqual({ type: "string" });
		});

		test("standalone analyze with object template + coerceSchema → deep nesting works", () => {
			const result = analyze(
				{
					config: {
						nested: {
							deep: {
								value: "456",
							},
						},
					},
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);
			expect(result.valid).toBe(true);
			// complexSchema says value is string → "456" stays string
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"value",
				),
			).toEqual({ type: "string" });
		});

		test("standalone analyze with object template without coerceSchema → detectLiteralType", () => {
			const result = analyze(
				{
					config: {
						nested: {
							deep: {
								value: "456",
							},
						},
					},
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			// No coerceSchema → "456" → number
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"value",
				),
			).toEqual({ type: "number" });
		});
	});

	// ─── JS Primitive Literals Are Not Affected ──────────────────────────────

	describe("JS primitive literals are not affected by coerceSchema", () => {
		test("numeric JS literal → always integer/number regardless of coerceSchema", () => {
			const result = engine.analyze({ accountId: 42 }, complexSchema, {
				coerceSchema: complexSchema,
			});
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// JS number 42 → inferPrimitiveSchema → integer, coerceSchema irrelevant
			expect(props?.accountId).toEqual({ type: "integer" });
		});

		test("boolean JS literal → always boolean regardless of coerceSchema", () => {
			const result = engine.analyze({ accountId: true }, complexSchema, {
				coerceSchema: complexSchema,
			});
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			expect(props?.accountId).toEqual({ type: "boolean" });
		});

		test("null JS literal → always null regardless of coerceSchema", () => {
			const result = engine.analyze({ accountId: null }, complexSchema, {
				coerceSchema: complexSchema,
			});
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			expect(props?.accountId).toEqual({ type: "null" });
		});
	});

	// ─── The Mega Test: Everything Combined with coerceSchema ────────────────

	describe("mega integration test — all features with coerceSchema", () => {
		test("deeply nested object with coerceSchema coercion, expressions, #if, unknown props, and literals", () => {
			const result = engine.analyze(
				{
					// Static literal coerced by coerceSchema (string → stays string)
					accountId: "12345",
					// Expression resolved from inputSchema
					name: "{{name}}",
					// JS numeric literal (not affected by coerceSchema)
					priority: 7,
					// Static literal coerced by coerceSchema (number → becomes number)
					balance: "500.25",
					// Mixed template → always string
					greeting: "Hello {{name}}!",
					// #if block with expression
					status: "{{#if active}}{{name}} is active{{else}}inactive{{/if}}",
					// Boolean JS literal
					isAdmin: true,
					// Null JS literal
					nothing: null,
					// Unknown property → falls back to detectLiteralType (number)
					notInSchema: "9999",
					// Unknown property → falls back to string (non-numeric)
					alsoNotInSchema: "hello",
					// Deep nesting with coerceSchema coercion
					config: {
						// coerceSchema: string → "3" stays string
						maxRetries: "3",
						// coerceSchema: number → "5000" becomes number
						timeout: "5000",
						// Expression
						enabled: "{{active}}",
						nested: {
							deep: {
								// coerceSchema: string → "42" stays string
								value: "42",
								// coerceSchema: integer → "10" becomes integer
								count: "10",
								// Expression
								flag: "{{active}}",
								ultraDeep: {
									// coerceSchema: string → "100" stays string
									finalValue: "100",
									// coerceSchema: number → "99" becomes number
									finalNumber: "99",
								},
							},
						},
					},
					// Nested object with coerceSchema
					metadata: {
						// coerceSchema: string → "admin" stays string
						role: "admin",
						// coerceSchema: number → "5" becomes number
						level: "5",
					},
				},
				complexSchema,
				{ coerceSchema: complexSchema },
			);

			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);

			const props = getProps(result.outputSchema as JSONSchema7);

			// ── Top-level properties ──────────────────────────────────────
			expect(props?.accountId).toEqual({ type: "string" });
			expect(props?.name).toEqual({ type: "string" });
			expect(props?.priority).toEqual({ type: "integer" });
			expect(props?.balance).toEqual({ type: "number" });
			expect(props?.greeting).toEqual({ type: "string" });
			expect(props?.status).toEqual({ type: "string" });
			expect(props?.isAdmin).toEqual({ type: "boolean" });
			expect(props?.nothing).toEqual({ type: "null" });
			expect(props?.notInSchema).toEqual({ type: "number" });
			expect(props?.alsoNotInSchema).toEqual({ type: "string" });

			// ── config (level 2) ──────────────────────────────────────────
			expect(
				getPropAt(result.outputSchema as JSONSchema7, "config", "maxRetries"),
			).toEqual({ type: "string" });
			expect(
				getPropAt(result.outputSchema as JSONSchema7, "config", "timeout"),
			).toEqual({ type: "number" });
			expect(
				getPropAt(result.outputSchema as JSONSchema7, "config", "enabled"),
			).toEqual({ type: "boolean" });

			// ── config.nested.deep (level 4) ──────────────────────────────
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"value",
				),
			).toEqual({ type: "string" });
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"count",
				),
			).toEqual({ type: "integer" });
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"flag",
				),
			).toEqual({ type: "boolean" });

			// ── config.nested.deep.ultraDeep (level 5) ────────────────────
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"ultraDeep",
					"finalValue",
				),
			).toEqual({ type: "string" });
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"ultraDeep",
					"finalNumber",
				),
			).toEqual({ type: "number" });

			// ── metadata (level 2) ────────────────────────────────────────
			expect(
				getPropAt(result.outputSchema as JSONSchema7, "metadata", "role"),
			).toEqual({ type: "string" });
			expect(
				getPropAt(result.outputSchema as JSONSchema7, "metadata", "level"),
			).toEqual({ type: "number" });
		});

		test("mega analyzeAndExecute — analysis types correct AND execution values correct", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				{
					accountId: "12345",
					name: "{{name}}",
					age: "{{age}}",
					balance: "500.25",
					greeting: "Hello {{name}}!",
					active: "{{active}}",
					priority: 7,
					isNull: null,
					notInSchema: "42",
					config: {
						maxRetries: "3",
						timeout: "5000",
						nested: {
							deep: {
								value: "999",
								count: "{{score}}",
								ultraDeep: {
									finalValue: "100",
								},
							},
						},
					},
					metadata: {
						role: "admin",
						level: "5",
					},
				},
				complexSchema,
				complexData,
				{ coerceSchema: complexSchema },
			);

			expect(analysis.valid).toBe(true);
			expect(analysis.diagnostics).toEqual([]);

			// ── Analysis types ─────────────────────────────────────────────
			const props = getProps(analysis.outputSchema as JSONSchema7);
			expect(props?.accountId).toEqual({ type: "string" });
			expect(props?.name).toEqual({ type: "string" });
			expect(props?.age).toEqual({ type: "number" });
			expect(props?.balance).toEqual({ type: "number" });
			expect(props?.greeting).toEqual({ type: "string" });
			expect(props?.active).toEqual({ type: "boolean" });
			expect(props?.priority).toEqual({ type: "integer" });
			expect(props?.isNull).toEqual({ type: "null" });
			expect(props?.notInSchema).toEqual({ type: "number" });

			expect(
				getPropAt(analysis.outputSchema as JSONSchema7, "config", "maxRetries"),
			).toEqual({ type: "string" });
			expect(
				getPropAt(analysis.outputSchema as JSONSchema7, "config", "timeout"),
			).toEqual({ type: "number" });
			expect(
				getPropAt(
					analysis.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"value",
				),
			).toEqual({ type: "string" });

			expect(
				getPropAt(
					analysis.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
					"ultraDeep",
					"finalValue",
				),
			).toEqual({ type: "string" });

			expect(
				getPropAt(analysis.outputSchema as JSONSchema7, "metadata", "role"),
			).toEqual({ type: "string" });
			expect(
				getPropAt(analysis.outputSchema as JSONSchema7, "metadata", "level"),
			).toEqual({ type: "number" });

			// ── Execution values ───────────────────────────────────────────
			// With coerceSchema provided, static literals are coerced at
			// execution time to match the declared schema type.
			const v = value as Record<string, unknown>;
			// accountId: coerceSchema says string → stays "12345"
			expect(v.accountId).toBe("12345");
			// name: {{name}} resolves from data → "Alice"
			expect(v.name).toBe("Alice");
			// age: {{age}} resolves from data → 30
			expect(v.age).toBe(30);
			// balance: coerceSchema says number → "500.25" coerced to 500.25
			expect(v.balance).toBe(500.25);
			// greeting: mixed template → always string
			expect(v.greeting).toBe("Hello Alice!");
			// active: {{active}} resolves from data → true
			expect(v.active).toBe(true);
			// priority: JS literal 7 → passthrough
			expect(v.priority).toBe(7);
			// isNull: JS literal null → passthrough
			expect(v.isNull).toBe(null);
			// notInSchema: not in coerceSchema → auto-detect → number
			expect(v.notInSchema).toBe(42);

			const vConfig = v.config as Record<string, unknown>;
			// maxRetries: coerceSchema says string → stays "3"
			expect(vConfig.maxRetries).toBe("3");
			// timeout: coerceSchema says number → "5000" coerced to 5000
			expect(vConfig.timeout).toBe(5000);

			const vNested = vConfig.nested as Record<string, unknown>;
			const vDeep = vNested.deep as Record<string, unknown>;
			// value: coerceSchema says string → stays "999"
			expect(vDeep.value).toBe("999");
			// count: {{score}} resolves from data → 95
			expect(vDeep.count).toBe(95); // {{score}} → 95

			const vUltraDeep = vDeep.ultraDeep as Record<string, unknown>;
			// finalValue: coerceSchema says string → stays "100"
			expect(vUltraDeep.finalValue).toBe("100");

			const vMeta = v.metadata as Record<string, unknown>;
			// role: coerceSchema says string → stays "admin"
			expect(vMeta.role).toBe("admin");
			// level: coerceSchema says number → "5" coerced to 5
			expect(vMeta.level).toBe(5);
		});
	});

	// ─── Edge Cases ──────────────────────────────────────────────────────────

	describe("edge cases", () => {
		test("empty string template with coerceSchema string → string", () => {
			const result = engine.analyze({ accountId: "" }, complexSchema, {
				coerceSchema: complexSchema,
			});
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			expect(props?.accountId).toEqual({ type: "string" });
		});

		test("whitespace-only string with coerceSchema string → string", () => {
			const result = engine.analyze({ accountId: "   " }, complexSchema, {
				coerceSchema: complexSchema,
			});
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			expect(props?.accountId).toEqual({ type: "string" });
		});

		test("negative number string with coerceSchema number → number", () => {
			const result = engine.analyze({ balance: "-500" }, complexSchema, {
				coerceSchema: complexSchema,
			});
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			expect(props?.balance).toEqual({ type: "number" });
		});

		test("decimal string with coerceSchema number → number", () => {
			const result = engine.analyze({ balance: "3.14159" }, complexSchema, {
				coerceSchema: complexSchema,
			});
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			expect(props?.balance).toEqual({ type: "number" });
		});

		test("empty object template → empty object output", () => {
			const result = engine.analyze({}, complexSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {},
				required: [],
			});
		});

		test("deeply nested empty objects → correct structure", () => {
			const result = engine.analyze(
				{ config: { nested: { deep: {} } } },
				complexSchema,
			);
			expect(result.valid).toBe(true);
			expect(
				getPropAt(
					result.outputSchema as JSONSchema7,
					"config",
					"nested",
					"deep",
				),
			).toEqual({
				type: "object",
				properties: {},
				required: [],
			});
		});

		test("coerceSchema with no type for a property → falls back to detectLiteralType", () => {
			const result = engine.analyze(
				{ value: "123" },
				{ type: "object", properties: {} },
				{
					coerceSchema: {
						type: "object",
						properties: { value: {} }, // No type declared
					},
				},
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// coerceSchema has no type → doesn't match primitive type check → falls back
			expect(props?.value).toEqual({ type: "number" });
		});

		test("coerceSchema with array type for a property → falls back to detectLiteralType", () => {
			const result = engine.analyze(
				{ value: "123" },
				{ type: "object", properties: {} },
				{
					coerceSchema: {
						type: "object",
						properties: { value: { type: "array", items: { type: "string" } } },
					},
				},
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// coerceSchema type is "array" (not a primitive) → falls back
			expect(props?.value).toEqual({ type: "number" });
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

		test("coerceSchema is a primitive type (not object) — direct string template", () => {
			expect(
				engine.analyze(
					"42",
					{ type: "string" },
					{ coerceSchema: { type: "string" } },
				).outputSchema,
			).toEqual({ type: "string" });
			expect(
				engine.analyze(
					"42",
					{ type: "string" },
					{ coerceSchema: { type: "number" } },
				).outputSchema,
			).toEqual({ type: "number" });
			expect(
				engine.analyze(
					"42",
					{ type: "string" },
					{ coerceSchema: { type: "integer" } },
				).outputSchema,
			).toEqual({ type: "integer" });
		});

		test("without coerceSchema, inputSchema primitive type does NOT influence output", () => {
			// This is the critical test: inputSchema is { type: "string" } but
			// without coerceSchema, "42" should be detected as number
			expect(engine.analyze("42", { type: "string" }).outputSchema).toEqual({
				type: "number",
			});
			expect(engine.analyze("42", { type: "integer" }).outputSchema).toEqual({
				type: "number",
			});
		});
	});

	// ─── Schema with additionalProperties + coerceSchema ─────────────────────

	describe("schema with additionalProperties + coerceSchema", () => {
		test("additionalProperties: true in coerceSchema → unknown properties fall back to detectLiteralType", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					name: { type: "string" },
				},
				additionalProperties: true,
			};
			const result = engine.analyze({ name: "123", extra: "456" }, schema, {
				coerceSchema: schema,
			});
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// name has coerceSchema string → "123" stays string
			expect(props?.name).toEqual({ type: "string" });
			// extra: additionalProperties is true → resolveSchemaPath returns {}
			// → no type → falls back to detectLiteralType → number
			expect(props?.extra).toEqual({ type: "number" });
		});

		test("additionalProperties with typed schema in coerceSchema → coerces extra properties", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					name: { type: "string" },
				},
				additionalProperties: { type: "string" },
			};
			const result = engine.analyze({ name: "123", extra: "456" }, schema, {
				coerceSchema: schema,
			});
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// name: coerceSchema string → "123" stays string
			expect(props?.name).toEqual({ type: "string" });
			// extra: additionalProperties says string → "456" stays string
			expect(props?.extra).toEqual({ type: "string" });
		});

		test("additionalProperties without coerceSchema → all detectLiteralType", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					name: { type: "string" },
				},
				additionalProperties: { type: "string" },
			};
			const result = engine.analyze({ name: "123", extra: "456" }, schema);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// Without coerceSchema → all detectLiteralType → number
			expect(props?.name).toEqual({ type: "number" });
			expect(props?.extra).toEqual({ type: "number" });
		});
	});

	// ─── coerceSchema separate from inputSchema ──────────────────────────────

	describe("coerceSchema is independent from inputSchema", () => {
		test("inputSchema and coerceSchema can have different structures", () => {
			const inputSchema: JSONSchema7 = {
				type: "object",
				properties: {
					userName: { type: "string" },
					userAge: { type: "number" },
				},
			};
			const coerceSchema: JSONSchema7 = {
				type: "object",
				properties: {
					meetingId: { type: "string" },
					count: { type: "integer" },
				},
			};
			const result = engine.analyze(
				{
					meetingId: "12345",
					count: "42",
					label: "{{userName}}",
				},
				inputSchema,
				{ coerceSchema },
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// meetingId: coerceSchema says string → stays string
			expect(props?.meetingId).toEqual({ type: "string" });
			// count: coerceSchema says integer → becomes integer
			expect(props?.count).toEqual({ type: "integer" });
			// label: Handlebars → resolves from inputSchema as string
			expect(props?.label).toEqual({ type: "string" });
		});

		test("coerceSchema with properties not in inputSchema — no cross-contamination", () => {
			const inputSchema: JSONSchema7 = {
				type: "object",
				properties: {
					name: { type: "string" },
				},
			};
			const coerceSchema: JSONSchema7 = {
				type: "object",
				properties: {
					code: { type: "string" },
				},
			};
			const result = engine.analyze(
				{
					code: "404",
					name: "{{name}}",
				},
				inputSchema,
				{ coerceSchema },
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// code: coerceSchema says string → "404" stays string
			expect(props?.code).toEqual({ type: "string" });
			// name: Handlebars → resolved from inputSchema as string
			expect(props?.name).toEqual({ type: "string" });
		});
	});

	// ─── Array coerceSchema propagation ───────────────────────────────────────
	describe("coerceSchema with array templates", () => {
		test("flat array of numeric strings with coerceSchema items string → all string", () => {
			const result = engine.analyze(["1", "2", "3"], undefined, {
				coerceSchema: { type: "array", items: { type: "string" } },
			});
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("flat array of numeric strings without coerceSchema → detectLiteralType → number", () => {
			const result = engine.analyze(["1", "2", "3"]);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "number" },
			});
		});

		test("flat array of boolean strings with coerceSchema items string → all string", () => {
			const result = engine.analyze(["true", "false"], undefined, {
				coerceSchema: { type: "array", items: { type: "string" } },
			});
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("flat array of 'null' strings with coerceSchema items string → all string", () => {
			const result = engine.analyze(["null", "null"], undefined, {
				coerceSchema: { type: "array", items: { type: "string" } },
			});
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("flat array with coerceSchema items integer → all integer", () => {
			const result = engine.analyze(["1", "2", "3"], undefined, {
				coerceSchema: { type: "array", items: { type: "integer" } },
			});
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "integer" },
			});
		});

		test("array with mixed literal types + coerceSchema items string → all string", () => {
			const result = engine.analyze(
				["42", "true", "null", "hello"],
				undefined,
				{
					coerceSchema: { type: "array", items: { type: "string" } },
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("array with JS primitive literals → not affected by coerceSchema", () => {
			const result = engine.analyze([42, true, null], undefined, {
				coerceSchema: { type: "array", items: { type: "string" } },
			});
			expect(result.valid).toBe(true);
			// JS primitives are never coerced — they keep their inferred types
			const schema = result.outputSchema as JSONSchema7;
			expect(schema.type).toBe("array");
			const items = schema.items as JSONSchema7;
			expect(items.oneOf).toBeDefined();
		});

		test("array containing objects — coerceSchema.items propagates into object properties", () => {
			const result = engine.analyze(
				[
					{ id: "1", name: "Alice" },
					{ id: "2", name: "Bob" },
				],
				undefined,
				{
					coerceSchema: {
						type: "array",
						items: {
							type: "object",
							properties: {
								id: { type: "string" },
								name: { type: "string" },
							},
						},
					},
				},
			);
			expect(result.valid).toBe(true);
			const schema = result.outputSchema as JSONSchema7;
			expect(schema.type).toBe("array");
			const itemSchema = schema.items as JSONSchema7;
			expect(itemSchema.type).toBe("object");
			const props = getProps(itemSchema);
			// "1" would be number without coerceSchema, but string with it
			expect(props?.id).toEqual({ type: "string" });
			expect(props?.name).toEqual({ type: "string" });
		});

		test("nested array in object — coerceSchema propagates through object then into array items", () => {
			const result = engine.analyze({ ids: ["1", "2"] }, undefined, {
				coerceSchema: {
					type: "object",
					properties: {
						ids: { type: "array", items: { type: "string" } },
					},
				},
			});
			expect(result.valid).toBe(true);
			const schema = result.outputSchema as JSONSchema7;
			expect(schema.type).toBe("object");
			const props = getProps(schema);
			const idsSchema = props?.ids as JSONSchema7;
			expect(idsSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("nested array in object without coerceSchema → detectLiteralType → number", () => {
			const result = engine.analyze({ ids: ["1", "2"] });
			expect(result.valid).toBe(true);
			const schema = result.outputSchema as JSONSchema7;
			const props = getProps(schema);
			const idsSchema = props?.ids as JSONSchema7;
			expect(idsSchema).toEqual({
				type: "array",
				items: { type: "number" },
			});
		});

		test("deeply nested: object → array → object → array → string coercion", () => {
			const result = engine.analyze(
				{
					data: [
						{
							tags: ["100", "200"],
						},
					],
				},
				undefined,
				{
					coerceSchema: {
						type: "object",
						properties: {
							data: {
								type: "array",
								items: {
									type: "object",
									properties: {
										tags: {
											type: "array",
											items: { type: "string" },
										},
									},
								},
							},
						},
					},
				},
			);
			expect(result.valid).toBe(true);
			const schema = result.outputSchema as JSONSchema7;
			const dataSchema = getProps(schema)?.data as JSONSchema7;
			expect(dataSchema.type).toBe("array");
			const dataItemSchema = dataSchema.items as JSONSchema7;
			const tagsSchema = getProps(dataItemSchema)?.tags as JSONSchema7;
			expect(tagsSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("array coerceSchema without items property → falls back to detectLiteralType", () => {
			const result = engine.analyze(["1", "2"], undefined, {
				coerceSchema: { type: "array" },
			});
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "number" },
			});
		});

		test("standalone analyze() with array template + coerceSchema", () => {
			const result = analyze(["42", "true", "null"], undefined, {
				coerceSchema: { type: "array", items: { type: "string" } },
			});
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("standalone analyze() with nested object+array + coerceSchema", () => {
			const result = analyze({ codes: ["404", "500"] }, undefined, {
				coerceSchema: {
					type: "object",
					properties: {
						codes: { type: "array", items: { type: "string" } },
					},
				},
			});
			expect(result.valid).toBe(true);
			const schema = result.outputSchema as JSONSchema7;
			const props = getProps(schema);
			expect(props?.codes).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});
	});

	// ─── Array coerceSchema with analyzeAndExecute ───────────────────────────
	describe("coerceSchema array propagation with analyzeAndExecute", () => {
		test("array of numeric strings — analysis types string, execution values string", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				["1", "2", "3"],
				{},
				{},
				{
					coerceSchema: { type: "array", items: { type: "string" } },
				},
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
			expect(value).toEqual(["1", "2", "3"]);
		});

		test("nested object with array — analysis and execution both propagate coerceSchema", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				{ ids: ["1", "2"] },
				{},
				{},
				{
					coerceSchema: {
						type: "object",
						properties: {
							ids: { type: "array", items: { type: "string" } },
						},
					},
				},
			);
			expect(analysis.valid).toBe(true);
			const schema = analysis.outputSchema as JSONSchema7;
			const props = getProps(schema);
			expect(props?.ids).toEqual({
				type: "array",
				items: { type: "string" },
			});
			expect(value).toEqual({ ids: ["1", "2"] });
		});
	});

	// ─── coerceSchema Custom Metadata Preservation ───────────────────────────
	// When a coerceSchema includes extra properties beyond `type` (e.g.
	// `constraints`, `description`, `format`), they must be preserved in the
	// outputSchema — not stripped down to just `{ type }`.

	describe("coerceSchema custom metadata preservation", () => {
		test("string template with coerceSchema containing constraints → outputSchema preserves constraints", () => {
			const result = engine.analyze(
				"salut",
				{ type: "object", properties: {} },
				{
					coerceSchema: {
						type: "string",
						constraints: "IsUuid",
					} as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema as unknown).toEqual({
				type: "string",
				constraints: "IsUuid",
			});
		});

		test("numeric string with coerceSchema number + constraints → outputSchema preserves constraints", () => {
			const result = engine.analyze(
				"123",
				{ type: "object", properties: {} },
				{
					coerceSchema: {
						type: "number",
						constraints: "IsPositive",
					} as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema as unknown).toEqual({
				type: "number",
				constraints: "IsPositive",
			});
		});

		test("boolean string with coerceSchema boolean + description → outputSchema preserves description", () => {
			const result = engine.analyze(
				"true",
				{ type: "object", properties: {} },
				{
					coerceSchema: {
						type: "boolean",
						description: "Is the feature enabled",
					} as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "boolean",
				description: "Is the feature enabled",
			});
		});

		test("object template — per-property coerceSchema metadata preserved in outputSchema", () => {
			const result = engine.analyze(
				{
					ok: "salut",
					count: "42",
				} as TemplateInput,
				{},
				{
					coerceSchema: {
						type: "object",
						properties: {
							ok: { type: "string", constraints: "IsUuid" },
							count: { type: "integer", constraints: "IsPositive" },
						},
					} as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			expect(props?.ok as unknown).toEqual({
				type: "string",
				constraints: "IsUuid",
			});
			expect(props?.count as unknown).toEqual({
				type: "integer",
				constraints: "IsPositive",
			});
		});

		test("object template with excludeTemplateExpression — dropped key removed, kept key preserves metadata", () => {
			const result = engine.analyzeAndExecute(
				{
					accountId: "{{accountId}}",
					ok: "salut",
				} as TemplateInput,
				undefined,
				{},
				{
					excludeTemplateExpression: true,
					coerceSchema: {
						type: "object",
						properties: {
							ok: { type: "string", constraints: "IsUuid" },
							accountId: { type: "string", constraints: "IsUuid" },
						},
					} as JSONSchema7,
				},
			);
			expect(result.analysis.valid).toBe(true);
			const schema = result.analysis.outputSchema as JSONSchema7;
			const props = getProps(schema);
			// accountId should be dropped (it was a template expression)
			expect(props?.accountId).toBeUndefined();
			// ok should preserve the full coerceSchema including constraints
			expect(props?.ok as unknown).toEqual({
				type: "string",
				constraints: "IsUuid",
			});
			expect(result.value).toEqual({ ok: "salut" });
		});

		test("deeply nested object — coerceSchema metadata preserved at every level", () => {
			const result = engine.analyze(
				{
					config: {
						nested: {
							value: "hello",
						},
					},
				} as TemplateInput,
				{},
				{
					coerceSchema: {
						type: "object",
						properties: {
							config: {
								type: "object",
								properties: {
									nested: {
										type: "object",
										properties: {
											value: {
												type: "string",
												constraints: "IsNotEmpty",
												format: "custom",
											},
										},
									},
								},
							},
						},
					} as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			const valueSchema = getPropAt(
				result.outputSchema as JSONSchema7,
				"config",
				"nested",
				"value",
			);
			expect(valueSchema as unknown).toEqual({
				type: "string",
				constraints: "IsNotEmpty",
				format: "custom",
			});
		});

		test("array template — coerceSchema items metadata preserved", () => {
			const result = engine.analyze(
				["abc", "def"] as TemplateInput,
				{},
				{
					coerceSchema: {
						type: "array",
						items: {
							type: "string",
							constraints: "IsAlpha",
						},
					} as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			const schema = result.outputSchema as JSONSchema7;
			expect(schema.type).toBe("array");
			expect(schema.items as unknown).toEqual({
				type: "string",
				constraints: "IsAlpha",
			});
		});

		test("coerceSchema with format property → preserved in outputSchema", () => {
			const result = engine.analyze(
				"test@example.com",
				{ type: "object", properties: {} },
				{
					coerceSchema: {
						type: "string",
						format: "email",
					} as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "string",
				format: "email",
			});
		});

		test("coerceSchema with multiple extra properties → all preserved", () => {
			const result = engine.analyze(
				"42",
				{ type: "object", properties: {} },
				{
					coerceSchema: {
						type: "integer",
						minimum: 0,
						maximum: 100,
						description: "A percentage value",
					} as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "integer",
				minimum: 0,
				maximum: 100,
				description: "A percentage value",
			});
		});
	});

	// ─── coerceSchema Combinator Metadata Preservation ───────────────────────
	// When a coerceSchema uses allOf / anyOf / oneOf with different metadata
	// on each branch, we must ensure the extra properties stay attached to
	// their respective branch and never bleed across branches.

	describe("coerceSchema combinator metadata preservation (allOf / anyOf / oneOf)", () => {
		// ── Object-level: allOf with distinct per-property metadata ───────
		test("allOf coerceSchema — each branch defines a different property with distinct constraints", () => {
			const result = engine.analyze(
				{
					name: "Alice",
					age: "30",
				} as TemplateInput,
				{},
				{
					coerceSchema: {
						allOf: [
							{
								type: "object",
								properties: {
									name: {
										type: "string",
										constraints: "IsAlpha",
										description: "User full name",
									},
								},
							},
							{
								type: "object",
								properties: {
									age: {
										type: "number",
										constraints: "IsPositive",
										description: "User age in years",
									},
								},
							},
						],
					} as unknown as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// name comes from the first allOf branch
			expect(props?.name as unknown).toEqual({
				type: "string",
				constraints: "IsAlpha",
				description: "User full name",
			});
			// age comes from the second allOf branch
			expect(props?.age as unknown).toEqual({
				type: "number",
				constraints: "IsPositive",
				description: "User age in years",
			});
		});

		// ── Object-level: anyOf with distinct per-property metadata ───────
		test("anyOf coerceSchema — each branch defines a different property with distinct constraints", () => {
			const result = engine.analyze(
				{
					email: "test@example.com",
					score: "99",
				} as TemplateInput,
				{},
				{
					coerceSchema: {
						anyOf: [
							{
								type: "object",
								properties: {
									email: {
										type: "string",
										constraints: "IsEmail",
										format: "email",
									},
								},
							},
							{
								type: "object",
								properties: {
									score: {
										type: "integer",
										constraints: "Max(100)",
										minimum: 0,
									},
								},
							},
						],
					} as unknown as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			expect(props?.email as unknown).toEqual({
				type: "string",
				constraints: "IsEmail",
				format: "email",
			});
			expect(props?.score as unknown).toEqual({
				type: "integer",
				constraints: "Max(100)",
				minimum: 0,
			});
		});

		// ── Object-level: oneOf with distinct per-property metadata ───────
		test("oneOf coerceSchema — each branch defines a different property with distinct constraints", () => {
			const result = engine.analyze(
				{
					slug: "hello-world",
					priority: "5",
				} as TemplateInput,
				{},
				{
					coerceSchema: {
						oneOf: [
							{
								type: "object",
								properties: {
									slug: {
										type: "string",
										constraints: "IsSlug",
										pattern: "^[a-z0-9-]+$",
									},
								},
							},
							{
								type: "object",
								properties: {
									priority: {
										type: "integer",
										constraints: "IsPositive",
										maximum: 10,
									},
								},
							},
						],
					} as unknown as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			expect(props?.slug as unknown).toEqual({
				type: "string",
				constraints: "IsSlug",
				pattern: "^[a-z0-9-]+$",
			});
			expect(props?.priority as unknown).toEqual({
				type: "integer",
				constraints: "IsPositive",
				maximum: 10,
			});
		});

		// ── allOf: same property defined in multiple branches → merged allOf child ──
		test("allOf coerceSchema — same property in two branches → child outputSchema is allOf with both constraints", () => {
			const result = engine.analyze(
				{
					value: "42",
				} as TemplateInput,
				{},
				{
					coerceSchema: {
						allOf: [
							{
								type: "object",
								properties: {
									value: {
										type: "number",
										constraints: "IsPositive",
									},
								},
							},
							{
								type: "object",
								properties: {
									value: {
										type: "number",
										constraints: "Max(100)",
									},
								},
							},
						],
					} as unknown as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			// When the same property is in multiple allOf branches,
			// resolveInCombinators merges them into an allOf at the child level.
			// The child coerceSchema becomes { allOf: [branch1, branch2] },
			// which is NOT a simple primitive type — so detectLiteralType kicks in
			// and "42" is detected as number.
			const valueProp = props?.value;
			expect(valueProp).toBeDefined();
			// The output type for "42" should be number (auto-detected since
			// the allOf combinator doesn't have a direct primitive `type`)
			expect(valueProp?.type).toBe("number");
		});

		// ── anyOf: same property in multiple branches → anyOf child preserves both ──
		test("anyOf coerceSchema — same property in two branches → child outputSchema is anyOf with both", () => {
			const result = engine.analyze(
				{
					tag: "active",
				} as TemplateInput,
				{},
				{
					coerceSchema: {
						anyOf: [
							{
								type: "object",
								properties: {
									tag: {
										type: "string",
										constraints: "IsAlpha",
									},
								},
							},
							{
								type: "object",
								properties: {
									tag: {
										type: "string",
										constraints: "MaxLength(50)",
									},
								},
							},
						],
					} as unknown as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);
			const tagProp = props?.tag;
			expect(tagProp).toBeDefined();
			// Similarly, when same key appears in multiple anyOf branches,
			// the resolved child coerceSchema is { anyOf: [...] } which has
			// no direct `type`, so detectLiteralType handles "active" → string
			expect(tagProp?.type).toBe("string");
		});

		// ── Nested: object inside allOf branches with deep metadata ──────
		test("allOf coerceSchema — nested objects preserve metadata at every depth", () => {
			const result = engine.analyze(
				{
					config: {
						timeout: "30",
					},
					flags: {
						debug: "true",
					},
				} as TemplateInput,
				{},
				{
					coerceSchema: {
						allOf: [
							{
								type: "object",
								properties: {
									config: {
										type: "object",
										properties: {
											timeout: {
												type: "number",
												constraints: "IsPositive",
												description: "Timeout in seconds",
											},
										},
									},
								},
							},
							{
								type: "object",
								properties: {
									flags: {
										type: "object",
										properties: {
											debug: {
												type: "boolean",
												constraints: "IsBooleanString",
												description: "Enable debug mode",
											},
										},
									},
								},
							},
						],
					} as unknown as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			const timeoutSchema = getPropAt(
				result.outputSchema as JSONSchema7,
				"config",
				"timeout",
			);
			expect(timeoutSchema as unknown).toEqual({
				type: "number",
				constraints: "IsPositive",
				description: "Timeout in seconds",
			});
			const debugSchema = getPropAt(
				result.outputSchema as JSONSchema7,
				"flags",
				"debug",
			);
			expect(debugSchema as unknown).toEqual({
				type: "boolean",
				constraints: "IsBooleanString",
				description: "Enable debug mode",
			});
		});

		// ── Combined: allOf coerceSchema + excludeTemplateExpression ─────
		test("allOf coerceSchema + excludeTemplateExpression — expression key removed, static key preserves metadata from correct branch", () => {
			const result = engine.analyzeAndExecute(
				{
					userId: "{{userId}}",
					status: "active",
					count: "7",
				} as TemplateInput,
				undefined,
				{},
				{
					excludeTemplateExpression: true,
					coerceSchema: {
						allOf: [
							{
								type: "object",
								properties: {
									userId: {
										type: "string",
										constraints: "IsUuid",
									},
									status: {
										type: "string",
										constraints: "IsAlpha",
										description: "Account status label",
									},
								},
							},
							{
								type: "object",
								properties: {
									count: {
										type: "integer",
										constraints: "IsPositive",
										minimum: 1,
									},
								},
							},
						],
					} as unknown as JSONSchema7,
				},
			);
			expect(result.analysis.valid).toBe(true);
			const schema = result.analysis.outputSchema as JSONSchema7;
			const props = getProps(schema);
			// userId is a template expression → excluded
			expect(props?.userId).toBeUndefined();
			// status from first allOf branch — metadata preserved
			expect(props?.status as unknown).toEqual({
				type: "string",
				constraints: "IsAlpha",
				description: "Account status label",
			});
			// count from second allOf branch — metadata preserved
			expect(props?.count as unknown).toEqual({
				type: "integer",
				constraints: "IsPositive",
				minimum: 1,
			});
			// Execution result should exclude userId
			expect(result.value).toEqual({ status: "active", count: 7 });
		});

		// ── Combined: anyOf coerceSchema + excludeTemplateExpression ─────
		test("anyOf coerceSchema + excludeTemplateExpression — expression key removed, static keys preserve metadata", () => {
			const result = engine.analyzeAndExecute(
				{
					label: "hello",
					ref: "{{ref}}",
				} as TemplateInput,
				undefined,
				{},
				{
					excludeTemplateExpression: true,
					coerceSchema: {
						anyOf: [
							{
								type: "object",
								properties: {
									label: {
										type: "string",
										constraints: "IsNotEmpty",
										minLength: 1,
									},
								},
							},
							{
								type: "object",
								properties: {
									ref: {
										type: "string",
										constraints: "IsUuid",
									},
								},
							},
						],
					} as unknown as JSONSchema7,
				},
			);
			expect(result.analysis.valid).toBe(true);
			const props = getProps(result.analysis.outputSchema as JSONSchema7);
			// ref is a template expression → excluded
			expect(props?.ref).toBeUndefined();
			// label from first anyOf branch — metadata preserved
			expect(props?.label as unknown).toEqual({
				type: "string",
				constraints: "IsNotEmpty",
				minLength: 1,
			});
			expect(result.value).toEqual({ label: "hello" });
		});

		// ── Array template: coerceSchema with combinator items ───────────
		test("array template with anyOf items coerceSchema — items metadata preserved", () => {
			const result = engine.analyze(
				["hello", "world"] as TemplateInput,
				{},
				{
					coerceSchema: {
						type: "array",
						items: {
							type: "string",
							constraints: "IsAlpha",
							maxLength: 20,
						},
					} as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			const schema = result.outputSchema as JSONSchema7;
			expect(schema.type).toBe("array");
			expect(schema.items as unknown).toEqual({
				type: "string",
				constraints: "IsAlpha",
				maxLength: 20,
			});
		});

		// ── Deep nesting: allOf → object → anyOf → leaf with metadata ───
		test("deeply nested combinator: allOf at top, anyOf at leaf level — all metadata preserved", () => {
			const result = engine.analyze(
				{
					outer: {
						inner: "42",
					},
				} as TemplateInput,
				{},
				{
					coerceSchema: {
						allOf: [
							{
								type: "object",
								properties: {
									outer: {
										type: "object",
										properties: {
											inner: {
												type: "integer",
												constraints: "IsPositive",
												description: "Deeply nested value",
												minimum: 0,
												maximum: 100,
											},
										},
									},
								},
							},
						],
					} as unknown as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			const innerSchema = getPropAt(
				result.outputSchema as JSONSchema7,
				"outer",
				"inner",
			);
			expect(innerSchema as unknown).toEqual({
				type: "integer",
				constraints: "IsPositive",
				description: "Deeply nested value",
				minimum: 0,
				maximum: 100,
			});
		});

		// ── Verify no cross-contamination between sibling properties ─────
		test("allOf coerceSchema — sibling properties with different metadata types do not contaminate each other", () => {
			const result = engine.analyze(
				{
					a: "hello",
					b: "42",
					c: "true",
				} as TemplateInput,
				{},
				{
					coerceSchema: {
						allOf: [
							{
								type: "object",
								properties: {
									a: {
										type: "string",
										constraints: "IsAlpha",
										format: "custom-a",
									},
								},
							},
							{
								type: "object",
								properties: {
									b: {
										type: "number",
										constraints: "IsPositive",
										minimum: 0,
									},
								},
							},
							{
								type: "object",
								properties: {
									c: {
										type: "boolean",
										constraints: "IsBooleanString",
										description: "A flag",
									},
								},
							},
						],
					} as unknown as JSONSchema7,
				},
			);
			expect(result.valid).toBe(true);
			const props = getProps(result.outputSchema as JSONSchema7);

			// Each property must have exactly its own metadata — nothing from siblings
			expect(props?.a as unknown).toEqual({
				type: "string",
				constraints: "IsAlpha",
				format: "custom-a",
			});
			expect(props?.b as unknown).toEqual({
				type: "number",
				constraints: "IsPositive",
				minimum: 0,
			});
			expect(props?.c as unknown).toEqual({
				type: "boolean",
				constraints: "IsBooleanString",
				description: "A flag",
			});
		});

		// ── analyzeAndExecute: allOf with 3 branches, mixed static/expression ──
		test("analyzeAndExecute — allOf with 3 branches, mixed static and expressions, excludeTemplateExpression", () => {
			const result = engine.analyzeAndExecute(
				{
					title: "My Article",
					views: "1000",
					author: "{{author}}",
				} as TemplateInput,
				undefined,
				{},
				{
					excludeTemplateExpression: true,
					coerceSchema: {
						allOf: [
							{
								type: "object",
								properties: {
									title: {
										type: "string",
										constraints: "IsNotEmpty",
										maxLength: 200,
									},
								},
							},
							{
								type: "object",
								properties: {
									views: {
										type: "integer",
										constraints: "Min(0)",
										minimum: 0,
									},
								},
							},
							{
								type: "object",
								properties: {
									author: {
										type: "string",
										constraints: "IsAlpha",
									},
								},
							},
						],
					} as unknown as JSONSchema7,
				},
			);
			expect(result.analysis.valid).toBe(true);
			const props = getProps(result.analysis.outputSchema as JSONSchema7);
			// author is expression → excluded
			expect(props?.author).toBeUndefined();
			// title from branch 1
			expect(props?.title as unknown).toEqual({
				type: "string",
				constraints: "IsNotEmpty",
				maxLength: 200,
			});
			// views from branch 2
			expect(props?.views as unknown).toEqual({
				type: "integer",
				constraints: "Min(0)",
				minimum: 0,
			});
			expect(result.value).toEqual({ title: "My Article", views: 1000 });
		});
	});
});
