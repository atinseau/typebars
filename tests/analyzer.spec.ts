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

		test("single boolean expression → { type: 'boolean' }", () => {
			const result = analyze("{{active}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		});

		test("single integer expression → { type: 'integer' }", () => {
			const result = analyze("{{score}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test("single object expression → full object schema", () => {
			const result = analyze("{{address}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {
					city: { type: "string" },
					zip: { type: "string" },
				},
			});
		});

		test("single array expression → array schema", () => {
			const result = analyze("{{tags}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		test("single expression with dot notation → leaf type", () => {
			const result = analyze("{{address.city}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("single expression with enum → preserves enum", () => {
			const result = analyze("{{metadata.role}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "string",
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

		test("template with #with block → { type: 'string' }", () => {
			const result = analyze("{{#with address}}{{city}}{{/with}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
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
			// age is number, score is integer → oneOf
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "number" }, { type: "integer" }],
			});
		});

		test("#if with same expression type in both branches → single type", () => {
			const result = analyze(
				"{{#if active}}{{name}}{{else}}{{address.city}}{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		});

		test("#if with single expression and surrounding whitespace → expression type", () => {
			const result = analyze(
				"{{#if active}}\n  {{age}}\n{{else}}\n  {{score}}\n{{/if}}",
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				oneOf: [{ type: "number" }, { type: "integer" }],
			});
		});

		test("#with as single block → body type", () => {
			const result = analyze("{{#with address}}{{city}}{{/with}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
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

		test("resolves a property access via $ref", () => {
			const result = analyze("{{home.city}}", schemaWithRef);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
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
		test(".length access on an array is valid", () => {
			const result = analyze("{{tags.length}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test(".length access on an array of objects is valid", () => {
			const result = analyze("{{orders.length}}", userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.outputSchema).toEqual({ type: "integer" });
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
