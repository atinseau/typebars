import type { JSONSchema7 } from "json-schema";
import { TemplateEngine } from "./src/index.ts";

// ─── Showcase du Template Engine avec helpers built-in et custom ──────────────

// Les MathHelpers sont pré-enregistrés automatiquement.
// On peut aussi ajouter des helpers custom via les options du constructeur.
const engine = new TemplateEngine({
	helpers: [
		{
			name: "uppercase",
			description: "Converts a string to uppercase",
			fn: (value: string) => String(value).toUpperCase(),
			params: [
				{
					name: "value",
					type: { type: "string" },
					description: "The string to convert",
				},
			],
			returnType: { type: "string" },
		},
		{
			name: "concat",
			description: "Concatenates two strings with an optional separator",
			fn: (a: string, b: string, sep: unknown) => {
				const separator = typeof sep === "string" ? sep : "";
				return `${a}${separator}${b}`;
			},
			params: [
				{ name: "a", type: { type: "string" }, description: "First string" },
				{ name: "b", type: { type: "string" }, description: "Second string" },
				{
					name: "separator",
					type: { type: "string" },
					description: "Separator",
					optional: true,
				},
			],
			returnType: { type: "string" },
		},
	],
});

const schema: JSONSchema7 = {
	type: "object",
	properties: {
		accountIds: { type: "array", items: { type: "number" } },
		price: { type: "number" },
		quantity: { type: "number" },
		score: { type: "number" },
		firstName: { type: "string" },
		lastName: { type: "string" },
	},
	required: [
		"accountIds",
		"price",
		"quantity",
		"score",
		"firstName",
		"lastName",
	],
} as const;

const data = {
	accountIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
	price: 49.99,
	quantity: 3,
	score: -7.6,
	firstName: "alice",
	lastName: "smith",
};

// ── Built-in math helpers (pré-enregistrés) ──────────────────────────────────

console.log("─── divide (built-in) ───");
console.log(
	JSON.stringify(
		engine.analyzeAndExecute("{{ divide accountIds.length 10 }}", schema, data),
		null,
		2,
	),
);

console.log("\n─── math helper générique (built-in) ───");
console.log(
	JSON.stringify(
		engine.analyzeAndExecute(
			'{{ math accountIds.length "/" 10 }}',
			schema,
			data,
		),
		null,
		2,
	),
);

console.log("\n─── add (built-in) ───");
console.log(
	JSON.stringify(
		engine.analyzeAndExecute("{{ add price 10 }}", schema, data),
		null,
		2,
	),
);

console.log("\n─── mul (built-in) ───");
console.log(
	JSON.stringify(
		engine.analyzeAndExecute("{{ mul price quantity }}", schema, data),
		null,
		2,
	),
);

console.log("\n─── abs (built-in) ───");
console.log(
	JSON.stringify(
		engine.analyzeAndExecute("{{ abs score }}", schema, data),
		null,
		2,
	),
);

console.log("\n─── round (built-in) ───");
console.log(
	JSON.stringify(
		engine.analyzeAndExecute("{{ round price 1 }}", schema, data),
		null,
		2,
	),
);

console.log("\n─── math exponentiation (built-in) ───");
console.log(
	JSON.stringify(
		engine.analyzeAndExecute('{{ math quantity "**" 2 }}', schema, data),
		null,
		2,
	),
);

// ── Custom helpers (enregistrés via options) ─────────────────────────────────

console.log("\n─── uppercase (custom via options) ───");
console.log(
	JSON.stringify(
		engine.analyzeAndExecute("{{ uppercase firstName }}", schema, data),
		null,
		2,
	),
);

console.log("\n─── concat (custom via options) ───");
console.log(
	JSON.stringify(
		engine.analyzeAndExecute(
			'{{ concat firstName lastName " " }}',
			schema,
			data,
		),
		null,
		2,
	),
);
