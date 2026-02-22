import { describe, expect, test } from "bun:test";
import {
	analyze,
	execute,
	TemplateAnalysisError,
	TemplateEngine,
} from "../src/index.ts";
import { userData, userSchema } from "./fixtures.ts";

describe("TemplateEngine", () => {
	describe("isValidSyntax", () => {
		const engine = new TemplateEngine();

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
		const engine = new TemplateEngine();

		test("execute lève TemplateAnalysisError si le schema invalide le template", () => {
			expect(() =>
				engine.execute("{{badProp}}", { badProp: "x" }, userSchema),
			).toThrow(TemplateAnalysisError);
		});

		test("execute fonctionne si le schema valide le template", () => {
			const result = engine.execute("{{name}}", userData, userSchema);
			expect(result).toBe("Alice");
		});

		test("execute fonctionne sans schema (pas de validation)", () => {
			const result = engine.execute("{{anything}}", { anything: 42 });
			expect(result).toBe(42);
		});
	});

	describe("analyze", () => {
		const engine = new TemplateEngine();

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
		const engine = new TemplateEngine();

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
	const engine = new TemplateEngine();

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
			expect(engine.execute(99, userData, userSchema)).toBe(99);
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
