import type { JSONSchema7 } from "json-schema";
import { Typebars } from "./src";

const tb = new Typebars();

const schema: JSONSchema7 = {
	type: "object",
	properties: {
		showAge: { type: "boolean" },
		showName: { type: "boolean" },
		name: { type: "string" },
		age: { type: "number" },
		account: {
			type: "object",
			properties: {
				id: { type: "string" },
				balance: { type: "number" },
			},
			required: ["id", "balance"],
		},
	},
	required: ["name", "age"],
};

const template = `
{{#if showName}}
  {{account.balance}}
{{/if}}

{{#if showAge}}
  {{#if (lt account.balance 500)}}
    {{showAge}}
  {{else}}
    {{name}}
  {{/if}}
{{/if}}
`;

const result = tb.analyze(template, schema);

console.log(JSON.stringify(result, null, 2));
