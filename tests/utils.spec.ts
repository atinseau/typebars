import { describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import {
	deepEqual,
	extractSourceSnippet,
	getSchemaPropertyNames,
	LRUCache,
} from "../src/utils.ts";

// ─── deepEqual() ─────────────────────────────────────────────────────────────

describe("deepEqual", () => {
	describe("primitives", () => {
		test("equal numbers → true", () => {
			expect(deepEqual(1, 1)).toBe(true);
		});

		test("different numbers → false", () => {
			expect(deepEqual(1, 2)).toBe(false);
		});

		test("equal strings → true", () => {
			expect(deepEqual("abc", "abc")).toBe(true);
		});

		test("different strings → false", () => {
			expect(deepEqual("abc", "def")).toBe(false);
		});

		test("equal booleans → true", () => {
			expect(deepEqual(true, true)).toBe(true);
			expect(deepEqual(false, false)).toBe(true);
		});

		test("different booleans → false", () => {
			expect(deepEqual(true, false)).toBe(false);
		});

		test("null === null → true", () => {
			expect(deepEqual(null, null)).toBe(true);
		});

		test("undefined === undefined → true", () => {
			expect(deepEqual(undefined, undefined)).toBe(true);
		});

		test("null !== undefined", () => {
			expect(deepEqual(null, undefined)).toBe(false);
		});

		test("0 !== false", () => {
			expect(deepEqual(0, false)).toBe(false);
		});

		test("'' !== false", () => {
			expect(deepEqual("", false)).toBe(false);
		});

		test("0 !== null", () => {
			expect(deepEqual(0, null)).toBe(false);
		});

		test("NaN !== NaN (intentional — strict identity)", () => {
			expect(deepEqual(NaN, NaN)).toBe(false);
		});
	});

	describe("arrays", () => {
		test("equal arrays → true", () => {
			expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
		});

		test("different length → false", () => {
			expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
		});

		test("different values → false", () => {
			expect(deepEqual([1, 2, 3], [1, 2, 4])).toBe(false);
		});

		test("empty arrays → true", () => {
			expect(deepEqual([], [])).toBe(true);
		});

		test("nested arrays → true", () => {
			expect(deepEqual([[1, 2], [3]], [[1, 2], [3]])).toBe(true);
		});

		test("nested arrays with different values → false", () => {
			expect(deepEqual([[1, 2], [3]], [[1, 2], [4]])).toBe(false);
		});

		test("array !== non-array", () => {
			expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
		});

		test("array !== null", () => {
			expect(deepEqual([1], null)).toBe(false);
		});
	});

	describe("objects", () => {
		test("equal objects → true", () => {
			expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
		});

		test("key order independent → true", () => {
			expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
		});

		test("different values → false", () => {
			expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
		});

		test("different keys → false", () => {
			expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
		});

		test("extra key → false", () => {
			expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
		});

		test("empty objects → true", () => {
			expect(deepEqual({}, {})).toBe(true);
		});

		test("nested objects → true", () => {
			expect(deepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } })).toBe(
				true,
			);
		});

		test("nested objects with different values → false", () => {
			expect(deepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } })).toBe(
				false,
			);
		});

		test("object !== null", () => {
			expect(deepEqual({ a: 1 }, null)).toBe(false);
		});

		test("object !== array", () => {
			expect(deepEqual({ length: 0 }, [])).toBe(false);
		});
	});

	describe("mixed types", () => {
		test("string !== number", () => {
			expect(deepEqual("1", 1)).toBe(false);
		});

		test("object !== string", () => {
			expect(deepEqual({}, "")).toBe(false);
		});

		test("same reference → true", () => {
			const obj = { a: 1, b: [2, 3] };
			expect(deepEqual(obj, obj)).toBe(true);
		});
	});

	describe("complex structures (JSON Schema-like)", () => {
		test("identical schemas → true", () => {
			const a: JSONSchema7 = {
				type: "object",
				properties: {
					name: { type: "string" },
					age: { type: "number" },
				},
				required: ["name"],
			};
			const b: JSONSchema7 = {
				type: "object",
				properties: {
					name: { type: "string" },
					age: { type: "number" },
				},
				required: ["name"],
			};
			expect(deepEqual(a, b)).toBe(true);
		});

		test("schemas with different property types → false", () => {
			const a: JSONSchema7 = {
				type: "object",
				properties: { name: { type: "string" } },
			};
			const b: JSONSchema7 = {
				type: "object",
				properties: { name: { type: "number" } },
			};
			expect(deepEqual(a, b)).toBe(false);
		});
	});
});

// ─── LRUCache ────────────────────────────────────────────────────────────────

