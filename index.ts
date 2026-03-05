import type { JSONSchema7 } from "json-schema";
import { Typebars } from "./src";

const tp = new Typebars();

const template = `
  {{ collect (collect users 'names') 'name' }}
`;

const schema: JSONSchema7 = {
	type: "object",
	properties: {
		users: {
			type: "array",
			items: {
				type: "object",
				properties: {
					names: {
						type: "array",
						items: {
							type: "object",
							properties: {
								name: { type: "string" },
							},
						},
					},
				},
			},
		},
	},
	required: ["users"],
};

const data = {
	users: [
		{
			names: [{ name: "Alice" }, { name: "Bob" }],
		},
		{
			names: [{ name: "Charlie" }, { name: "David" }],
		},
	],
};

const result = tp.analyzeAndExecute(template, schema, data);

console.log(JSON.stringify(result, null, 2));
