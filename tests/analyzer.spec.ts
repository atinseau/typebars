import { describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { analyze } from "../src/analyzer.ts";
import { userSchema } from "./fixtures.ts";

describe("analyzer", () => {
	describe("output type inference (outputSchema)", () => {
		test("single string expression → { type: 'string' }", () => {
			const result = analyze("{{name}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("single number expression → { type: 'number' }", () => {
			const result = analyze("{{age}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("single boolean expression (optional) → { type: ['boolean', 'null'] }", () => {
			const result = analyze("{{active}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: ["boolean", "null"] });
		});

		test("single integer expression (optional) → { type: ['integer', 'null'] }", () => {
			const result = analyze("{{score}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: ["integer", "null"] });
		});

		test("single object expression (optional) → full object schema with null", () => {
			const result = analyze("{{address}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: ["object", "null"],
				properties: {
					city: { type: "string" },
					zip: { type: "string" },
				},
			});
		});

		test("single array expression (optional) → array schema with null", () => {
			const result = analyze("{{tags}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: ["array", "null"],
				items: { type: "string" },
			});
		});

		test("single expression with dot notation (optional parent) → leaf type with null", () => {
			const result = analyze("{{address.city}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: ["string", "null"] });
		});

		test("single expression with enum (optional parent) → preserves enum with null", () => {
			const result = analyze("{{metadata.role}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: ["string", "null"],
				enum: ["admin", "user", "guest"],
			});
		});

		test("mixed template (text + expression) → { type: 'string' }", () => {
			const result = analyze("Hello {{name}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("template with multiple expressions → { type: 'string' }", () => {
			const result = analyze("{{name}} ({{age}})", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("template with #if block → { type: 'string' }", () => {
			const result = analyze("{{#if active}}yes{{else}}no{{/if}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("template with #each block → { type: 'string' }", () => {
			const result = analyze("{{#each tags}}{{this}} {{/each}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("template with #with block (optional inner prop) → { type: ['string', 'null'] }", () => {
			const result = analyze("{{#with address}}{{city}}{{/with}}", userSchema);
			expect(result.valid).toBe(true);
			// city has no `required` in address schema → nullable
			expect(result.outputSchema).toEqual({ type: ["string", "null"] });
		});

		test("plain text without expression → { type: 'string' }", () => {
			const result = analyze("Just plain text", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});
	});

	describe("output type inference — single block", () => {
		test("#if with numeric literals in both branches → number", () => {
			const result = analyze(
				"{{#if active}}\n  10\n{{else}}\n  20\n{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("#if with inline numeric literals → number", () => {
			const result = analyze("{{#if active}}10{{else}}20{{/if}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("#if with decimal literals → number", () => {
			const result = analyze(
				"{{#if active}}3.14{{else}}-2.5{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("#if with boolean literals → boolean", () => {
			const result = analyze(
				"{{#if active}}true{{else}}false{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		});

		test("#if with null literal in one branch → null | string", () => {
			const result = analyze(
				"{{#if active}}null{{else}}fallback{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "null" }, { type: "string" }],
			});
		});

		test("#if with mixed types (number and string) → oneOf", () => {
			const result = analyze(
				"{{#if active}}42{{else}}hello{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "number" }, { type: "string" }],
			});
		});

		test("#if with single expression in each branch → expression type", () => {
			const result = analyze(
				"{{#if active}}{{age}}{{else}}{{score}}{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			// age is required (number), score is optional (integer|null) → oneOf
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "number" }, { type: ["integer", "null"] }],
			});
		});

		test("#if with same expression type in both branches (one optional) → oneOf", () => {
			const result = analyze(
				"{{#if active}}{{name}}{{else}}{{address.city}}{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			// name is required (string), address.city is optional (string|null)
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "string" }, { type: ["string", "null"] }],
			});
		});

		test("#if with single expression and surrounding whitespace → expression type", () => {
			const result = analyze(
				"{{#if active}}\n  {{age}}\n{{else}}\n  {{score}}\n{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "number" }, { type: ["integer", "null"] }],
			});
		});

		test("#with as single block → body type (optional inner prop)", () => {
			const result = analyze("{{#with address}}{{city}}{{/with}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: ["string", "null"] });
		});

		test("#each as single block → always string", () => {
			const result = analyze("{{#each tags}}{{this}}{{/each}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("#unless as single block with numeric literals → number", () => {
			const result = analyze(
				"{{#unless active}}0{{else}}1{{/unless}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("single expression with surrounding whitespace → raw type preserved", () => {
			const result = analyze("  {{age}}  ", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});
	});

	describe("validation — existing properties", () => {
		test("validates a simple property access", () => {
			const result = analyze("{{name}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		test("validates a nested property access", () => {
			const result = analyze("{{address.city}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		test("validates a deeply nested property access", () => {
			const result = analyze("{{metadata.role}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		test("validates a template with multiple valid accesses", () => {
			const result = analyze("{{name}} {{age}} {{active}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});
	});

	describe("validation — missing properties", () => {
		test("detects a missing top-level property", () => {
			const result = analyze("{{firstName}}", userSchema);
			expect(result.valid).toBe(false);
			expect(result.diagnostics).toHaveLength(1);
			expect(result.diagnostics[0]?.severity).toBe("error");
			expect(result.diagnostics[0]?.message).toContain("firstName");
		});

		test("detects a missing deeply nested property", () => {
			const result = analyze("{{address.country}}", userSchema);
			expect(result.valid).toBe(false);
			expect(result.diagnostics[0]?.message).toContain("address.country");
		});

		test("detects a missing property in a mixed template", () => {
			const result = analyze("Hello {{unknown}}!", userSchema);
			expect(result.valid).toBe(false);
		});

		test("detects multiple missing properties", () => {
			const result = analyze("{{foo}} and {{bar}}", userSchema);
			expect(result.valid).toBe(false);
			expect(
				result.diagnostics.filter((d) => d.severity === "error"),
			).toHaveLength(2);
		});
	});

	describe("validation — #if / #unless blocks", () => {
		test("#if with a valid condition is valid", () => {
			const result = analyze("{{#if active}}yes{{/if}}", userSchema);
			expect(result.valid).toBe(true);
		});

		test("#if with else, all expressions valid", () => {
			const result = analyze(
				"{{#if active}}{{name}}{{else}}unknown{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
		});

		test("#if with a missing condition → error", () => {
			const result = analyze("{{#if nonexistent}}yes{{/if}}", userSchema);
			expect(result.valid).toBe(false);
			expect(result.diagnostics[0]?.message).toContain("nonexistent");
		});

		test("#if validates expressions in both branches", () => {
			const result = analyze(
				"{{#if active}}{{badProp1}}{{else}}{{badProp2}}{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(false);
			// Errors for the condition not existing? No, `active` exists.
			// But badProp1 and badProp2 do not exist.
			const errors = result.diagnostics.filter((d) => d.severity === "error");
			expect(errors.length).toBe(2);
		});

		test("#unless with a valid condition", () => {
			const result = analyze(
				"{{#unless active}}no{{else}}yes{{/unless}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
		});
	});

	describe("validation — #each block", () => {
		test("#each on a valid array", () => {
			const result = analyze("{{#each tags}}{{this}}{{/each}}", userSchema);
			expect(result.valid).toBe(true);
		});

		test("#each on an array of objects — accessing item properties", () => {
			const result = analyze(
				"{{#each orders}}{{product}}{{/each}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
		});

		test("#each on an array of objects — missing property in items", () => {
			const result = analyze(
				"{{#each orders}}{{badField}}{{/each}}",
				userSchema,
			);
			expect(result.valid).toBe(false);
			expect(result.diagnostics[0]?.message).toContain("badField");
		});

		test("#each on a non-array → error", () => {
			const result = analyze("{{#each name}}{{this}}{{/each}}", userSchema);
			expect(result.valid).toBe(false);
			expect(result.diagnostics[0]?.message).toContain("array");
		});

		test("#each on a missing property → error", () => {
			const result = analyze(
				"{{#each nonexistent}}{{this}}{{/each}}",
				userSchema,
			);
			expect(result.valid).toBe(false);
		});

		test("#each with else branch is valid", () => {
			const result = analyze(
				"{{#each tags}}{{this}}{{else}}empty{{/each}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
		});
	});

	describe("validation — #with block", () => {
		test("#with on a valid object — correct inner access", () => {
			const result = analyze("{{#with address}}{{city}}{{/with}}", userSchema);
			expect(result.valid).toBe(true);
		});

		test("#with — accessing a missing property in the sub-context", () => {
			const result = analyze(
				"{{#with address}}{{country}}{{/with}}",
				userSchema,
			);
			expect(result.valid).toBe(false);
			expect(result.diagnostics[0]?.message).toContain("country");
		});

		test("#with on a missing property → error", () => {
			const result = analyze(
				"{{#with nonexistent}}{{foo}}{{/with}}",
				userSchema,
			);
			expect(result.valid).toBe(false);
		});

		test("#with nested inside #with", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					level1: {
						type: "object",
						properties: {
							level2: {
								type: "object",
								properties: {
									value: { type: "string" },
								},
							},
						},
					},
				},
			};
			const result = analyze(
				"{{#with level1}}{{#with level2}}{{value}}{{/with}}{{/with}}",
				schema,
			);
			expect(result.valid).toBe(true);
		});
	});

	describe("validation — complex combinations", () => {
		test("#with containing a #each", () => {
			const result = analyze(
				"{{#with metadata}}{{#each permissions}}{{this}}{{/each}}{{/with}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
		});

		test("#if containing a #each", () => {
			const result = analyze(
				"{{#if active}}{{#each tags}}{{this}}{{/each}}{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
		});

		test("complex template mixing text, expressions and blocks", () => {
			const result = analyze(
				"{{name}} ({{metadata.role}}): {{#each tags}}{{this}} {{/each}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
		});

		test("#each over objects accessing multiple properties", () => {
			const result = analyze(
				"{{#each orders}}#{{id}} {{product}} x{{quantity}}{{/each}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
		});
	});

	describe("validation — $ref", () => {
		const schemaWithRef: JSONSchema7 = {
			type: "object",
			definitions: {
				Address: {
					type: "object",
					properties: {
						street: { type: "string" },
						city: { type: "string" },
					},
				},
			},
			properties: {
				home: { $ref: "#/definitions/Address" },
				work: { $ref: "#/definitions/Address" },
			},
		};

		test("resolves a property access via $ref (optional) → nullable", () => {
			const result = analyze("{{home.city}}", schemaWithRef);
			expect(result.valid).toBe(true);
			// home is optional (no required) → nullable
			expect(result.outputSchema).toEqual({ type: ["string", "null"] });
		});

		test("mixed template with multiple $ref accesses", () => {
			const result = analyze("{{home.city}} — {{work.street}}", schemaWithRef);
			expect(result.valid).toBe(true);
		});

		test("missing property behind a $ref → error", () => {
			const result = analyze("{{home.zip}}", schemaWithRef);
			expect(result.valid).toBe(false);
		});
	});

	describe("validation — intrinsic array properties", () => {
		test(".length access on an array is valid (optional parent)", () => {
			const result = analyze("{{tags.length}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			// tags is optional → nullable
			expect(result.outputSchema).toEqual({ type: ["integer", "null"] });
		});

		test(".length access on an array of objects is valid (optional parent)", () => {
			const result = analyze("{{orders.length}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: ["integer", "null"] });
		});

		test(".length access in a mixed template → string", () => {
			const result = analyze("Total: {{orders.length}} commandes", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test(".length access inside a #if block is valid", () => {
			const result = analyze(
				"{{#if tags}}{{tags.length}}{{else}}0{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		test(".length access on a non-array → error", () => {
			const result = analyze("{{name.length}}", userSchema);
			expect(result.valid).toBe(false);
			expect(result.diagnostics).toHaveLength(1);
			expect(result.diagnostics[0]?.code).toBe("UNKNOWN_PROPERTY");
		});

		test(".length access on a nested array via #with", () => {
			const result = analyze(
				"{{#with metadata}}{{permissions.length}}{{/with}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});
	});

	describe("validation — numeric array index access", () => {
		test("[0] on a string array is valid (optional parent) → nullable", () => {
			const result = analyze("{{tags.[0]}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: ["string", "null"] });
		});

		test("[1] on a string array is valid (optional parent) → nullable", () => {
			const result = analyze("{{tags.[1]}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: ["string", "null"] });
		});

		test("[0] on an array of objects (optional parent) → nullable object schema", () => {
			const result = analyze("{{orders.[0]}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({
				type: ["object", "null"],
				properties: {
					id: { type: "number" },
					product: { type: "string" },
					quantity: { type: "integer" },
				},
			});
		});

		test("nested property after index: orders.[0].product (optional parent) → nullable", () => {
			const result = analyze("{{orders.[0].product}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: ["string", "null"] });
		});

		test("nested property after index: orders.[0].quantity (optional parent) → nullable", () => {
			const result = analyze("{{orders.[0].quantity}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: ["integer", "null"] });
		});

		test("[0] in mixed template → string output", () => {
			const result = analyze("First tag: {{tags.[0]}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("[0] inside a #if block is valid", () => {
			const result = analyze(
				"{{#if tags}}{{tags.[0]}}{{else}}none{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
		});

		test("[0] on a non-array property → error", () => {
			const result = analyze("{{name.[0]}}", userSchema);
			expect(result.valid).toBe(false);
			expect(result.diagnostics).toHaveLength(1);
			expect(result.diagnostics[0]?.code).toBe("UNKNOWN_PROPERTY");
		});

		test("nested [0] via #with on metadata.permissions (optional)", () => {
			const result = analyze(
				"{{#with metadata}}{{permissions.[0]}}{{/with}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			// permissions is optional in metadata schema → nullable
			expect(result.outputSchema).toEqual({ type: ["string", "null"] });
		});

		test("[0] with custom schema — array with $ref items (optional)", () => {
			const schema: JSONSchema7 = {
				type: "object",
				definitions: {
					Tag: { type: "string" },
				},
				properties: {
					tags: {
						type: "array",
						items: { $ref: "#/definitions/Tag" },
					},
				},
			};
			const result = analyze("{{tags.[0]}}", schema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			// tags is optional → nullable
			expect(result.outputSchema).toEqual({ type: ["string", "null"] });
		});

		test("[0] with tuple items schema (optional) → resolves correct index type with null", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					pair: {
						type: "array",
						items: [{ type: "string" }, { type: "number" }],
					},
				},
			};
			const r0 = analyze("{{pair.[0]}}", schema);
			expect(r0.valid).toBe(true);
			// pair is optional → nullable
			expect(r0.outputSchema).toEqual({ type: ["string", "null"] });

			const r1 = analyze("{{pair.[1]}}", schema);
			expect(r1.valid).toBe(true);
			expect(r1.outputSchema).toEqual({ type: ["number", "null"] });
		});
	});

	describe("output type inference — multiple blocks", () => {
		test("two #if blocks with different types → oneOf", () => {
			const result = analyze(
				"{{#if active}}{{name}}{{/if}}\n{{#if active}}{{age}}{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "string" }, { type: "number" }],
			});
		});

		test("two #if blocks — required string and optional string → oneOf", () => {
			const result = analyze(
				"{{#if active}}{{name}}{{/if}}\n{{#if active}}{{address.city}}{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			// name is required (string), address.city is optional (string|null) → distinct
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "string" }, { type: ["string", "null"] }],
			});
		});

		test("two #if blocks with surrounding whitespace → oneOf", () => {
			const result = analyze(
				"{{#if active}}\n  {{name}}\n{{/if}}\n\n{{#if active}}\n  {{age}}\n{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "string" }, { type: "number" }],
			});
		});

		test("three #if blocks with three different types (some optional) → oneOf with all types", () => {
			const result = analyze(
				"{{#if active}}{{name}}{{/if}}\n{{#if active}}{{age}}{{/if}}\n{{#if active}}{{active}}{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			// active is optional → boolean|null
			expect(result.outputSchema).toEqual({
				oneOf: [
					{ type: "string" },
					{ type: "number" },
					{ type: ["boolean", "null"] },
				],
			});
		});

		test("three #if blocks with duplicate types (one optional) → oneOf", () => {
			const result = analyze(
				"{{#if active}}{{name}}{{/if}}\n{{#if active}}{{age}}{{/if}}\n{{#if active}}{{address.city}}{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			// name is string, address.city is string|null → distinct, not deduplicated
			expect(result.outputSchema).toEqual({
				oneOf: [
					{ type: "string" },
					{ type: "number" },
					{ type: ["string", "null"] },
				],
			});
		});

		test("multiple blocks with text between them → string (concatenation)", () => {
			const result = analyze(
				"{{#if active}}{{name}}{{/if}} separator {{#if active}}{{age}}{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("#if and #unless blocks combined → oneOf", () => {
			const result = analyze(
				"{{#if active}}{{name}}{{/if}}\n{{#unless active}}{{age}}{{/unless}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "string" }, { type: "number" }],
			});
		});

		test("#if block with else and another #if block → oneOf", () => {
			const result = analyze(
				"{{#if active}}{{age}}{{else}}{{score}}{{/if}}\n{{#if active}}{{name}}{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			// first block: oneOf(number, integer|null), second block: string
			expect(result.outputSchema).toEqual({
				oneOf: [
					{ oneOf: [{ type: "number" }, { type: ["integer", "null"] }] },
					{ type: "string" },
				],
			});
		});

		test("multiple blocks still validate expressions (missing property → error)", () => {
			const result = analyze(
				"{{#if active}}{{name}}{{/if}}\n{{#if active}}{{nonExistent}}{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(false);
			expect(result.diagnostics).toHaveLength(1);
			expect(result.diagnostics[0]?.code).toBe("UNKNOWN_PROPERTY");
		});
	});

	// ─── Optional property → nullable output schema ──────────────────────────
	describe("nullable output schema for optional properties", () => {
		const schemaWithRequired: JSONSchema7 = {
			type: "object",
			properties: {
				reqStr: { type: "string" },
				optStr: { type: "string" },
				optNum: { type: "number" },
				nested: {
					type: "object",
					properties: {
						inner: { type: "string" },
					},
					required: ["inner"],
				},
			},
			required: ["reqStr", "nested"],
		};

		test("required property → no null in output schema", () => {
			const result = analyze("{{reqStr}}", schemaWithRequired);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("optional property → null added to output schema", () => {
			const result = analyze("{{optStr}}", schemaWithRequired);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: ["string", "null"] });
		});

		test("optional number property → nullable number", () => {
			const result = analyze("{{optNum}}", schemaWithRequired);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: ["number", "null"] });
		});

		test("required nested path (all segments required) → no null", () => {
			const result = analyze("{{nested.inner}}", schemaWithRequired);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("path with optional intermediate segment → nullable", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					user: {
						type: "object",
						properties: {
							name: { type: "string" },
						},
						required: ["name"],
					},
				},
				// user is NOT required
			};
			const result = analyze("{{user.name}}", schema);
			expect(result.valid).toBe(true);
			// user is optional → entire path is nullable
			expect(result.outputSchema).toEqual({ type: ["string", "null"] });
		});

		test("mixed template with optional property → always string (no null)", () => {
			const result = analyze("Hello {{optStr}}", schemaWithRequired);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("$root → never nullable", () => {
			const result = analyze("{{$root}}", { type: "string" });
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("array element with optional property → nullable items", () => {
			const result = analyze(["{{optStr}}"], schemaWithRequired);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: ["string", "null"] },
				minItems: 1,
				maxItems: 1,
			});
		});

		test("object property with optional expression → nullable value", () => {
			const result = analyze({ key: "{{optStr}}" }, schemaWithRequired);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					key: { type: ["string", "null"] },
				},
				required: ["key"],
			});
		});

		// ── Deeply nested paths ──────────────────────────────────────────

		test("deeply nested path — first segment optional → nullable", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					a: {
						type: "object",
						properties: {
							b: {
								type: "object",
								properties: {
									c: {
										type: "object",
										properties: { d: { type: "string" } },
										required: ["d"],
									},
								},
								required: ["c"],
							},
						},
						required: ["b"],
					},
				},
				// a is NOT required
			};
			const result = analyze("{{a.b.c.d}}", schema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: ["string", "null"] });
		});

		test("deeply nested path — all segments required → no null", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					a: {
						type: "object",
						properties: {
							b: {
								type: "object",
								properties: {
									c: {
										type: "object",
										properties: { d: { type: "string" } },
										required: ["d"],
									},
								},
								required: ["c"],
							},
						},
						required: ["b"],
					},
				},
				required: ["a"],
			};
			const result = analyze("{{a.b.c.d}}", schema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("deeply nested path — middle segment optional → nullable", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					a: {
						type: "object",
						properties: {
							b: {
								type: "object",
								properties: {
									c: {
										type: "object",
										properties: { d: { type: "string" } },
										required: ["d"],
									},
								},
								// c is NOT required in b
							},
						},
						required: ["b"],
					},
				},
				required: ["a"],
			};
			const result = analyze("{{a.b.c.d}}", schema);
			expect(result.valid).toBe(true);
			// c is optional → entire path is nullable
			expect(result.outputSchema).toEqual({ type: ["string", "null"] });
		});

		test("5 levels deep — only leaf optional → nullable", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					l1: {
						type: "object",
						properties: {
							l2: {
								type: "object",
								properties: {
									l3: {
										type: "object",
										properties: {
											l4: {
												type: "object",
												properties: {
													value: { type: "number" },
												},
												// value NOT required
											},
										},
										required: ["l4"],
									},
								},
								required: ["l3"],
							},
						},
						required: ["l2"],
					},
				},
				required: ["l1"],
			};
			const result = analyze("{{l1.l2.l3.l4.value}}", schema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: ["number", "null"] });
		});

		// ── Deeply nested template inputs ────────────────────────────────

		test("nested object template — optional and required at each level", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					reqStr: { type: "string" },
					optStr: { type: "string" },
				},
				required: ["reqStr"],
			};
			const result = analyze(
				{
					level1: {
						level2: {
							opt: "{{optStr}}",
							req: "{{reqStr}}",
						},
					},
				},
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					level1: {
						type: "object",
						properties: {
							level2: {
								type: "object",
								properties: {
									opt: { type: ["string", "null"] },
									req: { type: "string" },
								},
								required: ["opt", "req"],
							},
						},
						required: ["level2"],
					},
				},
				required: ["level1"],
			});
		});

		test("array inside nested object template — optional items", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					reqStr: { type: "string" },
					optStr: { type: "string" },
				},
				required: ["reqStr"],
			};
			const result = analyze(
				{
					data: {
						ids: ["{{optStr}}", "{{reqStr}}"],
					},
				},
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					data: {
						type: "object",
						properties: {
							ids: {
								type: "array",
								items: {
									oneOf: [{ type: ["string", "null"] }, { type: "string" }],
								},
								minItems: 2,
								maxItems: 2,
							},
						},
						required: ["ids"],
					},
				},
				required: ["data"],
			});
		});

		test("triple nested template — all expressions optional → all nullable", () => {
			const schema: JSONSchema7 = {
				type: "object",
				properties: {
					a: { type: "string" },
					b: { type: "number" },
				},
				// nothing required
			};
			const result = analyze(
				{
					l1: {
						l2: {
							l3: {
								strVal: "{{a}}",
								numVal: "{{b}}",
							},
						},
					},
				},
				schema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					l1: {
						type: "object",
						properties: {
							l2: {
								type: "object",
								properties: {
									l3: {
										type: "object",
										properties: {
											strVal: { type: ["string", "null"] },
											numVal: { type: ["number", "null"] },
										},
										required: ["strVal", "numVal"],
									},
								},
								required: ["l3"],
							},
						},
						required: ["l2"],
					},
				},
				required: ["l1"],
			});
		});
	});

	describe("diagnostics include a position (loc)", () => {
		test("error includes position in the source", () => {
			const result = analyze("Hello {{badProp}}", userSchema);
			expect(result.diagnostics).toHaveLength(1);
			const diag = result.diagnostics[0];
			if (!diag) throw new Error("Expected diagnostic");
			expect(diag.loc).toBeDefined();
			expect(diag.loc?.start.line).toBeGreaterThanOrEqual(1);
		});
	});
});
