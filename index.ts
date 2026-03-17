import type { JSONSchema7 } from "json-schema";
import { type TemplateInput, Typebars } from "./src";

const tp = new Typebars();

const params = {
	names: '{{#if hasUsers}}{{map users "name"}}{{else}}{{defaultNames}}{{/if}}',
};

const coerceSchema = {} as JSONSchema7;

const inputSchema = {
	type: "object",
	properties: {
		defaultNames: {
			type: "array",
			items: {
				type: "string",
			},
		},
		hasUsers: {
			type: "boolean",
		},
		users: {
			type: "array",
			items: {
				type: "object",
				properties: {
					name: {
						type: "string",
					},
				},
			},
		},
	},
} as JSONSchema7;

const result = tp.analyzeAndExecute(
	params as TemplateInput,
	inputSchema,
	{
		hasUsers: false,
		defaultNames: ["alice", "bob"],
		users: [],
	},
	{
		coerceSchema,
	},
);

console.log(JSON.stringify(result, null, 2));