describe("LRUCache", () => {
	describe("basic operations", () => {
		test("set and get a value", () => {
			const cache = new LRUCache<string, number>(3);
			cache.set("a", 1);
			expect(cache.get("a")).toBe(1);
		});

		test("get returns undefined for missing key", () => {
			const cache = new LRUCache<string, number>(3);
			expect(cache.get("missing")).toBeUndefined();
		});

		test("has returns true for existing key", () => {
			const cache = new LRUCache<string, number>(3);
			cache.set("a", 1);
			expect(cache.has("a")).toBe(true);
		});

		test("has returns false for missing key", () => {
			const cache = new LRUCache<string, number>(3);
			expect(cache.has("missing")).toBe(false);
		});

		test("size reflects the number of entries", () => {
			const cache = new LRUCache<string, number>(5);
			expect(cache.size).toBe(0);
			cache.set("a", 1);
			expect(cache.size).toBe(1);
			cache.set("b", 2);
			expect(cache.size).toBe(2);
		});

		test("delete removes an entry", () => {
			const cache = new LRUCache<string, number>(3);
			cache.set("a", 1);
			expect(cache.delete("a")).toBe(true);
			expect(cache.get("a")).toBeUndefined();
			expect(cache.size).toBe(0);
		});

		test("delete returns false for missing key", () => {
			const cache = new LRUCache<string, number>(3);
			expect(cache.delete("missing")).toBe(false);
		});

		test("clear removes all entries", () => {
			const cache = new LRUCache<string, number>(3);
			cache.set("a", 1);
			cache.set("b", 2);
			cache.clear();
			expect(cache.size).toBe(0);
			expect(cache.get("a")).toBeUndefined();
			expect(cache.get("b")).toBeUndefined();
		});
	});

	describe("capacity and eviction", () => {
		test("evicts the least recently used entry when full", () => {
			const cache = new LRUCache<string, number>(2);
			cache.set("a", 1);
			cache.set("b", 2);
			cache.set("c", 3); // evicts "a"
			expect(cache.get("a")).toBeUndefined();
			expect(cache.get("b")).toBe(2);
			expect(cache.get("c")).toBe(3);
			expect(cache.size).toBe(2);
		});

		test("get marks an entry as recently used", () => {
			const cache = new LRUCache<string, number>(2);
			cache.set("a", 1);
			cache.set("b", 2);
			cache.get("a"); // marks "a" as recently used
			cache.set("c", 3); // should evict "b" (least recently used)
			expect(cache.get("a")).toBe(1);
			expect(cache.get("b")).toBeUndefined();
			expect(cache.get("c")).toBe(3);
		});

		test("set updates an existing key without eviction", () => {
			const cache = new LRUCache<string, number>(2);
			cache.set("a", 1);
			cache.set("b", 2);
			cache.set("a", 10); // update, not insert
			expect(cache.size).toBe(2);
			expect(cache.get("a")).toBe(10);
			cache.set("c", 3); // should evict "b" (a was refreshed)
			expect(cache.get("a")).toBe(10);
			expect(cache.get("b")).toBeUndefined();
			expect(cache.get("c")).toBe(3);
		});

		test("capacity of 1 keeps only the most recent entry", () => {
			const cache = new LRUCache<string, number>(1);
			cache.set("a", 1);
			expect(cache.get("a")).toBe(1);
			cache.set("b", 2);
			expect(cache.get("a")).toBeUndefined();
			expect(cache.get("b")).toBe(2);
			expect(cache.size).toBe(1);
		});

		test("sequential evictions maintain correct size", () => {
			const cache = new LRUCache<string, number>(3);
			cache.set("a", 1);
			cache.set("b", 2);
			cache.set("c", 3);
			cache.set("d", 4); // evicts "a"
			cache.set("e", 5); // evicts "b"
			expect(cache.size).toBe(3);
			expect(cache.get("a")).toBeUndefined();
			expect(cache.get("b")).toBeUndefined();
			expect(cache.get("c")).toBe(3);
			expect(cache.get("d")).toBe(4);
			expect(cache.get("e")).toBe(5);
		});
	});

	describe("edge cases", () => {
		test("throws for capacity < 1", () => {
			expect(() => new LRUCache<string, number>(0)).toThrow();
			expect(() => new LRUCache<string, number>(-1)).toThrow();
		});

		test("has does not affect LRU order", () => {
			const cache = new LRUCache<string, number>(2);
			cache.set("a", 1);
			cache.set("b", 2);
			cache.has("a"); // should NOT move "a" to the end
			cache.set("c", 3); // should evict "a" (oldest, not refreshed by has)
			expect(cache.get("a")).toBeUndefined();
			expect(cache.get("b")).toBe(2);
			expect(cache.get("c")).toBe(3);
		});

		test("works with numeric keys", () => {
			const cache = new LRUCache<number, string>(2);
			cache.set(1, "one");
			cache.set(2, "two");
			expect(cache.get(1)).toBe("one");
		});

		test("works with object values", () => {
			const cache = new LRUCache<string, { x: number }>(2);
			const obj = { x: 42 };
			cache.set("key", obj);
			expect(cache.get("key")).toBe(obj);
		});

		test("delete followed by set does not exceed capacity", () => {
			const cache = new LRUCache<string, number>(2);
			cache.set("a", 1);
			cache.set("b", 2);
			cache.delete("a");
			cache.set("c", 3);
			expect(cache.size).toBe(2);
			expect(cache.get("b")).toBe(2);
			expect(cache.get("c")).toBe(3);
		});
	});
});

