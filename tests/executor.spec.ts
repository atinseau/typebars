import { beforeEach, describe, expect, test } from "bun:test";
import { clearCompilationCache, execute } from "../src/executor.ts";
import { userData } from "./fixtures.ts";

describe("executor", () => {
	beforeEach(() => {
		clearCompilationCache();
	});

	describe("préservation des types — expression unique", () => {
		test("retourne un string pour {{name}}", () => {
			const result = execute("{{name}}", userData);
			expect(result).toBe("Alice");
			expect(typeof result).toBe("string");
		});

		test("retourne un number pour {{age}}", () => {
			const result = execute("{{age}}", userData);
			expect(result).toBe(30);
			expect(typeof result).toBe("number");
		});

		test("retourne un boolean pour {{active}}", () => {
			const result = execute("{{active}}", userData);
			expect(result).toBe(true);
			expect(typeof result).toBe("boolean");
		});

		test("retourne un object pour {{address}}", () => {
			const result = execute("{{address}}", userData);
			expect(result).toEqual({ city: "Paris", zip: "75001" });
			expect(typeof result).toBe("object");
		});

		test("retourne un array pour {{tags}}", () => {
			const result = execute("{{tags}}", userData);
			expect(result).toEqual(["developer", "typescript", "open-source"]);
			expect(Array.isArray(result)).toBe(true);
		});

		test("retourne undefined pour une propriété absente", () => {
			const result = execute("{{missing}}", userData);
			expect(result).toBeUndefined();
		});

		test("retourne null pour une propriété null", () => {
			const result = execute("{{val}}", { val: null });
			expect(result).toBeNull();
		});

		test("retourne 0 pour une propriété valant 0", () => {
			const result = execute("{{val}}", { val: 0 });
			expect(result).toBe(0);
		});

		test("retourne false pour une propriété valant false", () => {
			const result = execute("{{val}}", { val: false });
			expect(result).toBe(false);
		});

		test("retourne une string vide pour une propriété string vide", () => {
			const result = execute("{{val}}", { val: "" });
			expect(result).toBe("");
		});
	});

	describe("dot notation", () => {
		test("résout un chemin imbriqué", () => {
			expect(execute("{{address.city}}", userData)).toBe("Paris");
		});

		test("résout un chemin profond", () => {
			expect(execute("{{metadata.role}}", userData)).toBe("admin");
		});

		test("retourne undefined si un segment intermédiaire est absent", () => {
			expect(execute("{{foo.bar.baz}}", {})).toBeUndefined();
		});
	});

	describe("template mixte → string", () => {
		test("texte + expression", () => {
			const result = execute("Hello {{name}}!", userData);
			expect(result).toBe("Hello Alice!");
			expect(typeof result).toBe("string");
		});

		test("plusieurs expressions", () => {
			const result = execute("{{name}} ({{age}})", userData);
			expect(result).toBe("Alice (30)");
		});

		test("texte pur sans expression", () => {
			const result = execute("Just text", {});
			expect(result).toBe("Just text");
		});
	});

	describe("bloc #if / #unless", () => {
		test("#if truthy → branche principale", () => {
			expect(execute("{{#if active}}yes{{else}}no{{/if}}", userData)).toBe(
				"yes",
			);
		});

		test("#if falsy → branche else", () => {
			expect(
				execute("{{#if active}}yes{{else}}no{{/if}}", { active: false }),
			).toBe("no");
		});

		test("#if sans else, condition falsy → string vide", () => {
			expect(execute("{{#if active}}yes{{/if}}", { active: false })).toBe("");
		});

		test("#if avec expression dans le corps", () => {
			expect(execute("{{#if active}}Hello {{name}}{{/if}}", userData)).toBe(
				"Hello Alice",
			);
		});

		test("#unless truthy → branche else", () => {
			expect(
				execute("{{#unless active}}no{{else}}yes{{/unless}}", userData),
			).toBe("yes");
		});

		test("#unless falsy → branche principale", () => {
			expect(
				execute("{{#unless active}}no{{else}}yes{{/unless}}", {
					active: false,
				}),
			).toBe("no");
		});
	});

	describe("coercion de type — bloc unique", () => {
		test("#if avec littéraux numériques → retourne un number", () => {
			const result = execute(
				"{{#if active}}\n  10\n{{else}}\n  20\n{{/if}}",
				userData,
			);
			expect(result).toBe(10);
			expect(typeof result).toBe("number");
		});

		test("#if branche else avec littéral numérique → retourne un number", () => {
			const result = execute("{{#if active}}\n  10\n{{else}}\n  20\n{{/if}}", {
				active: false,
			});
			expect(result).toBe(20);
			expect(typeof result).toBe("number");
		});

		test("#if avec littéraux numériques inline", () => {
			expect(execute("{{#if active}}42{{else}}0{{/if}}", userData)).toBe(42);
			expect(
				execute("{{#if active}}42{{else}}0{{/if}}", { active: false }),
			).toBe(0);
		});

		test("#if avec littéral décimal → retourne un number décimal", () => {
			expect(execute("{{#if active}}3.14{{else}}2.71{{/if}}", userData)).toBe(
				3.14,
			);
		});

		test("#if avec littéral négatif → retourne un number négatif", () => {
			expect(execute("{{#if active}}-5{{else}}5{{/if}}", userData)).toBe(-5);
		});

		test("#if avec littéral booléen true → retourne un boolean", () => {
			const result = execute(
				"{{#if active}}true{{else}}false{{/if}}",
				userData,
			);
			expect(result).toBe(true);
			expect(typeof result).toBe("boolean");
		});

		test("#if avec littéral booléen false → retourne un boolean", () => {
			const result = execute("{{#if active}}true{{else}}false{{/if}}", {
				active: false,
			});
			expect(result).toBe(false);
			expect(typeof result).toBe("boolean");
		});

		test("#if avec littéral null → retourne null", () => {
			const result = execute(
				"{{#if active}}null{{else}}fallback{{/if}}",
				userData,
			);
			expect(result).toBeNull();
		});

		test("#if avec texte non-littéral → retourne une string brute", () => {
			const result = execute(
				"{{#if active}}hello{{else}}world{{/if}}",
				userData,
			);
			expect(result).toBe("hello");
			expect(typeof result).toBe("string");
		});

		test("expression unique avec whitespace → retourne la valeur brute", () => {
			const result = execute("  {{age}}  ", userData);
			expect(result).toBe(30);
			expect(typeof result).toBe("number");
		});
	});

	describe("bloc #each", () => {
		test("#each sur un tableau de strings", () => {
			const result = execute("{{#each tags}}[{{this}}]{{/each}}", userData);
			expect(result).toBe("[developer][typescript][open-source]");
		});

		test("#each sur un tableau d'objets", () => {
			const result = execute("{{#each orders}}{{product}} {{/each}}", userData);
			expect(result).toBe("Keyboard Monitor Mouse ");
		});

		test("#each avec branche else (tableau vide)", () => {
			const result = execute("{{#each items}}{{this}}{{else}}empty{{/each}}", {
				items: [],
			});
			expect(result).toBe("empty");
		});

		test("#each produit toujours une string", () => {
			const result = execute("{{#each tags}}{{this}} {{/each}}", userData);
			expect(typeof result).toBe("string");
		});
	});

	describe("bloc #with", () => {
		test("#with change le contexte", () => {
			expect(
				execute("{{#with address}}{{city}}, {{zip}}{{/with}}", userData),
			).toBe("Paris, 75001");
		});

		test("#with imbriqué", () => {
			const data = { a: { b: { c: "deep" } } };
			expect(
				execute("{{#with a}}{{#with b}}{{c}}{{/with}}{{/with}}", data),
			).toBe("deep");
		});
	});

	describe("combinaisons complexes", () => {
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

		test("texte + expression + #if + #each", () => {
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
