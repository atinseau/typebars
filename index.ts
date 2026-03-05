import type { JSONSchema7 } from "json-schema";
import { Typebars } from "./src";

const tp = new Typebars();

const template = `
  {{

  collect users 'cartItems'

  }}
`;

const data = {
	users: [
		{ name: "Alice", cartItems: [{ productId: "p1", quantity: 2 }] },
		{ name: "Bob", cartItems: [{ productId: "p2", quantity: 1 }] },
		{ name: "Charlie", cartItems: [{ productId: "p3", quantity: 5 }] },
	],
};

const schema: JSONSchema7 = {
	type: "object",
	properties: {
		users: {
			type: "array",
			items: {
				type: "object",
				properties: {
					cartItems: {
						type: "array",
						items: {
							type: "object",
							properties: {
								productId: { type: "string" },
								quantity: { type: "number" },
							},
							required: ["productId", "quantity"],
						},
					},
				},
			},
			required: ["name"],
		},
	},
	required: ["users"],
};

const result = tp.analyzeAndExecute(template, schema, data);

console.log(JSON.stringify(result, null, 2));
