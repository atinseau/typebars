import { beforeEach, describe, expect, test } from "bun:test";
import { clearCompilationCache, execute } from "../src/executor.ts";
import { userData } from "./fixtures.ts";

describe("executor", () => {
	beforeEach(() => {
		clearCompilationCache();
	});

	describe("type preservation — single expression", () => {
		test("returns a string for {{name}}", () => {
			const result = execute("{{name}}", userData);
			expect(result).toBe("Alice");
			expect(typeof result).toBe("string");
		});

		test("returns a number for {{age}}", () => {
			const result = execute("{{age}}", userData);
			expect(result).toBe(30);
			expect(typeof result).toBe("number");
		});

		test("returns a boolean for {{active}}", () => {
			const result = execute("{{active}}", userData);
			expect(result).toBe(true);
			expect(typeof result).toBe("boolean");
		});

		test("returns an object for {{address}}", () => {
			const result = execute("{{address}}", userData);
			expect(result).toEqual({ city: "Paris", zip: "75001" });
			expect(typeof result).toBe("object");
		});

		test("returns an array for {{tags}}", () => {
			const result = execute("{{tags}}", userData);
			expect(result).toEqual(["developer", "typescript", "open-source"]);
			expect(Array.isArray(result)).toBe(true);
		});

		test("returns undefined for a missing property", () => {
			const result = execute("{{missing}}", userData);
			expect(result).toBeUndefined();
		});

		test("returns null for a null property", () => {
			const result = execute("{{val}}", { val: null });
			expect(result).toBeNull();
		});

		test("returns 0 for a property equal to 0", () => {
			const result = execute("{{val}}", { val: 0 });
			expect(result).toBe(0);
		});

		test("returns false for a property equal to false", () => {
			const result = execute("{{val}}", { val: false });
			expect(result).toBe(false);
		});

		test("returns an empty string for an empty string property", () => {
			const result = execute("{{val}}", { val: "" });
			expect(result).toBe("");
		});
	});

	describe("dot notation", () => {
		test("resolves a nested path", () => {
			expect(execute("{{address.city}}", userData)).toBe("Paris");
		});

		test("resolves a deeply nested path", () => {
			expect(execute("{{metadata.role}}", userData)).toBe("admin");
		});

		test("returns undefined if an intermediate segment is missing", () => {
			expect(execute("{{foo.bar.baz}}", {})).toBeUndefined();
		});
	});

	describe("mixed template → string", () => {
		test("text + expression", () => {
			const result = execute("Hello {{name}}!", userData);
			expect(result).toBe("Hello Alice!");
			expect(typeof result).toBe("string");
		});

		test("multiple expressions", () => {
			const result = execute("{{name}} ({{age}})", userData);
			expect(result).toBe("Alice (30)");
		});

		test("plain text without expression", () => {
			const result = execute("Just text", {});
			expect(result).toBe("Just text");
		});
	});

	describe("#if / #unless blocks", () => {
		test("#if truthy → main branch", () => {
			expect(execute("{{#if active}}yes{{else}}no{{/if}}", userData)).toBe(
				"yes",
			);
		});

		test("#if falsy → else branch", () => {
			expect(
				execute("{{#if active}}yes{{else}}no{{/if}}", { active: false }),
			).toBe("no");
		});

		test("#if without else, falsy condition → empty string", () => {
			expect(execute("{{#if active}}yes{{/if}}", { active: false })).toBe("");
		});

		test("#if with expression in body", () => {
			expect(execute("{{#if active}}Hello {{name}}{{/if}}", userData)).toBe(
				"Hello Alice",
			);
		});

		test("#unless truthy → else branch", () => {
			expect(
				execute("{{#unless active}}no{{else}}yes{{/unless}}", userData),
			).toBe("yes");
		});

		test("#unless falsy → main branch", () => {
			expect(
				execute("{{#unless active}}no{{else}}yes{{/unless}}", {
					active: false,
				}),
			).toBe("no");
		});
	});

	describe("type coercion — single block", () => {
		test("#if with numeric literals → returns a number", () => {
			const result = execute(
				"{{#if active}}\n  10\n{{else}}\n  20\n{{/if}}",
				userData,
			);
			expect(result).toBe(10);
			expect(typeof result).toBe("number");
		});

		test("#if else branch with numeric literal → returns a number", () => {
			const result = execute("{{#if active}}\n  10\n{{else}}\n  20\n{{/if}}", {
				active: false,
			});
			expect(result).toBe(20);
			expect(typeof result).toBe("number");
		});

		test("#if with inline numeric literals", () => {
			expect(execute("{{#if active}}42{{else}}0{{/if}}", userData)).toBe(42);
			expect(
				execute("{{#if active}}42{{else}}0{{/if}}", { active: false }),
			).toBe(0);
		});

		test("#if with decimal literal → returns a decimal number", () => {
			expect(execute("{{#if active}}3.14{{else}}2.71{{/if}}", userData)).toBe(
				3.14,
			);
		});

		test("#if with negative literal → returns a negative number", () => {
			expect(execute("{{#if active}}-5{{else}}5{{/if}}", userData)).toBe(-5);
		});

		test("#if with boolean literal true → returns a boolean", () => {
			const result = execute(
				"{{#if active}}true{{else}}false{{/if}}",
				userData,
			);
			expect(result).toBe(true);
			expect(typeof result).toBe("boolean");
		});

		test("#if with boolean literal false → returns a boolean", () => {
			const result = execute("{{#if active}}true{{else}}false{{/if}}", {
				active: false,
			});
			expect(result).toBe(false);
			expect(typeof result).toBe("boolean");
		});

		test("#if with null literal → returns null", () => {
			const result = execute(
				"{{#if active}}null{{else}}fallback{{/if}}",
				userData,
			);
			expect(result).toBeNull();
		});

		test("#if with non-literal text → returns a raw string", () => {
			const result = execute(
				"{{#if active}}hello{{else}}world{{/if}}",
				userData,
			);
			expect(result).toBe("hello");
			expect(typeof result).toBe("string");
		});

		test("single expression with whitespace → returns the raw value", () => {
			const result = execute("  {{age}}  ", userData);
			expect(result).toBe(30);
			expect(typeof result).toBe("number");
		});
	});

	describe("#each block", () => {
		test("#each on an array of strings", () => {
			const result = execute("{{#each tags}}[{{this}}]{{/each}}", userData);
			expect(result).toBe("[developer][typescript][open-source]");
		});

		test("#each on an array of objects", () => {
			const result = execute("{{#each orders}}{{product}} {{/each}}", userData);
			expect(result).toBe("Keyboard Monitor Mouse ");
		});

		test("#each with else branch (empty array)", () => {
			const result = execute("{{#each items}}{{this}}{{else}}empty{{/each}}", {
				items: [],
			});
			expect(result).toBe("empty");
		});

		test("#each always produces a string", () => {
			const result = execute("{{#each tags}}{{this}} {{/each}}", userData);
			expect(typeof result).toBe("string");
		});
	});

	describe("#with block", () => {
		test("#with changes the context", () => {
			expect(
				execute("{{#with address}}{{city}}, {{zip}}{{/with}}", userData),
			).toBe("Paris, 75001");
		});

		test("nested #with", () => {
			const data = { a: { b: { c: "deep" } } };
			expect(
				execute("{{#with a}}{{#with b}}{{c}}{{/with}}{{/with}}", data),
			).toBe("deep");
		});
	});

	describe("complex combinations", () => {
		test("#if + #each", () => {
			const result = execute(
				"{{#if active}}{{#each tags}}{{this}} {{/each}}{{else}}disabled{{/if}}",
				userData,
			);
			expect(result).toBe("developer typescript open-source ");
		});

		test("#with + #each", () => {
			const result = execute(
				"{{#with metadata}}{{#each permissions}}{{this}} {{/each}}{{/with}}",
				userData,
			);
			expect(result).toBe("read write delete ");
		});

		test("text + expression + #if + #each", () => {
			const result = execute(
				"User: {{name}} | Tags: {{#each tags}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}",
				userData,
			);
			expect(result).toBe(
				"User: Alice | Tags: developer, typescript, open-source",
			);
		});
	});
});
