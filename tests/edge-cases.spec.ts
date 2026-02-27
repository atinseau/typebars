import { beforeEach, describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { analyze } from "../src/analyzer";
import { clearCompilationCache, execute } from "../src/executor";
import { userSchema } from "./fixtures";

describe("edge cases", () => {
	beforeEach(() => {
		clearCompilationCache();
	});

	test("empty template → empty string", () => {
		const result = execute("", {});
		expect(result).toBe("");
	});

	test("empty template analyzed → valid, outputSchema string", () => {
		const result = analyze("", userSchema);
		expect(result.valid).toBe(true);
		// An empty template produces an empty string
		expect(result.outputSchema).toEqual({ type: "string" });
	});

	test("Handlebars comment only", () => {
		const result = analyze("{{!-- un commentaire --}}", userSchema);
		expect(result.valid).toBe(true);
	});

	test("inline comment", () => {
		const result = analyze("{{! commentaire }}", userSchema);
		expect(result.valid).toBe(true);
	});

	test("empty schema → any property is unknown", () => {
		const result = analyze("{{anything}}", {});
		expect(result.valid).toBe(false);
	});

	test("this inside an each returns the current context", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				items: { type: "array", items: { type: "number" } },
			},
		};
		const result = analyze("{{#each items}}{{this}}{{/each}}", schema);
		expect(result.valid).toBe(true);
	});

	test("execution of this inside an each", () => {
		const result = execute("{{#each items}}{{this}} {{/each}}", {
			items: [1, 2, 3],
		});
		expect(result).toBe("1 2 3 ");
	});

	test("schema with array type (multi-types)", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				value: { type: ["string", "null"] },
			},
		};
		const result = analyze("{{value}}", schema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({ type: ["string", "null"] });
	});

	test("accessing a property on a schema without properties", () => {
		const schema: JSONSchema7 = { type: "object" };
		const result = analyze("{{anything}}", schema);
		expect(result.valid).toBe(false);
	});

	test("nested #each with correct context", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				groups: {
					type: "array",
					items: {
						type: "object",
						properties: {
							members: {
								type: "array",
								items: { type: "string" },
							},
						},
					},
				},
			},
		};
		const result = analyze(
			"{{#each groups}}{{#each members}}{{this}}{{/each}}{{/each}}",
			schema,
		);
		expect(result.valid).toBe(true);
	});

	test("execution of nested #each", () => {
		const data = {
			groups: [{ members: ["a", "b"] }, { members: ["c"] }],
		};
		const result = execute(
			"{{#each groups}}[{{#each members}}{{this}}{{/each}}]{{/each}}",
			data,
		);
		expect(result).toBe("[ab][c]");
	});

	test("null runtime data does not break execution (dot notation)", () => {
		const result = execute("{{a.b.c}}", { a: null });
		expect(result).toBeUndefined();
	});
});
