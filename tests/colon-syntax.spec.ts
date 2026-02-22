import { describe, expect, test } from "bun:test";
import Handlebars from "handlebars";
import { execute } from "../src/index.ts";
import {
	extractPathSegments,
	isSingleExpression,
	parse,
} from "../src/parser.ts";

// ─── Colon Syntax Tests ──────────────────────────────────────────────────────
// Vérifie que Handlebars accepte nativement la syntaxe {{key:identifier}}
// utilisée par l'ancien système de template identifiers.
//
// Dans Handlebars, `meetingId:1` est traité comme un identifiant valide
// (un seul segment de chemin). Pas de pré-processing nécessaire.

describe("Handlebars colon syntax — parsing", () => {
	test("parses {{key:number}} as a valid MustacheStatement", () => {
		const ast = parse("{{meetingId:1}}");
		expect(ast.body).toHaveLength(1);
		expect(ast.body[0]?.type).toBe("MustacheStatement");
	});

	test("path parts contain the full key:number as a single segment", () => {
		const ast = parse("{{meetingId:1}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		const segments = extractPathSegments(stmt.path);
		expect(segments).toEqual(["meetingId:1"]);
	});

	test("path.original preserves the colon syntax", () => {
		const ast = parse("{{meetingId:1}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		const path = stmt.path as hbs.AST.PathExpression;
		expect(path.original).toBe("meetingId:1");
	});

	test("parses multiple colon expressions in the same template", () => {
		const ast = parse("{{meetingId:1}} {{leadName:2}}");
		const mustaches = ast.body.filter((s) => s.type === "MustacheStatement");
		expect(mustaches).toHaveLength(2);

		const paths = mustaches.map((m) => {
			const path = (m as hbs.AST.MustacheStatement)
				.path as hbs.AST.PathExpression;
			return path.original;
		});
		expect(paths).toEqual(["meetingId:1", "leadName:2"]);
	});

	test("parses same key with different identifiers", () => {
		const ast = parse("{{meetingId:1}} {{meetingId:2}}");
		const mustaches = ast.body.filter((s) => s.type === "MustacheStatement");
		expect(mustaches).toHaveLength(2);

		const segments = mustaches.map((m) =>
			extractPathSegments((m as hbs.AST.MustacheStatement).path),
		);
		expect(segments).toEqual([["meetingId:1"], ["meetingId:2"]]);
	});

	test("parses mix of expressions with and without identifiers", () => {
		const ast = parse("{{name}} {{meetingId:1}}");
		const mustaches = ast.body.filter((s) => s.type === "MustacheStatement");
		expect(mustaches).toHaveLength(2);

		const originals = mustaches.map(
			(m) =>
				((m as hbs.AST.MustacheStatement).path as hbs.AST.PathExpression)
					.original,
		);
		expect(originals).toEqual(["name", "meetingId:1"]);
	});

	test("parses identifier 0 correctly", () => {
		const ast = parse("{{meetingId:0}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		const path = stmt.path as hbs.AST.PathExpression;
		expect(path.original).toBe("meetingId:0");
		expect(extractPathSegments(stmt.path)).toEqual(["meetingId:0"]);
	});

	test("parses large identifier numbers", () => {
		const ast = parse("{{meetingId:999}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		const path = stmt.path as hbs.AST.PathExpression;
		expect(path.original).toBe("meetingId:999");
	});

	test("isSingleExpression works with colon syntax", () => {
		expect(isSingleExpression(parse("{{meetingId:1}}"))).toBe(true);
		expect(isSingleExpression(parse("hello {{meetingId:1}}"))).toBe(false);
		expect(isSingleExpression(parse("{{meetingId:1}} {{meetingId:2}}"))).toBe(
			false,
		);
	});

	test("dot notation with colon — identifier is on the last segment", () => {
		const ast = parse("{{user.name:1}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		const segments = extractPathSegments(stmt.path);
		// Handlebars splits on dots: ["user", "name:1"]
		expect(segments).toEqual(["user", "name:1"]);
	});

	test("parses colon syntax with whitespace inside moustaches", () => {
		const ast = parse("{{ meetingId:1 }}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		const path = stmt.path as hbs.AST.PathExpression;
		expect(path.original).toBe("meetingId:1");
	});

	test("parses colon syntax in text context", () => {
		const ast = parse("salut {{meetingId:0}} ok {{meetingId:0}}");
		const mustaches = ast.body.filter((s) => s.type === "MustacheStatement");
		expect(mustaches).toHaveLength(2);

		for (const m of mustaches) {
			const path = (m as hbs.AST.MustacheStatement)
				.path as hbs.AST.PathExpression;
			expect(path.original).toBe("meetingId:0");
		}
	});
});

describe("Handlebars colon syntax — execution (raw Handlebars.compile)", () => {
	// Ces tests vérifient que Handlebars.compile exécute correctement les
	// templates avec la syntaxe colon, en utilisant des clés "key:N" dans
	// l'objet de données.

	test("renders a single colon-keyed value", () => {
		const compiled = Handlebars.compile("{{meetingId:1}}", { noEscape: true });
		const result = compiled({ "meetingId:1": "hello" });
		expect(result).toBe("hello");
	});

	test("renders multiple colon-keyed values", () => {
		const compiled = Handlebars.compile("{{meetingId:1}} {{leadName:2}}", {
			noEscape: true,
		});
		const result = compiled({ "meetingId:1": "val1", "leadName:2": "val2" });
		expect(result).toBe("val1 val2");
	});

	test("renders same key with different identifiers", () => {
		const compiled = Handlebars.compile("{{meetingId:1}} {{meetingId:2}}", {
			noEscape: true,
		});
		const result = compiled({
			"meetingId:1": "first",
			"meetingId:2": "second",
		});
		expect(result).toBe("first second");
	});

	test("renders mix of keyed and non-keyed values", () => {
		const compiled = Handlebars.compile("{{name}} {{meetingId:1}}", {
			noEscape: true,
		});
		const result = compiled({ name: "Alice", "meetingId:1": "test" });
		expect(result).toBe("Alice test");
	});

	test("renders identifier 0", () => {
		const compiled = Handlebars.compile(
			"salut {{meetingId:0}} ok {{meetingId:0}}",
			{ noEscape: true },
		);
		const result = compiled({ "meetingId:0": "test" });
		expect(result).toBe("salut test ok test");
	});

	test("renders empty string for missing colon key", () => {
		const compiled = Handlebars.compile("{{meetingId:1}}", {
			noEscape: true,
			strict: false,
		});
		const result = compiled({});
		expect(result).toBe("");
	});

	test("renders number value as string (Handlebars default behavior)", () => {
		const compiled = Handlebars.compile("value: {{meetingId:1}}", {
			noEscape: true,
		});
		const result = compiled({ "meetingId:1": 42 });
		expect(result).toBe("value: 42");
	});

	test("renders 0 as string (not falsy-skipped)", () => {
		const compiled = Handlebars.compile("{{meetingId:0}}", { noEscape: true });
		const result = compiled({ "meetingId:0": 0 });
		expect(result).toBe("0");
	});

	test("renders boolean as string", () => {
		const compiled = Handlebars.compile("{{active:1}}", { noEscape: true });
		expect(compiled({ "active:1": true })).toBe("true");
		expect(compiled({ "active:1": false })).toBe("false");
	});
});

describe("Handlebars colon syntax — execute() type preservation", () => {
	// Ces tests vérifient que notre fonction execute() (qui préserve les types
	// pour les expressions uniques) fonctionne avec la syntaxe colon.
	//
	// execute() utilise maintenant le paramètre `identifierData` pour résoudre
	// les expressions `{{key:N}}` depuis la source de données identifiée par N.

	test("single expression with colon — preserves string type", () => {
		const result = execute(
			"{{meetingId:1}}",
			{},
			{ 1: { meetingId: "hello" } },
		);
		expect(result).toBe("hello");
		expect(typeof result).toBe("string");
	});

	test("single expression with colon — preserves number type", () => {
		const result = execute("{{meetingId:1}}", {}, { 1: { meetingId: 123 } });
		expect(result).toBe(123);
		expect(typeof result).toBe("number");
	});

	test("single expression with colon — preserves boolean type", () => {
		expect(execute("{{active:1}}", {}, { 1: { active: true } })).toBe(true);
		expect(execute("{{active:1}}", {}, { 1: { active: false } })).toBe(false);
	});

	test("single expression with colon — preserves array type", () => {
		const arr = [1, 2, 3];
		const result = execute("{{ids:1}}", {}, { 1: { ids: arr } });
		expect(result).toEqual(arr);
		expect(Array.isArray(result)).toBe(true);
	});

	test("single expression with colon — preserves object type", () => {
		const obj = { a: 1, b: "two" };
		const result = execute("{{data:1}}", {}, { 1: { data: obj } });
		expect(result).toEqual(obj);
	});

	test("single expression with colon — undefined for missing key", () => {
		const result = execute("{{meetingId:1}}", {});
		expect(result).toBeUndefined();
	});

	test("single expression with colon — undefined when identifier source missing", () => {
		const result = execute(
			"{{meetingId:1}}",
			{},
			{ 2: { meetingId: "wrong" } },
		);
		expect(result).toBeUndefined();
	});

	test("single expression with colon — preserves null", () => {
		const result = execute("{{val:1}}", {}, { 1: { val: null } });
		expect(result).toBeNull();
	});

	test("single expression with colon — preserves 0", () => {
		const result = execute("{{val:0}}", {}, { 0: { val: 0 } });
		expect(result).toBe(0);
	});

	test("multi expression with colon — always string", () => {
		const result = execute(
			"{{meetingId:1}} {{meetingId:2}}",
			{},
			{
				1: { meetingId: "first" },
				2: { meetingId: "second" },
			},
		);
		expect(result).toBe("first second");
		expect(typeof result).toBe("string");
	});

	test("mixed keyed and non-keyed — string concatenation", () => {
		const result = execute(
			"{{name}} {{meetingId:1}}",
			{ name: "Alice" },
			{ 1: { meetingId: "test" } },
		);
		expect(result).toBe("Alice test");
	});

	test("text + colon expression — string concatenation", () => {
		const result = execute(
			"salut {{meetingId:0}} ok {{meetingId:0}}",
			{},
			{ 0: { meetingId: "test" } },
		);
		expect(result).toBe("salut test ok test");
	});

	test("text + colon expression with 0 value", () => {
		const result = execute(
			"salut {{meetingId:0}} ok {{meetingId:0}}",
			{},
			{ 0: { meetingId: 0 } },
		);
		expect(result).toBe("salut 0 ok 0");
	});
});

describe("Colon syntax — identifier extraction from path segments", () => {
	// Helper pour extraire key et identifier d'un segment de chemin.
	// Ceci simule la logique que le moteur devra implémenter pour
	// résoudre les template identifiers.

	function parseIdentifier(segment: string): {
		key: string;
		identifier: number | null;
	} {
		const match = segment.match(/^(.+):(\d+)$/);
		if (match) {
			return { key: match[1]!, identifier: parseInt(match[2]!, 10) };
		}
		return { key: segment, identifier: null };
	}

	test("extracts key and identifier from 'meetingId:1'", () => {
		const { key, identifier } = parseIdentifier("meetingId:1");
		expect(key).toBe("meetingId");
		expect(identifier).toBe(1);
	});

	test("extracts key and identifier from 'meetingId:0'", () => {
		const { key, identifier } = parseIdentifier("meetingId:0");
		expect(key).toBe("meetingId");
		expect(identifier).toBe(0);
	});

	test("extracts key and identifier from 'meetingId:999'", () => {
		const { key, identifier } = parseIdentifier("meetingId:999");
		expect(key).toBe("meetingId");
		expect(identifier).toBe(999);
	});

	test("returns null identifier for plain key 'meetingId'", () => {
		const { key, identifier } = parseIdentifier("meetingId");
		expect(key).toBe("meetingId");
		expect(identifier).toBeNull();
	});

	test("works on path segments from Handlebars AST", () => {
		const ast = parse("{{meetingId:1}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		const segments = extractPathSegments(stmt.path);

		const parsed = segments.map(parseIdentifier);
		expect(parsed).toEqual([{ key: "meetingId", identifier: 1 }]);
	});

	test("works on multi-segment path with identifier on last segment", () => {
		const ast = parse("{{user.name:1}}");
		const stmt = ast.body[0] as hbs.AST.MustacheStatement;
		const segments = extractPathSegments(stmt.path);

		const parsed = segments.map(parseIdentifier);
		expect(parsed).toEqual([
			{ key: "user", identifier: null },
			{ key: "name", identifier: 1 },
		]);
	});

	test("mixed template — some with identifier, some without", () => {
		const ast = parse("{{name}} {{meetingId:1}} {{leadName:2}}");
		const mustaches = ast.body.filter((s) => s.type === "MustacheStatement");

		const results = mustaches.map((m) => {
			const segments = extractPathSegments(
				(m as hbs.AST.MustacheStatement).path,
			);
			return segments.map(parseIdentifier);
		});

		expect(results).toEqual([
			[{ key: "name", identifier: null }],
			[{ key: "meetingId", identifier: 1 }],
			[{ key: "leadName", identifier: 2 }],
		]);
	});
});
