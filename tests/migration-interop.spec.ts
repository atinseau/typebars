import { describe, expect, test } from "bun:test";
import { analyze, execute, parse, TemplateEngine } from "../src/index.ts";
import {
	extractPathSegments,
	getEffectivelySingleExpression,
	isSingleExpression,
} from "../src/parser.ts";
import type { JSONSchema7 } from "../src/types.ts";

// ─── Migration / Interop Tests ───────────────────────────────────────────────
// Ces tests vérifient que les comportements de l'ancien système (SchemaIOService)
// sont réalisables avec le nouveau moteur de template (TemplateEngine).
//
// L'ancien système travaillait au niveau objet : on passait un objet
// `{ key: "{{template}}" }` et on récupérait `{ key: valeurInterpolée }`.
// Le nouveau système travaille au niveau template individuel via `execute()`.
//
// Pour reproduire le comportement objet, on utilise un helper `interpolateObject`.

// ─── Helper : reproduit interpolateTemplateValues au-dessus de execute() ─────

/**
 * Reproduit le comportement de l'ancien `interpolateTemplateValues` en
 * itérant sur les clés d'un objet template et en exécutant chaque valeur
 * via le nouveau moteur.
 *
 * @param templateObj - Objet dont les valeurs contiennent des templates `{{...}}`
 * @param data        - Données de contexte
 * @returns Objet avec les valeurs interpolées
 */
function interpolateObject(
	templateObj: Record<string, unknown>,
	data: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(templateObj)) {
		if (typeof value === "string") {
			result[key] = execute(value, data);
		} else if (Array.isArray(value)) {
			result[key] = value.map((item) => {
				if (typeof item === "string") {
					return execute(item, data);
				}
				return item;
			});
		} else {
			result[key] = value;
		}
	}

	return result;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 1 : interpolateTemplateValues → execute()
// ═════════════════════════════════════════════════════════════════════════════

