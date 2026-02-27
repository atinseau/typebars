import { Typebars } from "./src.ts";

const tp = new Typebars();

const schema = {
	type: "object",
	properties: {
		age: { type: "number" },
		score: { type: "number" },
		name: { type: "string" },
		account: {
			type: "object",
			properties: { balance: { type: "number" } },
		},
	},
};

// ❌ String where number is expected → TYPE_MISMATCH
console.log(tp.analyze("{{#if (lt name 500)}}yes{{/if}}", schema));
