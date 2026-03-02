import type { JSONSchema7 } from "json-schema";
import { Typebars } from "./src";

const tp = new Typebars();

const schema: JSONSchema7 = {
	type: "object",
	properties: {
		name: {
			type: "string",
		},
	},
	required: ["name"],
};

// ❌ String where number is expected → TYPE_MISMATCH

const result = tp.analyze(["{{name}}"], schema);
console.log(JSON.stringify(result, null, 2));
