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

		test("retourne true pour un template simple valide", () => {
			expect(engine.isValidSyntax("Hello {{name}}")).toBe(true);
		});

		test("retourne true pour un bloc valide", () => {
			expect(engine.isValidSyntax("{{#if x}}yes{{/if}}")).toBe(true);
		});

		test("retourne false pour un tag fermant incorrect", () => {
			expect(engine.isValidSyntax("{{#if x}}oops{{/each}}")).toBe(false);
		});

		test("retourne false pour un bloc non fermé", () => {
			expect(engine.isValidSyntax("{{#if x}}")).toBe(false);
		});

		test("retourne true pour du texte pur", () => {
			expect(engine.isValidSyntax("no expressions")).toBe(true);
		});

		test("retourne true pour un template vide", () => {
			expect(engine.isValidSyntax("")).toBe(true);
		});
	});

	describe("mode strict (défaut)", () => {
		const engine = new Typebars();

		test("execute lève TemplateAnalysisError si le schema invalide le template", () => {
			expect(() =>
				engine.execute("{{badProp}}", { badProp: "x" }, { schema: userSchema }),
			).toThrow(TemplateAnalysisError);
		});

		test("execute fonctionne si le schema valide le template", () => {
			const result = engine.execute("{{name}}", userData, {
				schema: userSchema,
			});
			expect(result).toBe("Alice");
		});

		test("execute fonctionne sans schema (pas de validation)", () => {
			const result = engine.execute("{{anything}}", { anything: 42 });
			expect(result).toBe(42);
		});
	});

	describe("analyze", () => {
		const engine = new Typebars();

		test("retourne un AnalysisResult avec valid, diagnostics, outputSchema", () => {
			const result = engine.analyze("{{name}}", userSchema);
			expect(result).toHaveProperty("valid");
			expect(result).toHaveProperty("diagnostics");
			expect(result).toHaveProperty("outputSchema");
		});

		test("outputSchema reflète le type de l'expression unique", () => {
			expect(engine.analyze("{{age}}", userSchema).outputSchema).toEqual({
				type: "number",
			});
		});

		test("outputSchema est string pour un template mixte", () => {
			expect(engine.analyze("Hello {{name}}", userSchema).outputSchema).toEqual(
				{ type: "string" },
			);
		});
	});

	describe("analyzeAndExecute", () => {
		const engine = new Typebars();

		test("retourne analysis et value quand le template est valide", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				"{{age}}",
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "number" });
			expect(value).toBe(30);
		});

		test("retourne value undefined quand le template est invalide en mode strict", () => {
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
		test("number entier → { type: 'integer' }", () => {
			const result = engine.analyze(10, { type: "number" });
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test("number décimal → { type: 'number' }", () => {
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

		test("number négatif → { type: 'integer' }", () => {
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

		test("inputSchema est ignoré pour les littéraux", () => {
			const result = engine.analyze(42, userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test("identifierSchemas est ignoré pour les littéraux", () => {
			const result = engine.analyze(42, userSchema, {
				1: { type: "object", properties: { x: { type: "string" } } },
			});
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});
	});

	describe("execute", () => {
		test("number retourne la valeur telle quelle", () => {
			expect(engine.execute(10, {})).toBe(10);
		});

		test("number 0 retourne 0", () => {
			expect(engine.execute(0, {})).toBe(0);
		});

		test("number décimal retourne la valeur", () => {
			expect(engine.execute(3.14, {})).toBe(3.14);
		});

		test("number négatif retourne la valeur", () => {
			expect(engine.execute(-42, {})).toBe(-42);
		});

		test("boolean true retourne true", () => {
			expect(engine.execute(true, {})).toBe(true);
		});

		test("boolean false retourne false", () => {
			expect(engine.execute(false, {})).toBe(false);
		});

		test("null retourne null", () => {
			expect(engine.execute(null, {})).toBe(null);
		});

		test("les données sont ignorées pour les littéraux", () => {
			expect(engine.execute(99, userData)).toBe(99);
		});

		test("le schema est ignoré pour les littéraux (pas de validation)", () => {
			expect(engine.execute(99, userData, { schema: userSchema })).toBe(99);
		});
	});

	describe("validate", () => {
		test("number est toujours valide", () => {
			const result = engine.validate(42, userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});

		test("boolean est toujours valide", () => {
			const result = engine.validate(true, userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});

		test("null est toujours valide", () => {
			const result = engine.validate(null, userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});
	});

	describe("isValidSyntax", () => {
		test("number est syntaxiquement valide", () => {
			expect(engine.isValidSyntax(42)).toBe(true);
		});

		test("boolean est syntaxiquement valide", () => {
			expect(engine.isValidSyntax(false)).toBe(true);
		});

		test("null est syntaxiquement valide", () => {
			expect(engine.isValidSyntax(null)).toBe(true);
		});
	});

	describe("compile", () => {
		test("compile un number et exécute → retourne la valeur", () => {
			const tpl = engine.compile(42);
			expect(tpl.execute({})).toBe(42);
		});

		test("compile un boolean et exécute → retourne la valeur", () => {
			const tpl = engine.compile(true);
			expect(tpl.execute({})).toBe(true);
		});

		test("compile null et exécute → retourne null", () => {
			const tpl = engine.compile(null);
			expect(tpl.execute({})).toBe(null);
		});

		test("compile un number et analyse → outputSchema integer", () => {
			const tpl = engine.compile(10);
			const result = tpl.analyze(userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test("compile un décimal et analyse → outputSchema number", () => {
			const tpl = engine.compile(3.14);
			const result = tpl.analyze(userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "number" });
		});

		test("compile un boolean et analyse → outputSchema boolean", () => {
			const tpl = engine.compile(false);
			const result = tpl.analyze(userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		});

		test("compile null et analyse → outputSchema null", () => {
			const tpl = engine.compile(null);
			const result = tpl.analyze(userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "null" });
		});

		test("compile un number et validate → toujours valide", () => {
			const tpl = engine.compile(42);
			const result = tpl.validate(userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});
	});

	describe("analyzeAndExecute", () => {
		test("number → analysis valide + value retournée", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				10,
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "integer" });
			expect(value).toBe(10);
		});

		test("boolean → analysis valide + value retournée", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				false,
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "boolean" });
			expect(value).toBe(false);
		});

		test("null → analysis valide + value retournée", () => {
			const { analysis, value } = engine.analyzeAndExecute(
				null,
				userSchema,
				userData,
			);
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "null" });
			expect(value).toBe(null);
		});

		test("number 0 → analysis valide + value 0 (pas falsy)", () => {
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
		test("analyze() standalone avec number", () => {
			const result = analyze(42, { type: "number" });
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "integer" });
		});

		test("analyze() standalone avec boolean", () => {
			const result = analyze(true, { type: "boolean" });
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		});

		test("analyze() standalone avec null", () => {
			const result = analyze(null, { type: "null" });
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "null" });
		});

		test("execute() standalone avec number", () => {
			expect(execute(42, {})).toBe(42);
		});

		test("execute() standalone avec boolean", () => {
			expect(execute(false, {})).toBe(false);
		});

		test("execute() standalone avec null", () => {
			expect(execute(null, {})).toBe(null);
		});

		test("execute() standalone avec 0", () => {
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
		test("objet simple avec templates string → outputSchema object avec types résolus", () => {
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

		test("objet avec valeur statique string → outputSchema string pour cette propriété", () => {
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

		test("objet avec littéraux primitifs → types inférés correctement", () => {
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

		test("objet avec propriété inexistante → valid false + diagnostic", () => {
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

		test("objet avec plusieurs erreurs → tous les diagnostics remontés", () => {
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

		test("objet avec sous-objet imbriqué → outputSchema imbriqué", () => {
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

		test("objet vide → outputSchema object vide", () => {
			const result = engine.analyze({}, userSchema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({
				type: "object",
				properties: {},
				required: [],
			});
		});

		test("objet mixte templates + littéraux + nested → types corrects", () => {
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
	});

	describe("execute", () => {
		test("objet simple avec templates string → valeurs résolues", () => {
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

		test("objet avec valeur statique string → passthrough", () => {
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

		test("objet avec littéraux primitifs → passthrough", () => {
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

		test("objet imbriqué → résolution récursive", () => {
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

		test("objet vide → objet vide", () => {
			expect(engine.execute({}, userData)).toEqual({});
		});

		test("objet avec template mixte → string pour les mixtes", () => {
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
		test("objet valide → valid true, pas de diagnostics", () => {
			const result = engine.validate(
				{ userName: "{{name}}", userAge: "{{age}}" },
				userSchema,
			);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});

		test("objet avec propriété inexistante → valid false", () => {
			const result = engine.validate(
				{ userName: "{{name}}", bad: "{{nope}}" },
				userSchema,
			);
			expect(result.valid).toBe(false);
			expect(result.diagnostics.length).toBeGreaterThan(0);
		});

		test("objet avec que des littéraux → toujours valide", () => {
			const result = engine.validate({ a: 42, b: true, c: null }, userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});
	});

	describe("isValidSyntax", () => {
		test("objet avec templates valides → true", () => {
			expect(
				engine.isValidSyntax({
					a: "{{name}}",
					b: "Hello {{age}}",
				}),
			).toBe(true);
		});

		test("objet avec un template syntaxiquement invalide → false", () => {
			expect(
				engine.isValidSyntax({
					a: "{{name}}",
					b: "{{#if x}}oops",
				}),
			).toBe(false);
		});

		test("objet avec littéraux → true", () => {
			expect(engine.isValidSyntax({ a: 42, b: true, c: null })).toBe(true);
		});

		test("objet imbriqué valide → true", () => {
			expect(
				engine.isValidSyntax({
					nested: { a: "{{name}}", b: 42 },
				}),
			).toBe(true);
		});

		test("objet imbriqué avec syntaxe invalide dans un enfant → false", () => {
			expect(
				engine.isValidSyntax({
					nested: { a: "{{#if x}}" },
				}),
			).toBe(false);
		});
	});

	describe("compile", () => {
		test("compile un objet et exécute → objet avec valeurs résolues", () => {
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

		test("compile un objet et analyse → outputSchema object", () => {
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

		test("compile un objet et validate → valid true", () => {
			const tpl = engine.compile({
				userName: "{{name}}",
				age: "{{age}}",
			});
			const result = tpl.validate(userSchema);
			expect(result.valid).toBe(true);
			expect(result.diagnostics).toEqual([]);
		});

		test("compile un objet avec erreur et validate → valid false", () => {
			const tpl = engine.compile({
				userName: "{{name}}",
				bad: "{{nope}}",
			});
			const result = tpl.validate(userSchema);
			expect(result.valid).toBe(false);
		});

		test("compile un objet imbriqué et exécute → résolution récursive", () => {
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

		test("compile un objet et analyzeAndExecute → analysis + value", () => {
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

		test("compile un objet avec erreur et analyzeAndExecute → value undefined", () => {
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
		test("objet valide → analysis valide + value objet résolu", () => {
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

		test("objet avec erreur → analysis invalide + value undefined", () => {
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

		test("objet avec littéraux + templates → types corrects + valeurs résolues", () => {
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

		test("objet imbriqué → analysis et value imbriqués", () => {
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

		test("erreur dans un sous-objet → tout l'objet invalide", () => {
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
		test("analyze() standalone avec objet", () => {
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

		test("analyze() standalone avec objet invalide", () => {
			const result = analyze({ bad: "{{nope}}" }, userSchema);
			expect(result.valid).toBe(false);
		});

		test("execute() standalone avec objet", () => {
			const result = execute(
				{ userName: "{{name}}", userAge: "{{age}}" },
				userData,
			);
			expect(result).toEqual({
				userName: "Alice",
				userAge: 30,
			});
		});

		test("execute() standalone avec objet imbriqué", () => {
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
