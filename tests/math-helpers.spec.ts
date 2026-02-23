import { beforeEach, describe, expect, it } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { MathHelpers } from "../src/helpers/math-helpers.ts";
import { Typebars } from "../src/typebars.ts";
import type { HelperConfig } from "../src/types.ts";

// ─── Schema & données partagées ──────────────────────────────────────────────

const schema: JSONSchema7 = {
	type: "object",
	properties: {
		a: { type: "number" },
		b: { type: "number" },
		zero: { type: "number" },
		negative: { type: "number" },
		decimal: { type: "number" },
		items: { type: "array", items: { type: "number" } },
		label: { type: "string" },
	},
	required: ["a", "b", "zero", "negative", "decimal", "items", "label"],
} as const;

const data = {
	a: 10,
	b: 3,
	zero: 0,
	negative: -7,
	decimal: Math.PI,
	items: [1, 2, 3, 4, 5],
	label: "hello",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function run(engine: Typebars, template: string) {
	return engine.analyzeAndExecute(template, schema, data);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MathHelpers", () => {
	let engine: Typebars;

	beforeEach(() => {
		engine = new Typebars();
	});

	// ─── Built-in registration ───────────────────────────────────────────

	describe("pré-enregistrement (built-in)", () => {
		it("tous les math helpers sont disponibles sans appel à register()", () => {
			const names = MathHelpers.getHelperNames();
			for (const name of names) {
				expect(engine.hasHelper(name)).toBe(true);
			}
		});

		it("un engine frais peut directement utiliser les math helpers", () => {
			const { analysis, value } = run(engine, "{{ add a b }}");
			expect(analysis.valid).toBe(true);
			expect(value).toBe(13);
		});
	});

	// ─── Register / unregister explicite ─────────────────────────────────

	describe("register / unregister explicite", () => {
		it("unregister supprime tous les helpers", () => {
			MathHelpers.unregister(engine);
			const names = MathHelpers.getHelperNames();
			for (const name of names) {
				expect(engine.hasHelper(name)).toBe(false);
			}
		});

		it("register ré-enregistre après un unregister", () => {
			MathHelpers.unregister(engine);
			expect(engine.hasHelper("add")).toBe(false);

			MathHelpers.register(engine);
			expect(engine.hasHelper("add")).toBe(true);

			const { value } = run(engine, "{{ add a b }}");
			expect(value).toBe(13);
		});

		it("register est idempotent (pas d'erreur si appelé deux fois)", () => {
			MathHelpers.register(engine);
			expect(engine.hasHelper("add")).toBe(true);
		});
	});

	// ─── getDefinitions ──────────────────────────────────────────────────

	describe("getDefinitions", () => {
		it("retourne une Map avec toutes les définitions", () => {
			const defs = MathHelpers.getDefinitions();
			expect(defs).toBeInstanceOf(Map);
			expect(defs.size).toBeGreaterThanOrEqual(
				MathHelpers.getHelperNames().length,
			);
		});

		it("chaque définition a fn et returnType number", () => {
			const defs = MathHelpers.getDefinitions();
			for (const [, def] of defs) {
				expect(typeof def.fn).toBe("function");
				expect(def.returnType).toEqual({ type: "number" });
			}
		});
	});

	// ─── params metadata ────────────────────────────────────────────────

	describe("params metadata", () => {
		it("chaque définition a un tableau params non vide", () => {
			const defs = MathHelpers.getDefinitions();
			for (const [_name, def] of defs) {
				expect(def.params).toBeDefined();
				expect(def.params?.length).toBeGreaterThan(0);
			}
		});

		it("chaque param a un name et un type", () => {
			const defs = MathHelpers.getDefinitions();
			for (const [, def] of defs) {
				for (const param of def.params ?? []) {
					expect(typeof param.name).toBe("string");
					expect(param.name.length).toBeGreaterThan(0);
					expect(param.type).toBeDefined();
				}
			}
		});

		it("chaque définition a une description", () => {
			const defs = MathHelpers.getDefinitions();
			for (const [, def] of defs) {
				expect(typeof def.description).toBe("string");
				expect(def.description?.length).toBeGreaterThan(0);
			}
		});

		it("round a un paramètre precision optionnel", () => {
			const defs = MathHelpers.getDefinitions();
			const roundDef = defs.get("round");
			expect(roundDef).toBeDefined();
			expect(roundDef?.params?.length).toBe(2);

			const precisionParam = roundDef?.params?.[1];
			expect(precisionParam?.name).toBe("precision");
			expect(precisionParam?.optional).toBe(true);
		});

		it("math a un paramètre operator avec enum", () => {
			const defs = MathHelpers.getDefinitions();
			const mathDef = defs.get("math");
			expect(mathDef).toBeDefined();
			expect(mathDef?.params?.length).toBe(3);

			const operatorParam = mathDef?.params?.[1];
			expect(operatorParam?.name).toBe("operator");
			expect(operatorParam?.type).toEqual({
				type: "string",
				enum: ["+", "-", "*", "/", "%", "**"],
			});
		});

		it("les helpers binaires ont exactement 2 params", () => {
			const defs = MathHelpers.getDefinitions();
			const binaryHelpers = [
				"add",
				"subtract",
				"multiply",
				"divide",
				"modulo",
				"pow",
				"min",
				"max",
			];
			for (const name of binaryHelpers) {
				const def = defs.get(name);
				expect(def?.params?.length).toBe(2);
			}
		});

		it("les helpers unaires ont exactement 1 param", () => {
			const defs = MathHelpers.getDefinitions();
			const unaryHelpers = ["abs", "ceil", "floor", "sqrt"];
			for (const name of unaryHelpers) {
				const def = defs.get(name);
				expect(def?.params?.length).toBe(1);
			}
		});
	});

	// ─── isMathHelper ────────────────────────────────────────────────────

	describe("isMathHelper", () => {
		it("retourne true pour un helper math connu", () => {
			expect(MathHelpers.isMathHelper("add")).toBe(true);
			expect(MathHelpers.isMathHelper("math")).toBe(true);
			expect(MathHelpers.isMathHelper("floor")).toBe(true);
		});

		it("retourne false pour un helper inconnu", () => {
			expect(MathHelpers.isMathHelper("uppercase")).toBe(false);
			expect(MathHelpers.isMathHelper("unknown")).toBe(false);
		});
	});

	// ─── add ─────────────────────────────────────────────────────────────

	describe("add", () => {
		it("additionne deux propriétés", () => {
			const { analysis, value } = run(engine, "{{ add a b }}");
			expect(analysis.valid).toBe(true);
			expect(value).toBe(13);
		});

		it("additionne une propriété et un littéral", () => {
			const { value } = run(engine, "{{ add a 5 }}");
			expect(value).toBe(15);
		});

		it("additionne avec un nombre négatif", () => {
			const { value } = run(engine, "{{ add a negative }}");
			expect(value).toBe(3);
		});

		it("additionne avec zéro", () => {
			const { value } = run(engine, "{{ add a zero }}");
			expect(value).toBe(10);
		});

		it("additionne des décimaux", () => {
			const { value } = run(engine, "{{ add decimal 1 }}");
			expect(value).toBeCloseTo(4.14159, 5);
		});

		it("analyse statique retourne outputSchema number", () => {
			const { analysis } = run(engine, "{{ add a b }}");
			expect(analysis.outputSchema).toEqual({ type: "number" });
		});
	});

	// ─── subtract / sub ──────────────────────────────────────────────────

	describe("subtract / sub", () => {
		it("soustrait deux propriétés avec subtract", () => {
			const { value } = run(engine, "{{ subtract a b }}");
			expect(value).toBe(7);
		});

		it("soustrait avec l'alias sub", () => {
			const { value } = run(engine, "{{ sub a b }}");
			expect(value).toBe(7);
		});

		it("soustrait un littéral", () => {
			const { value } = run(engine, "{{ sub a 3 }}");
			expect(value).toBe(7);
		});

		it("résultat négatif", () => {
			const { value } = run(engine, "{{ sub b a }}");
			expect(value).toBe(-7);
		});
	});

	// ─── multiply / mul ──────────────────────────────────────────────────

	describe("multiply / mul", () => {
		it("multiplie deux propriétés avec multiply", () => {
			const { value } = run(engine, "{{ multiply a b }}");
			expect(value).toBe(30);
		});

		it("multiplie avec l'alias mul", () => {
			const { value } = run(engine, "{{ mul a b }}");
			expect(value).toBe(30);
		});

		it("multiplie par zéro", () => {
			const { value } = run(engine, "{{ mul a zero }}");
			expect(value).toBe(0);
		});

		it("multiplie par un négatif", () => {
			const { value } = run(engine, "{{ mul a negative }}");
			expect(value).toBe(-70);
		});

		it("multiplie des décimaux", () => {
			const { value } = run(engine, "{{ mul decimal 2 }}");
			expect(value).toBeCloseTo(6.28318, 4);
		});
	});

	// ─── divide / div ────────────────────────────────────────────────────

	describe("divide / div", () => {
		it("divise deux propriétés avec divide", () => {
			const { value } = run(engine, "{{ divide a b }}");
			expect(value).toBeCloseTo(3.3333, 3);
		});

		it("divise avec l'alias div", () => {
			const { value } = run(engine, "{{ div a b }}");
			expect(value).toBeCloseTo(3.3333, 3);
		});

		it("division entière exacte", () => {
			const { value } = run(engine, "{{ divide a 2 }}");
			expect(value).toBe(5);
		});

		it("division par zéro retourne Infinity", () => {
			const { value } = run(engine, "{{ divide a zero }}");
			expect(value).toBeDefined();
		});

		it("divise un littéral par une propriété", () => {
			const { value } = run(engine, "{{ divide 100 a }}");
			expect(value).toBe(10);
		});

		it("divise avec .length d'un tableau", () => {
			const { value } = run(engine, "{{ divide items.length 5 }}");
			expect(value).toBe(1);
		});
	});

	// ─── modulo / mod ────────────────────────────────────────────────────

	describe("modulo / mod", () => {
		it("calcule le modulo avec modulo", () => {
			const { value } = run(engine, "{{ modulo a b }}");
			expect(value).toBe(1);
		});

		it("calcule le modulo avec l'alias mod", () => {
			const { value } = run(engine, "{{ mod a b }}");
			expect(value).toBe(1);
		});

		it("modulo avec diviseur plus grand", () => {
			const { value } = run(engine, "{{ mod b a }}");
			expect(value).toBe(3);
		});

		it("modulo par zéro retourne NaN", () => {
			const { value } = run(engine, "{{ mod a zero }}");
			expect(value).toBeDefined();
		});
	});

	// ─── pow ─────────────────────────────────────────────────────────────

	describe("pow", () => {
		it("élève à la puissance", () => {
			const { value } = run(engine, "{{ pow a 2 }}");
			expect(value).toBe(100);
		});

		it("puissance 0 retourne 1", () => {
			const { value } = run(engine, "{{ pow a 0 }}");
			expect(value).toBe(1);
		});

		it("puissance 1 retourne la valeur elle-même", () => {
			const { value } = run(engine, "{{ pow a 1 }}");
			expect(value).toBe(10);
		});

		it("puissance avec base 0", () => {
			const { value } = run(engine, "{{ pow zero 5 }}");
			expect(value).toBe(0);
		});

		it("puissance avec exposant négatif", () => {
			const { value } = run(engine, "{{ pow a -1 }}");
			expect(value).toBeCloseTo(0.1, 5);
		});
	});

	// ─── abs ─────────────────────────────────────────────────────────────

	describe("abs", () => {
		it("retourne la valeur absolue d'un nombre négatif", () => {
			const { value } = run(engine, "{{ abs negative }}");
			expect(value).toBe(7);
		});

		it("retourne la valeur absolue d'un nombre positif (inchangé)", () => {
			const { value } = run(engine, "{{ abs a }}");
			expect(value).toBe(10);
		});

		it("retourne 0 pour zéro", () => {
			const { value } = run(engine, "{{ abs zero }}");
			expect(value).toBe(0);
		});
	});

	// ─── ceil ────────────────────────────────────────────────────────────

	describe("ceil", () => {
		it("arrondit un décimal vers le haut", () => {
			const { value } = run(engine, "{{ ceil decimal }}");
			expect(value).toBe(4);
		});

		it("un entier reste inchangé", () => {
			const { value } = run(engine, "{{ ceil a }}");
			expect(value).toBe(10);
		});

		it("arrondit un négatif vers le haut (vers zéro)", () => {
			const { value } = run(engine, "{{ ceil negative }}");
			expect(value).toBe(-7);
		});
	});

	// ─── floor ───────────────────────────────────────────────────────────

	describe("floor", () => {
		it("arrondit un décimal vers le bas", () => {
			const { value } = run(engine, "{{ floor decimal }}");
			expect(value).toBe(3);
		});

		it("un entier reste inchangé", () => {
			const { value } = run(engine, "{{ floor a }}");
			expect(value).toBe(10);
		});

		it("arrondit un négatif vers le bas (loin de zéro)", () => {
			const { value } = run(engine, "{{ floor negative }}");
			expect(value).toBe(-7);
		});
	});

	// ─── round ───────────────────────────────────────────────────────────

	describe("round", () => {
		it("arrondit à l'entier le plus proche", () => {
			const { value } = run(engine, "{{ round decimal }}");
			expect(value).toBe(3);
		});

		it("arrondit avec précision 2", () => {
			const { value } = run(engine, "{{ round decimal 2 }}");
			expect(value).toBe(3.14);
		});

		it("arrondit avec précision 0 (identique à sans précision)", () => {
			const { value } = run(engine, "{{ round decimal 0 }}");
			expect(value).toBe(3);
		});

		it("un entier reste inchangé", () => {
			const { value } = run(engine, "{{ round a }}");
			expect(value).toBe(10);
		});
	});

	// ─── sqrt ────────────────────────────────────────────────────────────

	describe("sqrt", () => {
		it("calcule la racine carrée", () => {
			const result = engine.analyzeAndExecute(
				"{{ sqrt val }}",
				{
					type: "object",
					properties: { val: { type: "number" } },
					required: ["val"],
				},
				{ val: 9 },
			);
			expect(result.value).toBe(3);
		});

		it("racine de zéro", () => {
			const { value } = run(engine, "{{ sqrt zero }}");
			expect(value).toBe(0);
		});
	});

	// ─── min ─────────────────────────────────────────────────────────────

	describe("min", () => {
		it("retourne le plus petit de deux nombres", () => {
			const { value } = run(engine, "{{ min a b }}");
			expect(value).toBe(3);
		});

		it("retourne le plus petit avec un négatif", () => {
			const { value } = run(engine, "{{ min a negative }}");
			expect(value).toBe(-7);
		});

		it("retourne le nombre si les deux sont égaux", () => {
			const { value } = run(engine, "{{ min a a }}");
			expect(value).toBe(10);
		});
	});

	// ─── max ─────────────────────────────────────────────────────────────

	describe("max", () => {
		it("retourne le plus grand de deux nombres", () => {
			const { value } = run(engine, "{{ max a b }}");
			expect(value).toBe(10);
		});

		it("retourne le plus grand avec un négatif", () => {
			const { value } = run(engine, "{{ max a negative }}");
			expect(value).toBe(10);
		});

		it("retourne le nombre si les deux sont égaux", () => {
			const { value } = run(engine, "{{ max b b }}");
			expect(value).toBe(3);
		});
	});

	// ─── math (helper générique) ─────────────────────────────────────────

	describe("math (helper générique)", () => {
		it('addition avec "+"', () => {
			const { value } = run(engine, '{{ math a "+" b }}');
			expect(value).toBe(13);
		});

		it('soustraction avec "-"', () => {
			const { value } = run(engine, '{{ math a "-" b }}');
			expect(value).toBe(7);
		});

		it('multiplication avec "*"', () => {
			const { value } = run(engine, '{{ math a "*" b }}');
			expect(value).toBe(30);
		});

		it('division avec "/"', () => {
			const { value } = run(engine, '{{ math a "/" b }}');
			expect(value).toBeCloseTo(3.3333, 3);
		});

		it('modulo avec "%"', () => {
			const { value } = run(engine, '{{ math a "%" b }}');
			expect(value).toBe(1);
		});

		it('exponentiation avec "**"', () => {
			const { value } = run(engine, '{{ math b "**" 3 }}');
			expect(value).toBe(27);
		});

		it('division par zéro avec "/"', () => {
			const { value } = run(engine, '{{ math a "/" zero }}');
			expect(value).toBeDefined();
		});

		it("analyse statique retourne outputSchema number", () => {
			const { analysis } = run(engine, '{{ math a "+" b }}');
			expect(analysis.valid).toBe(true);
			expect(analysis.outputSchema).toEqual({ type: "number" });
		});

		it("fonctionne avec des littéraux numériques des deux côtés", () => {
			const { value } = run(engine, '{{ math 6 "*" 7 }}');
			expect(value).toBe(42);
		});
	});

	// ─── Combinaison avec .length ────────────────────────────────────────

	describe("combinaison avec .length", () => {
		it("divise la longueur d'un tableau par un nombre", () => {
			const { analysis, value } = run(engine, "{{ divide items.length 5 }}");
			expect(analysis.valid).toBe(true);
			expect(value).toBe(1);
		});

		it("multiplie la longueur d'un tableau", () => {
			const { value } = run(engine, "{{ mul items.length 10 }}");
			expect(value).toBe(50);
		});

		it("utilise math avec .length", () => {
			const { value } = run(engine, '{{ math items.length "+" 100 }}');
			expect(value).toBe(105);
		});
	});

	// ─── Intégration dans des templates mixtes ───────────────────────────

	describe("intégration dans des templates mixtes", () => {
		it("helper math dans un template avec du texte", () => {
			const { analysis, value } = run(engine, "Total: {{ mul a b }} items");
			expect(analysis.valid).toBe(true);
			expect(value).toBe("Total: 30 items");
		});

		it("plusieurs helpers math dans un même template", () => {
			const { value } = run(engine, "{{ add a b }} and {{ sub a b }}");
			expect(value).toBe("13 and 7");
		});

		it("helper math dans un bloc #if", () => {
			const result = engine.analyzeAndExecute(
				"{{#if a}}{{ mul a 2 }}{{/if}}",
				schema,
				data,
			);
			expect(result.value).toBe(20);
		});
	});

	// ─── Coercion de types ───────────────────────────────────────────────

	describe("coercion de types", () => {
		it("expression unique helper retourne un number (pas une string)", () => {
			const { value } = run(engine, "{{ add a b }}");
			expect(typeof value).toBe("number");
			expect(value).toBe(13);
		});

		it("expression unique avec whitespace retourne un number", () => {
			const { value } = run(engine, "  {{ add a b }}  ");
			expect(typeof value).toBe("number");
			expect(value).toBe(13);
		});

		it("template mixte retourne toujours une string", () => {
			const { value } = run(engine, "result: {{ add a b }}");
			expect(typeof value).toBe("string");
		});
	});

	// ─── Edge cases ──────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("opération sur une propriété string détecte un TYPE_MISMATCH", () => {
			const { analysis, value } = run(engine, "{{ add label 5 }}");
			expect(analysis.valid).toBe(false);
			expect(value).toBeUndefined();
			expect(analysis.diagnostics).toHaveLength(1);
			expect(analysis.diagnostics[0]?.code).toBe("TYPE_MISMATCH");
			expect(analysis.diagnostics[0]?.message).toContain('"add"');
			expect(analysis.diagnostics[0]?.message).toContain("string");
			expect(analysis.diagnostics[0]?.details?.expected).toBe("number");
			expect(analysis.diagnostics[0]?.details?.actual).toBe("string");
		});

		it("opération avec un très grand nombre", () => {
			const result = engine.analyzeAndExecute(
				"{{ mul val 2 }}",
				{
					type: "object",
					properties: { val: { type: "number" } },
					required: ["val"],
				},
				{ val: Number.MAX_SAFE_INTEGER },
			);
			expect(result.value).toBe(Number.MAX_SAFE_INTEGER * 2);
		});

		it("chaînage conceptuel — résultat en template mixte", () => {
			const { value } = run(engine, "{{ add a 5 }} + {{ mul b 2 }}");
			expect(value).toBe("15 + 6");
		});
	});
});

