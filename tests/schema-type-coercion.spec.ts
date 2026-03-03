import { beforeEach, describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { analyze } from "../src/analyzer.ts";
import { clearCompilationCache } from "../src/executor.ts";
import { Typebars } from "../src/typebars.ts";

// ─── Schema-Driven Type Coercion ─────────────────────────────────────────────
// Comprehensive tests verifying that the `expectedOutputType` propagation
// works correctly across all levels of nesting, block helpers, mixed content,
// and edge cases. This validates that the inputSchema contract overrides
// `detectLiteralType` for static literal values at every depth.

const engine = new Typebars();

// ─── Complex Schema ──────────────────────────────────────────────────────────
// A deeply nested schema that mixes strings, numbers, booleans, objects,
// arrays, and various nesting depths.

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

describe("schema-driven type coercion — comprehensive stress tests", () => {
	beforeEach(() => {
		clearCompilationCache();
	});

	// ─── Deep Nesting (4+ levels) ────────────────────────────────────────────

	describe("deep nesting (4+ levels)", () => {
		test("4 levels deep — static '123' respects string schema at leaf", () => {
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
			);
			expect(result.valid).toBe(true);
			const leaf = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const configL1 = (leaf?.config as Record<string, unknown>)?.properties as
				| Record<string, unknown>
				| undefined;
			const nestedL1 = (configL1?.nested as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const deepL1 = (nestedL1?.deep as Record<string, unknown>)?.properties as
				| Record<string, unknown>
				| undefined;
			const leafValue = deepL1?.value;
			expect(leafValue).toEqual({ type: "string" });
		});

		test("4 levels deep — static '42' respects integer schema at leaf", () => {
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
			);
			expect(result.valid).toBe(true);
			const props2 = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const config2 = (props2?.config as Record<string, unknown>)?.properties as
				| Record<string, unknown>
				| undefined;
			const nested2 = (config2?.nested as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const deep2 = (nested2?.deep as Record<string, unknown>)?.properties as
				| Record<string, unknown>
				| undefined;
			expect(deep2?.count).toEqual({ type: "integer" });
		});

		test("4 levels deep — static 'true' respects boolean schema at leaf", () => {
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
			);
			expect(result.valid).toBe(true);
			const props3 = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const config3 = (props3?.config as Record<string, unknown>)?.properties as
				| Record<string, unknown>
				| undefined;
			const nested3 = (config3?.nested as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const deep3 = (nested3?.deep as Record<string, unknown>)?.properties as
				| Record<string, unknown>
				| undefined;
			expect(deep3?.flag).toEqual({ type: "boolean" });
		});

		test("5 levels deep — static '999' respects string schema at ultraDeep leaf", () => {
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
			);
			expect(result.valid).toBe(true);
			const props4 = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const config4 = (props4?.config as Record<string, unknown>)?.properties as
				| Record<string, unknown>
				| undefined;
			const nested4 = (config4?.nested as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const deep4 = (nested4?.deep as Record<string, unknown>)?.properties as
				| Record<string, unknown>
				| undefined;
			const ultraDeep4 = (deep4?.ultraDeep as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			expect(ultraDeep4?.finalValue).toEqual({ type: "string" });
		});

		test("5 levels deep — static '3.14' respects number schema at ultraDeep leaf", () => {
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
			);
			expect(result.valid).toBe(true);
			const props5 = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const config5 = (props5?.config as Record<string, unknown>)?.properties as
				| Record<string, unknown>
				| undefined;
			const nested5 = (config5?.nested as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const deep5 = (nested5?.deep as Record<string, unknown>)?.properties as
				| Record<string, unknown>
				| undefined;
			const ultraDeep5 = (deep5?.ultraDeep as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			expect(ultraDeep5?.finalNumber).toEqual({ type: "number" });
		});

		test("multiple leaves at different depths — all respect their schemas", () => {
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
			const topProps6 = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const configProps = (topProps6?.config as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// maxRetries is string in schema → "3" stays string
			expect(configProps?.maxRetries).toEqual({ type: "string" });
			// timeout is number in schema → "5000" becomes number
			expect(configProps?.timeout).toEqual({ type: "number" });

			const nestedProps6 = (configProps?.nested as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const deepProps = (nestedProps6?.deep as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// value is string → "42" stays string
			expect(deepProps?.value).toEqual({ type: "string" });
			// count is integer → "10" becomes integer
			expect(deepProps?.count).toEqual({ type: "integer" });

			const ultraDeepProps = (deepProps?.ultraDeep as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// finalValue is string → "100" stays string
			expect(ultraDeepProps?.finalValue).toEqual({ type: "string" });
			// finalNumber is number → "99" becomes number
			expect(ultraDeepProps?.finalNumber).toEqual({ type: "number" });
		});
	});

	// ─── Mixed: Static Literals + Handlebars Expressions ─────────────────────

	describe("mixed static literals and Handlebars expressions", () => {
		test("sibling properties: some static, some with {{}} — each correctly typed", () => {
			const result = engine.analyze(
				{
					accountId: "12345",
					name: "{{name}}",
					age: "{{age}}",
					balance: "100.50",
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			const props = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// accountId: schema says string → "12345" stays string
			expect(props?.accountId).toEqual({ type: "string" });
			// name: resolved from schema as string
			expect(props?.name).toEqual({ type: "string" });
			// age: resolved from schema as number
			expect(props?.age).toEqual({ type: "number" });
			// balance: schema says number → "100.50" becomes number
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
			);
			expect(result.valid).toBe(true);
			const topProps7 = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const config7 = (topProps7?.config as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const nested7 = (config7?.nested as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const deepProps = (nested7?.deep as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// value: string schema → "999" stays string
			expect(deepProps?.value).toEqual({ type: "string" });
			// count: {{score}} resolves to integer from inputSchema
			expect(deepProps?.count).toEqual({ type: "integer" });
		});

		test("mixed template (text + expression) is always string regardless of schema", () => {
			const result = engine.analyze(
				{
					accountId: "ACC-{{name}}",
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			const props = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// Mixed template → always string (concatenation)
			expect(props?.accountId).toEqual({ type: "string" });
		});
	});

	// ─── Conditional Blocks ({{#if}}) ────────────────────────────────────────

	describe("coexistence with {{#if}} blocks", () => {
		test("property with #if block — type coercion does not interfere", () => {
			const result = engine.analyze(
				{
					accountId: "12345",
					name: "{{#if active}}{{name}}{{else}}unknown{{/if}}",
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			const props = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// Static literal with schema coercion
			expect(props?.accountId).toEqual({ type: "string" });
			// #if block: both branches are string
			expect(props?.name).toEqual({ type: "string" });
		});

		test("#if block returning different types → oneOf", () => {
			const result = engine.analyze(
				{
					accountId: "67890",
					result: "{{#if active}}{{age}}{{else}}{{name}}{{/if}}",
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			const props = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// Static → string schema
			expect(props?.accountId).toEqual({ type: "string" });
			// if block: age is number, name is string → oneOf
			expect(props?.result).toEqual({
				oneOf: [{ type: "number" }, { type: "string" }],
			});
		});

		test("nested object with some #if and some static literals", () => {
			const result = engine.analyze(
				{
					config: {
						maxRetries: "3",
						enabled: "{{#if active}}true{{else}}false{{/if}}",
					},
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			const topProps8 = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const configProps = (topProps8?.config as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// Static "3" with string schema → string
			expect(configProps?.maxRetries).toEqual({ type: "string" });
			// #if returns "true"/"false" as static content → boolean (detectLiteralType)
			expect(configProps?.enabled).toEqual({ type: "boolean" });
		});
	});

	// ─── {{#each}} Blocks ────────────────────────────────────────────────────

	describe("coexistence with {{#each}} blocks", () => {
		test("property with #each block alongside static coerced values", () => {
			const result = engine.analyze(
				{
					accountId: "55555",
					tagList: "{{#each tags}}{{this}}, {{/each}}",
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			const props = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// Static coercion: string schema
			expect(props?.accountId).toEqual({ type: "string" });
			// #each with text → mixed template → string
			expect(props?.tagList).toEqual({ type: "string" });
		});

		test("#each producing single expression alongside static literals", () => {
			const result = engine.analyze(
				{
					accountId: "99",
					firstTag: "{{#each tags}}{{this}}{{/each}}",
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			const props = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// "99" with string schema → string
			expect(props?.accountId).toEqual({ type: "string" });
			// #each always produces string
			expect(props?.firstTag).toEqual({ type: "string" });
		});
	});

	// ─── {{#with}} Blocks ────────────────────────────────────────────────────

	describe("coexistence with {{#with}} blocks", () => {
		test("#with block alongside static coerced values", () => {
			const result = engine.analyze(
				{
					accountId: "42",
					metaRole: "{{#with metadata}}{{role}}{{/with}}",
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			const props = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// "42" with string schema → string
			expect(props?.accountId).toEqual({ type: "string" });
			// #with resolves to metadata.role which is string
			expect(props?.metaRole).toEqual({ type: "string" });
		});
	});

	// ─── Properties Not In Schema (Fallback to detectLiteralType) ────────────

	describe("properties not in schema → fallback to default detection", () => {
		test("unknown property with numeric string → defaults to number", () => {
			const result = engine.analyze(
				{
					unknownProp: "123",
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			const props = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// Not in schema → falls back to detectLiteralType → number
			expect(props?.unknownProp).toEqual({ type: "number" });
		});

		test("unknown property with boolean string → defaults to boolean", () => {
			const result = engine.analyze(
				{
					unknownProp: "true",
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			const props = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			expect(props?.unknownProp).toEqual({ type: "boolean" });
		});

		test("unknown property with null string → defaults to null", () => {
			const result = engine.analyze(
				{
					unknownProp: "null",
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			const props = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			expect(props?.unknownProp).toEqual({ type: "null" });
		});

		test("unknown property with non-literal string → defaults to string", () => {
			const result = engine.analyze(
				{
					unknownProp: "hello world",
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			const props = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			expect(props?.unknownProp).toEqual({ type: "string" });
		});

		test("mix of known + unknown properties at the same level", () => {
			const result = engine.analyze(
				{
					accountId: "12345",
					notInSchema: "67890",
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			const props = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// Known: schema says string → stays string
			expect(props?.accountId).toEqual({ type: "string" });
			// Unknown: no schema → detectLiteralType → number
			expect(props?.notInSchema).toEqual({ type: "number" });
		});

		test("deep unknown property — parent known but child unknown", () => {
			const result = engine.analyze(
				{
					config: {
						notDeclared: "999",
					},
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			const topProps9 = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const configProps = (topProps9?.config as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// config is in schema, but notDeclared is not → fallback to number
			expect(configProps?.notDeclared).toEqual({ type: "number" });
		});
	});

	// ─── Standalone analyze() Function ───────────────────────────────────────

	describe("standalone analyze() function", () => {
		test("string template with primitive inputSchema type → respects schema", () => {
			const r1 = analyze("123", { type: "string" });
			expect(r1.outputSchema).toEqual({ type: "string" });

			const r2 = analyze("123", { type: "number" });
			expect(r2.outputSchema).toEqual({ type: "number" });

			const r3 = analyze("true", { type: "string" });
			expect(r3.outputSchema).toEqual({ type: "string" });

			const r4 = analyze("null", { type: "string" });
			expect(r4.outputSchema).toEqual({ type: "string" });
		});

		test("standalone analyze with object template → deep nesting works", () => {
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
			const saProps = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const saConfig = (saProps?.config as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const saNested = (saConfig?.nested as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const saDeep = (saNested?.deep as Record<string, unknown>)?.properties as
				| Record<string, unknown>
				| undefined;
			expect(saDeep?.value).toEqual({ type: "string" });
		});
	});

	// ─── Primitive Literals (number, boolean, null) Are Not Affected ─────────

	describe("JS primitive literals are not affected by type coercion", () => {
		test("numeric JS literal → always integer/number regardless of schema", () => {
			const result = engine.analyze(
				{
					accountId: 42,
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			// JS number 42 → inferPrimitiveSchema → integer, not affected by schema
			expect(
				(
					(result.outputSchema as Record<string, unknown>)?.properties as
						| Record<string, unknown>
						| undefined
				)?.accountId,
			).toEqual({
				type: "integer",
			});
		});

		test("boolean JS literal → always boolean regardless of schema", () => {
			const result = engine.analyze(
				{
					accountId: true,
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			expect(
				(
					(result.outputSchema as Record<string, unknown>)?.properties as
						| Record<string, unknown>
						| undefined
				)?.accountId,
			).toEqual({
				type: "boolean",
			});
		});

		test("null JS literal → always null regardless of schema", () => {
			const result = engine.analyze(
				{
					accountId: null,
				},
				complexSchema,
			);
			expect(result.valid).toBe(true);
			expect(
				(
					(result.outputSchema as Record<string, unknown>)?.properties as
						| Record<string, unknown>
						| undefined
				)?.accountId,
			).toEqual({
				type: "null",
			});
		});
	});

	// ─── The Mega Test: Everything Combined ──────────────────────────────────

	describe("mega integration test — all features coexisting", () => {
		test("deeply nested object with static coercion, expressions, #if, #each, #with, unknown props, and literals", () => {
			const result = engine.analyze(
				{
					// Static literal coerced by schema (string schema → stays string)
					accountId: "12345",
					// Expression resolved from inputSchema
					name: "{{name}}",
					// JS numeric literal (not affected by schema)
					priority: 7,
					// Static literal coerced by schema (number schema → becomes number)
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
					// Deep nesting with schema coercion
					config: {
						// String schema → "3" stays string
						maxRetries: "3",
						// Number schema → "5000" becomes number
						timeout: "5000",
						// Expression
						enabled: "{{active}}",
						nested: {
							deep: {
								// String schema → "42" stays string
								value: "42",
								// Integer schema → "10" becomes integer
								count: "10",
								// Expression
								flag: "{{active}}",
								ultraDeep: {
									// String schema → "100" stays string
									finalValue: "100",
									// Number schema → "99" becomes number
									finalNumber: "99",
								},
							},
						},
					},
					// Nested object with schema
					metadata: {
						// String schema → "admin" stays string
						role: "admin",
						// Number schema → "5" becomes number
						level: "5",
					},
				},
				complexSchema,
			);

			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);

			const props = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;

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
			const configProps = (props?.config as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			expect(configProps?.maxRetries).toEqual({ type: "string" });
			expect(configProps?.timeout).toEqual({ type: "number" });
			expect(configProps?.enabled).toEqual({ type: "boolean" });

			// ── config.nested.deep (level 4) ──────────────────────────────
			const nestedMega = (configProps?.nested as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const deepProps = (nestedMega?.deep as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			expect(deepProps?.value).toEqual({ type: "string" });
			expect(deepProps?.count).toEqual({ type: "integer" });
			expect(deepProps?.flag).toEqual({ type: "boolean" });

			// ── config.nested.deep.ultraDeep (level 5) ────────────────────
			const ultraDeepProps = (deepProps?.ultraDeep as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			expect(ultraDeepProps?.finalValue).toEqual({ type: "string" });
			expect(ultraDeepProps?.finalNumber).toEqual({ type: "number" });

			// ── metadata (level 2) ────────────────────────────────────────
			const metaProps = (props?.metadata as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			expect(metaProps?.role).toEqual({ type: "string" });
			expect(metaProps?.level).toEqual({ type: "number" });
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
			);

			expect(analysis.valid).toBe(true);
			expect(analysis.diagnostics).toEqual([]);

			// ── Analysis types ─────────────────────────────────────────────
			const props = (analysis.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			expect(props?.accountId).toEqual({ type: "string" });
			expect(props?.name).toEqual({ type: "string" });
			expect(props?.age).toEqual({ type: "number" });
			expect(props?.balance).toEqual({ type: "number" });
			expect(props?.greeting).toEqual({ type: "string" });
			expect(props?.active).toEqual({ type: "boolean" });
			expect(props?.priority).toEqual({ type: "integer" });
			expect(props?.isNull).toEqual({ type: "null" });
			expect(props?.notInSchema).toEqual({ type: "number" });

			const configProps = (props?.config as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			expect(configProps?.maxRetries).toEqual({ type: "string" });
			expect(configProps?.timeout).toEqual({ type: "number" });

			const nestedM2 = (configProps?.nested as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const deepProps = (nestedM2?.deep as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			expect(deepProps?.value).toEqual({ type: "string" });

			const ultraDeepProps = (deepProps?.ultraDeep as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			expect(ultraDeepProps?.finalValue).toEqual({ type: "string" });

			const metaProps = (props?.metadata as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			expect(metaProps?.role).toEqual({ type: "string" });
			expect(metaProps?.level).toEqual({ type: "number" });

			// ── Execution values ───────────────────────────────────────────
			const v = value as Record<string, unknown>;
			expect(v.accountId).toBe("12345");
			expect(v.name).toBe("Alice");
			expect(v.age).toBe(30);
			expect(v.balance).toBe("500.25");
			expect(v.greeting).toBe("Hello Alice!");
			expect(v.active).toBe(true);
			expect(v.priority).toBe(7);
			expect(v.isNull).toBe(null);
			// notInSchema: static "42" → execution renders as string "42",
			// but since there's no expression, Handlebars just returns the raw text
			expect(v.notInSchema).toBe("42");

			const vConfig = v.config as Record<string, unknown>;
			expect(vConfig.maxRetries).toBe("3");
			expect(vConfig.timeout).toBe("5000");

			const vNested = vConfig.nested as Record<string, unknown>;
			const vDeep = (vNested as Record<string, unknown>).deep as Record<
				string,
				unknown
			>;
			expect(vDeep.value).toBe("999");
			expect(vDeep.count).toBe(95); // {{score}} → 95

			const vUltraDeep = vDeep.ultraDeep as Record<string, unknown>;
			expect(vUltraDeep.finalValue).toBe("100");

			const vMeta = v.metadata as Record<string, unknown>;
			expect(vMeta.role).toBe("admin");
			expect(vMeta.level).toBe("5");
		});
	});

	// ─── Edge Cases ──────────────────────────────────────────────────────────

	describe("edge cases", () => {
		test("empty string template with string schema → string", () => {
			const result = engine.analyze({ accountId: "" }, complexSchema);
			expect(result.valid).toBe(true);
			expect(
				(
					(result.outputSchema as Record<string, unknown>)?.properties as
						| Record<string, unknown>
						| undefined
				)?.accountId,
			).toEqual({
				type: "string",
			});
		});

		test("whitespace-only string with string schema → string", () => {
			const result = engine.analyze({ accountId: "   " }, complexSchema);
			expect(result.valid).toBe(true);
			expect(
				(
					(result.outputSchema as Record<string, unknown>)?.properties as
						| Record<string, unknown>
						| undefined
				)?.accountId,
			).toEqual({
				type: "string",
			});
		});

		test("negative number string with number schema → number", () => {
			const result = engine.analyze({ balance: "-500" }, complexSchema);
			expect(result.valid).toBe(true);
			expect(
				(
					(result.outputSchema as Record<string, unknown>)?.properties as
						| Record<string, unknown>
						| undefined
				)?.balance,
			).toEqual({
				type: "number",
			});
		});

		test("decimal string with number schema → number", () => {
			const result = engine.analyze({ balance: "3.14159" }, complexSchema);
			expect(result.valid).toBe(true);
			expect(
				(
					(result.outputSchema as Record<string, unknown>)?.properties as
						| Record<string, unknown>
						| undefined
				)?.balance,
			).toEqual({
				type: "number",
			});
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
			const ecProps = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const ecConfig = (ecProps?.config as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const ecNested = (ecConfig?.nested as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			const deepProps = ecNested?.deep;
			expect(deepProps).toEqual({
				type: "object",
				properties: {},
				required: [],
			});
		});

		test("schema with no type for a property → falls back to detectLiteralType", () => {
			const schemaWithNoType: JSONSchema7 = {
				type: "object",
				properties: {
					value: {}, // No type declared
				},
			};
			const result = engine.analyze({ value: "123" }, schemaWithNoType);
			expect(result.valid).toBe(true);
			// Schema has no type → doesn't match primitive type check → falls back to detectLiteralType
			expect(
				(
					(result.outputSchema as Record<string, unknown>)?.properties as
						| Record<string, unknown>
						| undefined
				)?.value,
			).toEqual({
				type: "number",
			});
		});

		test("schema with array type for a property → falls back to detectLiteralType", () => {
			const schemaWithArrayType: JSONSchema7 = {
				type: "object",
				properties: {
					value: { type: "array", items: { type: "string" } },
				},
			};
			const result = engine.analyze({ value: "123" }, schemaWithArrayType);
			expect(result.valid).toBe(true);
			// Schema type is "array" (not a primitive) → falls back to detectLiteralType
			expect(
				(
					(result.outputSchema as Record<string, unknown>)?.properties as
						| Record<string, unknown>
						| undefined
				)?.value,
			).toEqual({
				type: "number",
			});
		});

		test("inputSchema is a primitive type (not object) — direct string template", () => {
			// When inputSchema itself is a primitive type, the template is a
			// direct string and the schema constrains its output type.
			expect(engine.analyze("42", { type: "string" }).outputSchema).toEqual({
				type: "string",
			});
			expect(engine.analyze("42", { type: "number" }).outputSchema).toEqual({
				type: "number",
			});
			expect(engine.analyze("42", { type: "integer" }).outputSchema).toEqual({
				type: "integer",
			});
		});
	});

	// ─── Schema with additionalProperties ────────────────────────────────────

	describe("schema with additionalProperties", () => {
		test("additionalProperties: true → unknown properties fall back to detectLiteralType", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					name: { type: "string" },
				},
				additionalProperties: true,
			};
			const result = engine.analyze({ name: "123", extra: "456" }, schema);
			expect(result.valid).toBe(true);
			const props = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// name has string schema → "123" stays string
			expect(props?.name).toEqual({ type: "string" });
			// extra: additionalProperties is true → resolveSchemaPath returns {}
			// → no type → falls back to detectLiteralType → number
			expect(props?.extra).toEqual({ type: "number" });
		});

		test("additionalProperties with typed schema → coerces extra properties", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					name: { type: "string" },
				},
				additionalProperties: { type: "string" },
			};
			const result = engine.analyze({ name: "123", extra: "456" }, schema);
			expect(result.valid).toBe(true);
			const props = (result.outputSchema as Record<string, unknown>)
				?.properties as Record<string, unknown> | undefined;
			// name: string schema → "123" stays string
			expect(props?.name).toEqual({ type: "string" });
			// extra: additionalProperties says string → "456" stays string
			expect(props?.extra).toEqual({ type: "string" });
		});
	});
});