// ─── extractSourceSnippet() ──────────────────────────────────────────────────

describe("extractSourceSnippet", () => {
	test("extracts a single-line snippet", () => {
		const template = "Hello {{name}} world";
		const loc = {
			start: { line: 1, column: 6 },
			end: { line: 1, column: 14 },
		};
		const result = extractSourceSnippet(template, loc);
		expect(result).toBe("Hello {{name}} world");
	});

	test("extracts from a multi-line template — single line range", () => {
		const template = "line1\nHello {{name}}\nline3";
		const loc = {
			start: { line: 2, column: 6 },
			end: { line: 2, column: 14 },
		};
		const result = extractSourceSnippet(template, loc);
		expect(result).toBe("Hello {{name}}");
	});

	test("extracts a multi-line range", () => {
		const template = "line1\nline2\nline3\nline4";
		const loc = {
			start: { line: 2, column: 0 },
			end: { line: 3, column: 5 },
		};
		const result = extractSourceSnippet(template, loc);
		expect(result).toBe("line2\nline3");
	});

	test("returns empty string for out-of-range line", () => {
		const template = "single line";
		const loc = {
			start: { line: 5, column: 0 },
			end: { line: 5, column: 5 },
		};
		expect(extractSourceSnippet(template, loc)).toBe("");
	});

	test("returns empty string for line 0 (invalid, 1-based)", () => {
		const template = "some text";
		const loc = {
			start: { line: 0, column: 0 },
			end: { line: 0, column: 5 },
		};
		expect(extractSourceSnippet(template, loc)).toBe("");
	});

	test("trims trailing whitespace on multi-line results", () => {
		const template = "line1   \n  line2   \nline3";
		const loc = {
			start: { line: 1, column: 0 },
			end: { line: 2, column: 5 },
		};
		const result = extractSourceSnippet(template, loc);
		expect(result).toBe("line1\n  line2");
	});

	test("handles end line beyond the template length", () => {
		const template = "line1\nline2";
		const loc = {
			start: { line: 1, column: 0 },
			end: { line: 99, column: 0 },
		};
		const result = extractSourceSnippet(template, loc);
		expect(result).toBe("line1\nline2");
	});
});

// ─── getSchemaPropertyNames() ────────────────────────────────────────────────

describe("getSchemaPropertyNames", () => {
	test("returns direct property names sorted", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				name: { type: "string" },
				age: { type: "number" },
				active: { type: "boolean" },
			},
		};
		expect(getSchemaPropertyNames(schema)).toEqual(["active", "age", "name"]);
	});

	test("returns empty array for schema without properties", () => {
		const schema: JSONSchema7 = { type: "object" };
		expect(getSchemaPropertyNames(schema)).toEqual([]);
	});

	test("returns empty array for empty schema", () => {
		expect(getSchemaPropertyNames({})).toEqual([]);
	});

	test("includes properties from allOf branches", () => {
		const schema: JSONSchema7 = {
			type: "object",
			allOf: [
				{
					type: "object",
					properties: { a: { type: "string" } },
				},
				{
					type: "object",
					properties: { b: { type: "number" } },
				},
			],
		};
		expect(getSchemaPropertyNames(schema)).toEqual(["a", "b"]);
	});

	test("includes properties from oneOf branches", () => {
		const schema: JSONSchema7 = {
			type: "object",
			oneOf: [
				{
					type: "object",
					properties: { x: { type: "string" } },
				},
				{
					type: "object",
					properties: { y: { type: "number" } },
				},
			],
		};
		expect(getSchemaPropertyNames(schema)).toEqual(["x", "y"]);
	});

	test("includes properties from anyOf branches", () => {
		const schema: JSONSchema7 = {
			type: "object",
			anyOf: [
				{
					type: "object",
					properties: { foo: { type: "string" } },
				},
			],
		};
		expect(getSchemaPropertyNames(schema)).toEqual(["foo"]);
	});

	test("deduplicates properties across direct and combinator branches", () => {
		const schema: JSONSchema7 = {
			type: "object",
			properties: {
				name: { type: "string" },
			},
			allOf: [
				{
					type: "object",
					properties: { name: { type: "string" }, extra: { type: "number" } },
				},
			],
		};
		expect(getSchemaPropertyNames(schema)).toEqual(["extra", "name"]);
	});

	test("skips boolean branches in combinators", () => {
		const schema: JSONSchema7 = {
			type: "object",
			oneOf: [
				true, // boolean branch — should be skipped
				{
					type: "object",
					properties: { valid: { type: "string" } },
				},
			],
		};
		expect(getSchemaPropertyNames(schema)).toEqual(["valid"]);
	});

	test("handles combinator branches without properties", () => {
		const schema: JSONSchema7 = {
			type: "object",
			allOf: [
				{ type: "object" }, // no properties
				{
					type: "object",
					properties: { a: { type: "string" } },
				},
			],
		};
		expect(getSchemaPropertyNames(schema)).toEqual(["a"]);
	});
});