// ─── Tests du système helpers via options du constructeur ─────────────────────

describe("Typebars({ helpers: [...] })", () => {
	it("enregistre des helpers custom via les options", () => {
		const engine = new Typebars({
			helpers: [
				{
					name: "uppercase",
					fn: (value: string) => String(value).toUpperCase(),
					params: [
						{
							name: "value",
							type: { type: "string" },
							description: "The string to convert",
						},
					],
					returnType: { type: "string" },
					description: "Converts a string to uppercase",
				},
			],
		});

		expect(engine.hasHelper("uppercase")).toBe(true);
	});

	it("les helpers custom fonctionnent à l'exécution", () => {
		const engine = new Typebars({
			helpers: [
				{
					name: "double",
					fn: (val: unknown) => Number(val) * 2,
					params: [{ name: "value", type: { type: "number" } }],
					returnType: { type: "number" },
				},
			],
		});

		const result = engine.analyzeAndExecute(
			"{{ double price }}",
			{
				type: "object",
				properties: { price: { type: "number" } },
				required: ["price"],
			},
			{ price: 25 },
		);

		expect(result.analysis.valid).toBe(true);
		expect(result.analysis.outputSchema).toEqual({ type: "number" });
		expect(result.value).toBe(50);
	});

	it("les helpers custom coexistent avec les math helpers built-in", () => {
		const engine = new Typebars({
			helpers: [
				{
					name: "uppercase",
					fn: (value: string) => String(value).toUpperCase(),
					returnType: { type: "string" },
				},
			],
		});

		// Built-in math helper fonctionne toujours
		expect(engine.hasHelper("add")).toBe(true);
		expect(engine.hasHelper("uppercase")).toBe(true);

		const mathResult = engine.analyzeAndExecute(
			"{{ add a b }}",
			{
				type: "object",
				properties: { a: { type: "number" }, b: { type: "number" } },
				required: ["a", "b"],
			},
			{ a: 5, b: 3 },
		);
		expect(mathResult.value).toBe(8);
	});

	it("un helper custom peut overrider un math helper built-in", () => {
		const engine = new Typebars({
			helpers: [
				{
					name: "add",
					fn: (a: unknown, b: unknown) => `${String(a)}-${String(b)}`,
					params: [
						{ name: "a", type: { type: "string" } },
						{ name: "b", type: { type: "string" } },
					],
					returnType: { type: "string" },
					description: "Custom add that concatenates with a dash",
				},
			],
		});

		const result = engine.analyzeAndExecute(
			"{{ add a b }}",
			{
				type: "object",
				properties: { a: { type: "string" }, b: { type: "string" } },
				required: ["a", "b"],
			},
			{ a: "hello", b: "world" },
		);

		expect(result.analysis.valid).toBe(true);
		expect(result.analysis.outputSchema).toEqual({ type: "string" });
		expect(result.value).toBe("hello-world");
	});

	it("supporte plusieurs helpers custom dans le même tableau", () => {
		const helpers: HelperConfig[] = [
			{
				name: "greet",
				fn: (name: string) => `Hello, ${name}!`,
				params: [{ name: "name", type: { type: "string" } }],
				returnType: { type: "string" },
			},
			{
				name: "shout",
				fn: (text: string) => `${String(text).toUpperCase()}!`,
				params: [{ name: "text", type: { type: "string" } }],
				returnType: { type: "string" },
			},
			{
				name: "negate",
				fn: (val: unknown) => -Number(val),
				params: [{ name: "value", type: { type: "number" } }],
				returnType: { type: "number" },
			},
		];

		const engine = new Typebars({ helpers });

		expect(engine.hasHelper("greet")).toBe(true);
		expect(engine.hasHelper("shout")).toBe(true);
		expect(engine.hasHelper("negate")).toBe(true);
	});

	it("fonctionne avec un tableau vide de helpers", () => {
		const engine = new Typebars({ helpers: [] });
		// Math helpers built-in toujours disponibles
		expect(engine.hasHelper("add")).toBe(true);
	});

	it("fonctionne sans l'option helpers (undefined)", () => {
		const engine = new Typebars({});
		expect(engine.hasHelper("add")).toBe(true);
	});

	it("un helper custom avec params et description est introspecable via registerHelper", () => {
		const engine = new Typebars({
			helpers: [
				{
					name: "tax",
					description: "Applies a tax rate to a price",
					fn: (price: unknown, rate: unknown) =>
						Number(price) * (1 + Number(rate) / 100),
					params: [
						{
							name: "price",
							type: { type: "number" },
							description: "The base price",
						},
						{
							name: "rate",
							type: { type: "number" },
							description: "Tax rate in percentage",
						},
					],
					returnType: { type: "number" },
				},
			],
		});

		expect(engine.hasHelper("tax")).toBe(true);

		const result = engine.analyzeAndExecute(
			"{{ tax price rate }}",
			{
				type: "object",
				properties: {
					price: { type: "number" },
					rate: { type: "number" },
				},
				required: ["price", "rate"],
			},
			{ price: 100, rate: 20 },
		);

		expect(result.analysis.valid).toBe(true);
		expect(result.analysis.outputSchema).toEqual({ type: "number" });
		expect(result.value).toBe(120);
	});

	it("un helper custom avec paramètre optionnel", () => {
		const engine = new Typebars({
			helpers: [
				{
					name: "repeat",
					description: "Repeats a string n times",
					fn: (text: unknown, count: unknown) => {
						const n =
							count === undefined || count === null || typeof count === "object"
								? 2
								: Number(count);
						return String(text).repeat(n);
					},
					params: [
						{
							name: "text",
							type: { type: "string" },
							description: "The string to repeat",
						},
						{
							name: "count",
							type: { type: "number" },
							description: "Number of times to repeat (default: 2)",
							optional: true,
						},
					],
					returnType: { type: "string" },
				},
			],
		});

		const s: JSONSchema7 = {
			type: "object",
			properties: { word: { type: "string" } },
			required: ["word"],
		};

		const withCount = engine.analyzeAndExecute("{{ repeat word 3 }}", s, {
			word: "ab",
		});
		expect(withCount.value).toBe("ababab");

		const withoutCount = engine.analyzeAndExecute("{{ repeat word }}", s, {
			word: "ab",
		});
		expect(withoutCount.value).toBe("abab");
	});
});