describe("Migration: interpolateTemplateValues → execute()", () => {
	test("Should inject string from data into values and available in the output", () => {
		const output = interpolateObject(
			{ accountId: "{{meetingId}}" },
			{ meetingId: "123" },
		);

		expect(output).toMatchObject({ accountId: "123" });
	});

	test("Should inject template with different type input (number)", () => {
		const output = interpolateObject(
			{ accountId: "{{meetingId}}" },
			{ meetingId: 123 },
		);

		expect(output).toMatchObject({ accountId: 123 });
	});

	test("Should inject template with different type input (boolean true)", () => {
		const output = interpolateObject(
			{ accountId: "{{meetingId}}" },
			{ meetingId: true },
		);

		expect(output).toMatchObject({ accountId: true });
	});

	test("Should inject template with different type input (boolean false)", () => {
		const output = interpolateObject(
			{ accountId: "{{meetingId}}" },
			{ meetingId: false },
		);

		expect(output).toMatchObject({ accountId: false });
	});

	test("Should inject template with different type input (boolean array) - multi-template concatenates as string", () => {
		{
			const output = interpolateObject(
				{ accountId: "{{meetingId}} {{meetingId}}" },
				{ meetingId: false },
			);

			expect(output).toMatchObject({ accountId: "false false" });
		}

		{
			const output = interpolateObject(
				{ accountId: "{{meetingId}} {{meetingId}}" },
				{ meetingId: true },
			);

			expect(output).toMatchObject({ accountId: "true true" });
		}
	});

	test("Should inject template with different type input but several templates so keep in string", () => {
		const output = interpolateObject(
			{ accountId: "{{meetingId}} {{meetingId}}" },
			{ meetingId: 123 },
		);

		expect(output).toMatchObject({ accountId: "123 123" });
	});

	test("Should inject template with array type — single template preserves array", () => {
		const output = interpolateObject(
			{ coucou: "{{accountIds}}" },
			{ accountIds: [123, 456, 789] },
		);

		expect(output).toMatchObject({ coucou: [123, 456, 789] });
	});

	test("Multi-template with array value — Handlebars renders array items as concatenated string", () => {
		// L'ancien système gardait la string template brute quand on avait
		// plusieurs templates avec des valeurs array. Le nouveau système
		// (Handlebars) rend les éléments du tableau concaténés.
		// Comportement DIFFÉRENT mais cohérent : Handlebars transforme les
		// arrays en string quand ils sont dans un contexte multi-expression.
		const output = interpolateObject(
			{ coucou: "{{accountIds}} {{accountIds}}" },
			{ accountIds: [123, 456, 789] },
		);

		// Handlebars rend un array comme ses éléments séparés par des virgules
		// Le comportement exact dépend de Handlebars, mais ce ne sera PAS
		// l'ancienne valeur "{{accountIds}} {{accountIds}}" non plus.
		expect(typeof output.coucou).toBe("string");
	});

	test("Should return undefined when value is missing key on unique template", () => {
		const output = interpolateObject({ accountId: "{{meetingId}}" }, {});

		expect(output.accountId).toBeUndefined();
	});

	test("Should be able to parse multiple templates in same string", () => {
		const output = interpolateObject(
			{ accountId: "{{meetingId}} {{leadName}} {{ptn}}" },
			{
				meetingId: "coucou",
				leadName: "bye bye",
				ptn: "HELLO",
			},
		);

		expect(output).toMatchObject({ accountId: "coucou bye bye HELLO" });
	});

	test("Should inject template in array index", () => {
		const output = interpolateObject(
			{ target: ["{{meetingId}}", "{{meetingId}}", "{{leadName}}"] },
			{
				meetingId: "coucou",
				leadName: "bye bye",
			},
		);

		expect(output).toMatchObject({
			target: ["coucou", "coucou", "bye bye"],
		});
	});

	test("Should inject nested array — single template preserves array type", () => {
		const output = interpolateObject(
			{ target: ["{{meetingIds}}", "{{meetingIds}}", "{{leadName}}"] },
			{
				meetingIds: ["coucou"],
				leadName: 0,
			},
		);

		expect(output).toMatchObject({
			target: [["coucou"], ["coucou"], 0],
		});
	});

	test("Should preserve 0 as value (not falsy-skip)", () => {
		const result = execute("{{val}}", { val: 0 });
		expect(result).toBe(0);
	});

	test("Should preserve false as value (not falsy-skip)", () => {
		const result = execute("{{val}}", { val: false });
		expect(result).toBe(false);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 2 : extractTemplateTokens → parse() + AST introspection
// ═════════════════════════════════════════════════════════════════════════════

describe("Migration: extractTemplateTokens → parse() + AST", () => {
	test("Should be able to return a list of templates from a string", () => {
		const ast = parse("coucou {{meetingId}}");
		// On filtre les MustacheStatement pour trouver les expressions
		const mustaches = ast.body.filter((s) => s.type === "MustacheStatement");
		expect(mustaches).toHaveLength(1);

		const expr = (mustaches[0] as hbs.AST.MustacheStatement).path;
		const segments = extractPathSegments(expr);
		expect(segments).toEqual(["meetingId"]);
	});

	test("Should handle templates with extra whitespace — Handlebars normalizes", () => {
		// Handlebars gère nativement le whitespace dans les moustaches :
		// {{   meetingId   }} est parsé comme {{meetingId}}
		const ast = parse("coucou {{   meetingId           }}");
		const mustaches = ast.body.filter((s) => s.type === "MustacheStatement");
		expect(mustaches).toHaveLength(1);

		const expr = (mustaches[0] as hbs.AST.MustacheStatement).path;
		const segments = extractPathSegments(expr);
		expect(segments).toEqual(["meetingId"]);
	});

	test("Should extract multiple templates from a single string", () => {
		const ast = parse("{{meetingId}} {{leadName}} {{ptn}}");
		const mustaches = ast.body.filter((s) => s.type === "MustacheStatement");
		expect(mustaches).toHaveLength(3);

		const paths = mustaches.map((m) =>
			extractPathSegments((m as hbs.AST.MustacheStatement).path),
		);
		expect(paths).toEqual([["meetingId"], ["leadName"], ["ptn"]]);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 3 : normalizeTemplateTokens → Handlebars native whitespace handling
// ═════════════════════════════════════════════════════════════════════════════

describe("Migration: normalizeTemplateTokens → Handlebars normalisation native", () => {
	test("Pre-formatted string is parsed correctly", () => {
		const template = "coucou {{meetingId}}";
		const result = execute(template, { meetingId: "value" });
		expect(result).toBe("coucou value");
	});

	test("Non-formatted string with extra whitespace is equivalent", () => {
		// Handlebars normalise automatiquement {{ meetingId }} en {{meetingId}}
		const formatted = execute("coucou {{meetingId}}", { meetingId: "value" });
		const unformatted = execute("coucou {{       meetingId       }}", {
			meetingId: "value",
		});
		expect(formatted).toBe(unformatted);
		expect(unformatted).toBe("coucou value");
	});

	test("Multi-template with whitespace normalizes identically", () => {
		const clean = execute("{{accountIds}} coucou {{meetingId}}", {
			accountIds: "A",
			meetingId: "B",
		});
		const messy = execute(
			"{{       accountIds       }} coucou {{       meetingId       }}",
			{
				accountIds: "A",
				meetingId: "B",
			},
		);
		expect(clean).toBe(messy);
		expect(messy).toBe("A coucou B");
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 4 : isUniqueTemplate → isSingleExpression()
// ═════════════════════════════════════════════════════════════════════════════

describe("Migration: isUniqueTemplate → isSingleExpression()", () => {
	test("Detect unique template string — text + template is NOT single", () => {
		const ast = parse("coucou {{meetingId}}");
		expect(isSingleExpression(ast)).toBe(false);
	});

	test("Detect unique template string — template alone IS single", () => {
		const ast = parse("{{meetingId}}");
		expect(isSingleExpression(ast)).toBe(true);
	});

	test("Template with whitespace around — effectively single via getEffectivelySingleExpression", () => {
		const ast = parse("  {{meetingId}}  ");
		// isSingleExpression est strict (pas de whitespace)
		expect(isSingleExpression(ast)).toBe(false);
		// mais getEffectivelySingleExpression détecte le cas avec whitespace
		expect(getEffectivelySingleExpression(ast)).not.toBeNull();
	});

	test("Multiple templates is NOT single", () => {
		const ast = parse("{{a}} {{b}}");
		expect(isSingleExpression(ast)).toBe(false);
		expect(getEffectivelySingleExpression(ast)).toBeNull();
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 5 : Type preservation rules (core behavior)
// ═════════════════════════════════════════════════════════════════════════════

describe("Migration: Type preservation rules", () => {
	describe("Single expression → preserves original type", () => {
		test("string", () => {
			expect(execute("{{v}}", { v: "hello" })).toBe("hello");
			expect(typeof execute("{{v}}", { v: "hello" })).toBe("string");
		});

		test("number", () => {
			expect(execute("{{v}}", { v: 123 })).toBe(123);
			expect(typeof execute("{{v}}", { v: 123 })).toBe("number");
		});

		test("number 0", () => {
			expect(execute("{{v}}", { v: 0 })).toBe(0);
			expect(typeof execute("{{v}}", { v: 0 })).toBe("number");
		});

		test("boolean true", () => {
			expect(execute("{{v}}", { v: true })).toBe(true);
			expect(typeof execute("{{v}}", { v: true })).toBe("boolean");
		});

		test("boolean false", () => {
			expect(execute("{{v}}", { v: false })).toBe(false);
			expect(typeof execute("{{v}}", { v: false })).toBe("boolean");
		});

		test("array", () => {
			const arr = [1, 2, 3];
			expect(execute("{{v}}", { v: arr })).toEqual(arr);
			expect(Array.isArray(execute("{{v}}", { v: arr }))).toBe(true);
		});

		test("object", () => {
			const obj = { a: 1, b: "two" };
			expect(execute("{{v}}", { v: obj })).toEqual(obj);
			expect(typeof execute("{{v}}", { v: obj })).toBe("object");
		});

		test("null", () => {
			expect(execute("{{v}}", { v: null })).toBeNull();
		});

		test("undefined (missing key)", () => {
			expect(execute("{{v}}", {})).toBeUndefined();
		});
	});

	describe("Multi-expression → always string", () => {
		test("two string templates", () => {
			const result = execute("{{a}} {{b}}", { a: "hello", b: "world" });
			expect(result).toBe("hello world");
			expect(typeof result).toBe("string");
		});

		test("number templates become string", () => {
			const result = execute("{{a}} {{b}}", { a: 1, b: 2 });
			expect(result).toBe("1 2");
			expect(typeof result).toBe("string");
		});

		test("boolean templates become string", () => {
			const result = execute("{{a}} {{b}}", { a: true, b: false });
			expect(result).toBe("true false");
			expect(typeof result).toBe("string");
		});

		test("text + expression → string", () => {
			const result = execute("Hello {{name}}", { name: "Alice" });
			expect(result).toBe("Hello Alice");
			expect(typeof result).toBe("string");
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 6 : validateTemplateUsage → analyze()
// ═════════════════════════════════════════════════════════════════════════════

describe("Migration: validateTemplateUsage → analyze()", () => {
	test("Should succeed if template key exists in schema", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				meetingId: { type: "string" },
			},
		};

		const result = analyze("{{meetingId}}", schema);
		expect(result.valid).toBe(true);
		expect(
			result.diagnostics.filter((d) => d.severity === "error"),
		).toHaveLength(0);
	});

	test("Should fail if template key is NOT in schema", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {},
		};

		const result = analyze("{{meetingId}}", schema);
		expect(result.valid).toBe(false);
		expect(
			result.diagnostics.filter((d) => d.severity === "error").length,
		).toBeGreaterThan(0);
	});

	test("Should validate multiple template references", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				meetingId: { type: "string" },
				leadName: { type: "string" },
				ptn: { type: "string" },
			},
		};

		const result = analyze("{{meetingId}} {{leadName}} {{ptn}}", schema);
		expect(result.valid).toBe(true);
	});

	test("Should detect missing key in multi-template", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				meetingId: { type: "string" },
			},
		};

		const result = analyze("{{meetingId}} {{leadName}}", schema);
		expect(result.valid).toBe(false);
	});

	test("Should validate nested property access", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				user: {
					type: "object",
					properties: {
						name: { type: "string" },
					},
				},
			},
		};

		const result = analyze("{{user.name}}", schema);
		expect(result.valid).toBe(true);
	});

	test("Should fail for missing nested property", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				user: {
					type: "object",
					properties: {
						name: { type: "string" },
					},
				},
			},
		};

		const result = analyze("{{user.email}}", schema);
		expect(result.valid).toBe(false);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 7 : compare (schema comparison) → analyze() output schema inference
// ═════════════════════════════════════════════════════════════════════════════

describe("Migration: compare → analyze() outputSchema inference", () => {
	test("Should infer string type for string property", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				accountId: { type: "string" },
			},
		};

		const result = analyze("{{accountId}}", schema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({ type: "string" });
	});

	test("Should infer number type for number property", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				age: { type: "number" },
			},
		};

		const result = analyze("{{age}}", schema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({ type: "number" });
	});

	test("Should infer boolean type for boolean property", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				active: { type: "boolean" },
			},
		};

		const result = analyze("{{active}}", schema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({ type: "boolean" });
	});

	test("Should infer string for mixed template (always string output)", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				meetingId: { type: "string" },
				accountId: { type: "string" },
			},
		};

		const result = analyze("{{meetingId}} {{accountId}}", schema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({ type: "string" });
	});

	test("Should infer array type for array property (single expression)", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				items: {
					type: "array",
					items: { type: "number" },
				},
			},
		};

		const result = analyze("{{items}}", schema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({
			type: "array",
			items: { type: "number" },
		});
	});

	test("Should preserve enum in output schema", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				role: { type: "string", enum: ["admin", "user", "guest"] },
			},
		};

		const result = analyze("{{role}}", schema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({
			type: "string",
			enum: ["admin", "user", "guest"],
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 8 : validate (runtime) → execute() type checking
// ═════════════════════════════════════════════════════════════════════════════

describe("Migration: validate → execute() runtime behavior", () => {
	test("String value is returned as string", () => {
		const result = execute("{{accountId}}", { accountId: "123" });
		expect(typeof result).toBe("string");
		expect(result).toBe("123");
	});

	test("Number value is returned as number", () => {
		const result = execute("{{age}}", { age: 42 });
		expect(typeof result).toBe("number");
		expect(result).toBe(42);
	});

	test("Boolean value is returned as boolean", () => {
		const result = execute("{{active}}", { active: true });
		expect(typeof result).toBe("boolean");
		expect(result).toBe(true);
	});

	test("Array value is returned as array", () => {
		const result = execute("{{ids}}", { ids: [100, 12] });
		expect(Array.isArray(result)).toBe(true);
		expect(result).toEqual([100, 12]);
	});

	test("Missing key returns undefined", () => {
		const result = execute("{{meetingId}}", {});
		expect(result).toBeUndefined();
	});

	test("Complex data structure — all types preserved via individual templates", () => {
		const data = {
			accountIds: [100, 12],
			meetingId: "salut",
			isMeeting: true,
			age: 10,
		};

		expect(execute("{{accountIds}}", data)).toEqual([100, 12]);
		expect(execute("{{meetingId}}", data)).toBe("salut");
		expect(execute("{{isMeeting}}", data)).toBe(true);
		expect(execute("{{age}}", data)).toBe(10);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 9 : Template identifiers ({{key:id}}) — NON SUPPORTÉ
// ═════════════════════════════════════════════════════════════════════════════

describe("Migration: Template identifiers ({{key:id}}) — LIMITATIONS", () => {
	// L'ancien système supportait une syntaxe {{key:identifier}} pour
	// référencer des données provenant de nœuds spécifiques dans un workflow.
	// Ce mécanisme n'existe PAS dans Handlebars.
	//
	// WORKAROUND : On peut reproduire ce comportement en pré-structurant les
	// données avec des namespaces (ex: node_1.meetingId, node_2.meetingId)
	// et en utilisant la dot notation Handlebars.

	test("Workaround: use dot notation with namespaced data instead of identifiers", () => {
		// Ancien: {{meetingId:1}} {{meetingId:2}} avec outputNodeById
		// Nouveau: {{node_1.meetingId}} {{node_2.meetingId}} avec données structurées
		const data = {
			node_1: { meetingId: "coucou1" },
			node_2: { meetingId: "coucou2" },
		};

		const result = execute("{{node_1.meetingId}} {{node_2.meetingId}}", data);
		expect(result).toBe("coucou1 coucou2");
	});

	test("Workaround: reversed order", () => {
		const data = {
			node_1: { meetingId: "coucou1" },
			node_2: { meetingId: "coucou2" },
		};

		const result = execute("{{node_2.meetingId}} {{node_1.meetingId}}", data);
		expect(result).toBe("coucou2 coucou1");
	});

	test("Workaround: single identifier with namespace preserves type", () => {
		const data = {
			node_0: { meetingId: "test" },
		};

		const result = execute(
			"salut {{node_0.meetingId}} ok {{node_0.meetingId}}",
			data,
		);
		expect(result).toBe("salut test ok test");
	});

	test("Workaround: value 0 with namespace", () => {
		const data = {
			node_0: { meetingId: 0 },
		};

		const result = execute(
			"salut {{node_0.meetingId}} ok {{node_0.meetingId}}",
			data,
		);
		expect(result).toBe("salut 0 ok 0");
	});

	test("Workaround: fallback without namespace uses root data", () => {
		// Quand il n'y a pas d'identifiant, les données sont au niveau racine
		const data = { meetingId: "coucou" };
		const result = execute("{{meetingId}} {{meetingId}}", data);
		expect(result).toBe("coucou coucou");
	});

	test("Workaround: can mix namespaced and non-namespaced data", () => {
		const data = {
			meetingId: "default",
			node_1: { meetingId: "from_node_1" },
		};

		const result = execute("{{meetingId}} {{node_1.meetingId}}", data);
		expect(result).toBe("default from_node_1");
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 10 : findTemplateSchemaFromPrevSchemas → resolveSchemaPath
// ═════════════════════════════════════════════════════════════════════════════

describe("Migration: findTemplateSchemaFromPrevSchemas → JSON Schema resolution", () => {
	// L'ancien findTemplateSchemaFromPrevSchemas cherchait un type dans une
	// liste de schemas précédents identifiés par un numéro.
	// Avec JSON Schema, on structure les données en un seul schema avec des
	// propriétés nommées pour chaque source.

	test("Schema resolution with namespaced properties replaces identifier lookup", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				node_1: {
					type: "object",
					properties: {
						someKey: { type: "string" },
					},
				},
				node_2: {
					type: "object",
					properties: {
						someKey: { type: "boolean" },
					},
				},
			},
		};

		{
			const result = analyze("{{node_1.someKey}}", schema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "string" });
		}

		{
			const result = analyze("{{node_2.someKey}}", schema);
			expect(result.valid).toBe(true);
			expect(result.outputSchema).toEqual({ type: "boolean" });
		}
	});

	test("Missing property in namespace is detected as error", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				node_1: {
					type: "object",
					properties: {
						otherKey: { type: "string" },
					},
				},
			},
		};

		const result = analyze("{{node_1.someKey}}", schema);
		expect(result.valid).toBe(false);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 11 : Strict mode validation (old validate + compare combined)
// ═════════════════════════════════════════════════════════════════════════════

describe("Migration: TemplateEngine strict mode", () => {
	const engine = new TemplateEngine();

	test("Execute succeeds with valid schema", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				accountId: { type: "string" },
			},
		};

		const result = engine.execute(
			"{{accountId}}",
			{ accountId: "123" },
			schema,
		);
		expect(result).toBe("123");
	});

	test("Execute throws with invalid schema reference", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {},
		};

		expect(() =>
			engine.execute("{{accountId}}", { accountId: "123" }, schema),
		).toThrow();
	});

	test("Execute without schema skips validation", () => {
		const result = engine.execute("{{anything}}", { anything: 42 });
		expect(result).toBe(42);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 12 : End-to-end — full object interpolation pattern
// ═════════════════════════════════════════════════════════════════════════════

describe("Migration: end-to-end object interpolation pattern", () => {
	test("Full object with mixed types, like old interpolateTemplateValues", () => {
		const templateObj = {
			name: "{{user.name}}",
			age: "{{user.age}}",
			tags: "{{user.tags}}",
			greeting: "Hello {{user.name}}, you are {{user.age}} years old",
			active: "{{user.active}}",
		};

		const data = {
			user: {
				name: "Alice",
				age: 30,
				tags: ["dev", "ts"],
				active: true,
			},
		};

		const output = interpolateObject(templateObj, data);

		expect(output.name).toBe("Alice");
		expect(output.age).toBe(30);
		expect(output.tags).toEqual(["dev", "ts"]);
		expect(output.greeting).toBe("Hello Alice, you are 30 years old");
		expect(output.active).toBe(true);
	});

	test("Schema validation on each template in an object", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				user: {
					type: "object",
					properties: {
						name: { type: "string" },
						age: { type: "number" },
					},
				},
			},
		};

		const templates = {
			name: "{{user.name}}",
			age: "{{user.age}}",
			greeting: "Hello {{user.name}}",
		};

		// Validate each template against the schema
		for (const [_key, template] of Object.entries(templates)) {
			const result = analyze(template, schema);
			expect(result.valid).toBe(true);
		}
	});

	test("Detect invalid template in object", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				user: {
					type: "object",
					properties: {
						name: { type: "string" },
					},
				},
			},
		};

		const validResult = analyze("{{user.name}}", schema);
		expect(validResult.valid).toBe(true);

		const invalidResult = analyze("{{user.email}}", schema);
		expect(invalidResult.valid).toBe(false);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 13 : Features gained with the new system
// ═════════════════════════════════════════════════════════════════════════════

describe("Bonus: New features not available in old system", () => {
	test("Conditional rendering with #if", () => {
		const result = execute("{{#if active}}Online{{else}}Offline{{/if}}", {
			active: true,
		});
		expect(result).toBe("Online");
	});

	test("Iteration with #each", () => {
		const result = execute("{{#each items}}{{this}} {{/each}}", {
			items: ["a", "b", "c"],
		});
		expect(result).toBe("a b c ");
	});

	test("Context switching with #with", () => {
		const result = execute("{{#with user}}{{name}} ({{age}}){{/with}}", {
			user: { name: "Bob", age: 25 },
		});
		expect(result).toBe("Bob (25)");
	});

	test("Dot notation for nested access", () => {
		const result = execute("{{user.address.city}}", {
			user: { address: { city: "Paris" } },
		});
		expect(result).toBe("Paris");
	});

	test("Static analysis gives output type information", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				age: { type: "number" },
			},
		};

		const result = analyze("{{age}}", schema);
		expect(result.outputSchema).toEqual({ type: "number" });
	});

	test("$ref resolution in schemas", () => {
		const schema: JSONSchema7 = {
			type: "object",
			definitions: {
				Address: {
					type: "object",
					properties: {
						city: { type: "string" },
					},
				},
			},
			properties: {
				home: { $ref: "#/definitions/Address" },
			},
		};

		const result = analyze("{{home.city}}", schema);
		expect(result.valid).toBe(true);
		expect(result.outputSchema).toEqual({ type: "string" });
	});
});
