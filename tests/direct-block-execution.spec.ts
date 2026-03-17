import { beforeEach, describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import { clearCompilationCache, execute } from "../src/executor.ts";
import { Typebars } from "../src/typebars.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const usersSchema: JSONSchema7 = {
	type: "object",
	properties: {
		hasUsers: { type: "boolean" },
		isAdmin: { type: "boolean" },
		enabled: { type: "boolean" },
		level: { type: "number" },
		defaultNames: {
			type: "array",
			items: { type: "string" },
		},
		fallbackIds: {
			type: "array",
			items: { type: "number" },
		},
		users: {
			type: "array",
			items: {
				type: "object",
				properties: {
					name: { type: "string" },
					age: { type: "number" },
				},
			},
		},
		admins: {
			type: "array",
			items: {
				type: "object",
				properties: {
					name: { type: "string" },
				},
			},
		},
		guests: {
			type: "array",
			items: {
				type: "object",
				properties: {
					name: { type: "string" },
				},
			},
		},
	},
};

const usersData = {
	hasUsers: true,
	isAdmin: true,
	enabled: true,
	level: 3,
	defaultNames: ["default1", "default2"],
	fallbackIds: [100, 200, 300],
	users: [
		{ name: "Alice", age: 30 },
		{ name: "Bob", age: 25 },
		{ name: "Charlie", age: 35 },
	],
	admins: [{ name: "Root" }, { name: "SuperUser" }],
	guests: [{ name: "Guest1" }, { name: "Guest2" }],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("direct block execution — type preservation through conditionals", () => {
	let tp: Typebars;

	beforeEach(() => {
		clearCompilationCache();
		tp = new Typebars();
	});

	// ── Basic #if with map helper ────────────────────────────────────────

	describe("#if with map helper → preserves array", () => {
		test("truthy condition: map inside #if returns array", () => {
			const result = tp.execute(
				'{{#if hasUsers}}{{map users "name"}}{{/if}}',
				usersData,
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Alice", "Bob", "Charlie"]);
		});

		test("falsy condition with else: map in else branch returns array", () => {
			const result = tp.execute(
				'{{#if hasUsers}}{{defaultNames}}{{else}}{{map users "name"}}{{/if}}',
				{ ...usersData, hasUsers: false },
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Alice", "Bob", "Charlie"]);
		});

		test("truthy condition with else: map in main branch, variable in else", () => {
			const result = tp.execute(
				'{{#if hasUsers}}{{map users "name"}}{{else}}{{defaultNames}}{{/if}}',
				usersData,
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Alice", "Bob", "Charlie"]);
		});

		test("falsy condition with else: variable in else returns array", () => {
			const result = tp.execute(
				'{{#if hasUsers}}{{map users "name"}}{{else}}{{defaultNames}}{{/if}}',
				{ ...usersData, hasUsers: false },
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["default1", "default2"]);
		});

		test("both branches are map helpers → preserves array from truthy branch", () => {
			const result = tp.execute(
				'{{#if isAdmin}}{{map admins "name"}}{{else}}{{map guests "name"}}{{/if}}',
				usersData,
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Root", "SuperUser"]);
		});

		test("both branches are map helpers → preserves array from falsy branch", () => {
			const result = tp.execute(
				'{{#if isAdmin}}{{map admins "name"}}{{else}}{{map guests "name"}}{{/if}}',
				{ ...usersData, isAdmin: false },
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Guest1", "Guest2"]);
		});
	});

	// ── #unless with map helper ──────────────────────────────────────────

	describe("#unless with map helper → preserves array", () => {
		test("unless truthy (hasUsers=true): else branch with map returns array", () => {
			const result = tp.execute(
				'{{#unless hasUsers}}{{defaultNames}}{{else}}{{map users "name"}}{{/unless}}',
				usersData,
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Alice", "Bob", "Charlie"]);
		});

		test("unless truthy: main branch variable returns array", () => {
			const result = tp.execute(
				'{{#unless hasUsers}}{{map users "name"}}{{else}}{{defaultNames}}{{/unless}}',
				usersData,
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["default1", "default2"]);
		});

		test("unless falsy: map in main branch returns array", () => {
			const result = tp.execute(
				'{{#unless hasUsers}}{{map users "name"}}{{/unless}}',
				{ ...usersData, hasUsers: false },
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Alice", "Bob", "Charlie"]);
		});
	});

	// ── Nested #if blocks ────────────────────────────────────────────────

	describe("nested #if blocks → preserves array through nesting", () => {
		test("two levels of #if: map at innermost level", () => {
			const result = tp.execute(
				'{{#if hasUsers}}{{#if isAdmin}}{{map admins "name"}}{{/if}}{{/if}}',
				usersData,
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Root", "SuperUser"]);
		});

		test("two levels of #if: inner condition falsy → else branch", () => {
			const result = tp.execute(
				'{{#if hasUsers}}{{#if isAdmin}}{{map admins "name"}}{{else}}{{map guests "name"}}{{/if}}{{/if}}',
				{ ...usersData, isAdmin: false },
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Guest1", "Guest2"]);
		});

		test("two levels of #if: outer condition falsy → outer else", () => {
			const result = tp.execute(
				'{{#if hasUsers}}{{#if isAdmin}}{{map admins "name"}}{{/if}}{{else}}{{defaultNames}}{{/if}}',
				{ ...usersData, hasUsers: false },
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["default1", "default2"]);
		});

		test("three levels of #if nesting", () => {
			const result = tp.execute(
				'{{#if hasUsers}}{{#if isAdmin}}{{#if enabled}}{{map admins "name"}}{{/if}}{{/if}}{{/if}}',
				usersData,
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Root", "SuperUser"]);
		});

		test("three levels: deepest condition falsy → else branch", () => {
			const result = tp.execute(
				'{{#if hasUsers}}{{#if isAdmin}}{{#if enabled}}{{map admins "name"}}{{else}}{{map guests "name"}}{{/if}}{{/if}}{{/if}}',
				{ ...usersData, enabled: false },
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Guest1", "Guest2"]);
		});

		test("nested #if + #unless combination", () => {
			const result = tp.execute(
				'{{#if hasUsers}}{{#unless isAdmin}}{{map guests "name"}}{{else}}{{map admins "name"}}{{/unless}}{{/if}}',
				usersData,
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Root", "SuperUser"]);
		});
	});

	// ── #if with variable reference (non-helper) preserves type ──────────

	describe("#if with direct variable reference → preserves type", () => {
		test("truthy: direct array variable in main branch", () => {
			const result = execute(
				"{{#if hasUsers}}{{defaultNames}}{{else}}{{fallbackIds}}{{/if}}",
				usersData,
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["default1", "default2"]);
		});

		test("falsy: direct array variable in else branch", () => {
			const result = execute(
				"{{#if hasUsers}}{{defaultNames}}{{else}}{{fallbackIds}}{{/if}}",
				{ ...usersData, hasUsers: false },
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual([100, 200, 300]);
		});

		test("truthy: preserves object type", () => {
			const data = {
				flag: true,
				objA: { x: 1, y: 2 },
				objB: { x: 10, y: 20 },
			};
			const result = execute(
				"{{#if flag}}{{objA}}{{else}}{{objB}}{{/if}}",
				data,
			);
			expect(result).toEqual({ x: 1, y: 2 });
		});

		test("falsy: preserves object type in else branch", () => {
			const data = {
				flag: false,
				objA: { x: 1, y: 2 },
				objB: { x: 10, y: 20 },
			};
			const result = execute(
				"{{#if flag}}{{objA}}{{else}}{{objB}}{{/if}}",
				data,
			);
			expect(result).toEqual({ x: 10, y: 20 });
		});

		test("truthy: preserves number type", () => {
			const result = execute(
				"{{#if hasUsers}}{{level}}{{else}}{{level}}{{/if}}",
				usersData,
			);
			expect(result).toBe(3);
			expect(typeof result).toBe("number");
		});

		test("truthy: preserves boolean type", () => {
			const result = execute(
				"{{#if hasUsers}}{{isAdmin}}{{else}}{{enabled}}{{/if}}",
				usersData,
			);
			expect(result).toBe(true);
			expect(typeof result).toBe("boolean");
		});
	});

	// ── Edge cases ───────────────────────────────────────────────────────

	describe("edge cases", () => {
		test("empty array condition is falsy (Handlebars semantics)", () => {
			const result = tp.execute(
				'{{#if users}}{{map users "name"}}{{else}}{{defaultNames}}{{/if}}',
				{ ...usersData, users: [] },
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["default1", "default2"]);
		});

		test("non-empty array condition is truthy", () => {
			const result = tp.execute(
				'{{#if users}}{{map users "name"}}{{else}}{{defaultNames}}{{/if}}',
				usersData,
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Alice", "Bob", "Charlie"]);
		});

		test("#if with no else, falsy condition → empty string", () => {
			const result = tp.execute('{{#if hasUsers}}{{map users "name"}}{{/if}}', {
				...usersData,
				hasUsers: false,
			});
			expect(result).toBe("");
		});

		test("#unless with no else, truthy condition → empty string", () => {
			const result = tp.execute(
				'{{#unless hasUsers}}{{map users "name"}}{{/unless}}',
				usersData,
			);
			expect(result).toBe("");
		});

		test("map returning empty array is preserved through #if", () => {
			const result = tp.execute('{{#if hasUsers}}{{map users "name"}}{{/if}}', {
				...usersData,
				users: [],
			});
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual([]);
		});

		test("map returning single-element array through #if", () => {
			const result = tp.execute('{{#if hasUsers}}{{map users "name"}}{{/if}}', {
				...usersData,
				users: [{ name: "Solo" }],
			});
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Solo"]);
		});

		test("map returning number array through #if", () => {
			const result = tp.execute(
				'{{#if hasUsers}}{{map users "age"}}{{/if}}',
				usersData,
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual([30, 25, 35]);
		});

		test("condition on undefined value → falsy", () => {
			const result = tp.execute(
				'{{#if missingVar}}{{map users "name"}}{{else}}{{defaultNames}}{{/if}}',
				usersData,
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["default1", "default2"]);
		});

		test("condition on null value → falsy", () => {
			const result = tp.execute(
				'{{#if nullVal}}{{map users "name"}}{{else}}{{defaultNames}}{{/if}}',
				{ ...usersData, nullVal: null },
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["default1", "default2"]);
		});

		test("condition on zero → falsy", () => {
			const result = tp.execute(
				'{{#if count}}{{map users "name"}}{{else}}{{defaultNames}}{{/if}}',
				{ ...usersData, count: 0 },
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["default1", "default2"]);
		});

		test("condition on empty string → falsy", () => {
			const result = tp.execute(
				'{{#if label}}{{map users "name"}}{{else}}{{defaultNames}}{{/if}}',
				{ ...usersData, label: "" },
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["default1", "default2"]);
		});

		test("whitespace around block does not break direct execution", () => {
			const result = tp.execute(
				'  {{#if hasUsers}}{{map users "name"}}{{/if}}  ',
				usersData,
			);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Alice", "Bob", "Charlie"]);
		});
	});

	// ── analyzeAndExecute integration ────────────────────────────────────

	describe("analyzeAndExecute integration", () => {
		test("map inside #if/else: analysis valid, value is array", () => {
			const { analysis, value } = tp.analyzeAndExecute(
				{
					names:
						'{{#if hasUsers}}{{map users "name"}}{{else}}{{defaultNames}}{{/if}}',
				},
				usersSchema,
				usersData,
			);
			expect(analysis.valid).toBe(true);
			const v = value as Record<string, unknown>;
			expect(Array.isArray(v.names)).toBe(true);
			expect(v.names).toEqual(["Alice", "Bob", "Charlie"]);
		});

		test("map inside #if/else falsy: analysis valid, value is array from else", () => {
			const { analysis, value } = tp.analyzeAndExecute(
				{
					names:
						'{{#if hasUsers}}{{map users "name"}}{{else}}{{defaultNames}}{{/if}}',
				},
				usersSchema,
				{ ...usersData, hasUsers: false },
			);
			expect(analysis.valid).toBe(true);
			const v = value as Record<string, unknown>;
			expect(Array.isArray(v.names)).toBe(true);
			expect(v.names).toEqual(["default1", "default2"]);
		});

		test("multiple fields with conditional maps", () => {
			const { analysis, value } = tp.analyzeAndExecute(
				{
					names:
						'{{#if hasUsers}}{{map users "name"}}{{else}}{{defaultNames}}{{/if}}',
					roleNames:
						'{{#if isAdmin}}{{map admins "name"}}{{else}}{{map guests "name"}}{{/if}}',
				},
				usersSchema,
				usersData,
			);
			expect(analysis.valid).toBe(true);
			const v = value as Record<string, unknown>;
			expect(v.names).toEqual(["Alice", "Bob", "Charlie"]);
			expect(v.roleNames).toEqual(["Root", "SuperUser"]);
		});

		test("nested #if with analyzeAndExecute", () => {
			const { analysis, value } = tp.analyzeAndExecute(
				{
					names:
						'{{#if hasUsers}}{{#if isAdmin}}{{map admins "name"}}{{else}}{{map users "name"}}{{/if}}{{/if}}',
				},
				usersSchema,
				usersData,
			);
			expect(analysis.valid).toBe(true);
			const v = value as Record<string, unknown>;
			expect(v.names).toEqual(["Root", "SuperUser"]);
		});
	});

	// ── compile() integration ────────────────────────────────────────────

	describe("compile() integration", () => {
		test("compiled template preserves array through #if", () => {
			const compiled = tp.compile(
				'{{#if hasUsers}}{{map users "name"}}{{else}}{{defaultNames}}{{/if}}',
			);
			const result = compiled.execute(usersData);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Alice", "Bob", "Charlie"]);
		});

		test("compiled template preserves array in else branch", () => {
			const compiled = tp.compile(
				'{{#if hasUsers}}{{map users "name"}}{{else}}{{defaultNames}}{{/if}}',
			);
			const result = compiled.execute({ ...usersData, hasUsers: false });
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["default1", "default2"]);
		});

		test("compiled nested #if preserves array", () => {
			const compiled = tp.compile(
				'{{#if hasUsers}}{{#if isAdmin}}{{map admins "name"}}{{else}}{{map guests "name"}}{{/if}}{{/if}}',
			);
			const result = compiled.execute(usersData);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual(["Root", "SuperUser"]);
		});
	});

	// ── Fallback to Handlebars (complex branches) ────────────────────────

	describe("fallback: complex branches still render via Handlebars", () => {
		test("#if with text + expression in branch → string", () => {
			const result = execute(
				"{{#if hasUsers}}Hello {{level}}{{else}}Bye{{/if}}",
				usersData,
			);
			expect(result).toBe("Hello 3");
			expect(typeof result).toBe("string");
		});

		test("#if with #each in branch → string (falls back to Handlebars)", () => {
			const result = tp.execute(
				"{{#if hasUsers}}{{#each users}}{{name}} {{/each}}{{else}}none{{/if}}",
				usersData,
			);
			expect(result).toBe("Alice Bob Charlie ");
			expect(typeof result).toBe("string");
		});

		test("literal coercion still works in fallback path", () => {
			const result = execute("{{#if hasUsers}}42{{else}}0{{/if}}", usersData);
			expect(result).toBe(42);
			expect(typeof result).toBe("number");
		});

		test("boolean literal coercion still works in fallback path", () => {
			const result = execute(
				"{{#if hasUsers}}true{{else}}false{{/if}}",
				usersData,
			);
			expect(result).toBe(true);
			expect(typeof result).toBe("boolean");
		});
	});

	// ── Mixed template: #if inside text → remains a string ───────────────

	describe("mixed template: #if inside text → string (no direct execution)", () => {
		test("text before #if with map → string with comma-joined array", () => {
			const result = tp.execute(
				'Names: {{#if hasUsers}}{{map users "name"}}{{/if}}',
				usersData,
			);
			expect(typeof result).toBe("string");
			expect(result).toBe("Names: Alice, Bob, Charlie");
		});

		test("text after #if with map → string", () => {
			const result = tp.execute(
				'{{#if hasUsers}}{{map users "name"}}{{/if}} done',
				usersData,
			);
			expect(typeof result).toBe("string");
			expect(result).toBe("Alice, Bob, Charlie done");
		});
	});
});
