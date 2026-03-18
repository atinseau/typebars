import type { JSONSchema7 } from "json-schema";
import { type TemplateInput, Typebars } from "./src";

const tp = new Typebars();

const params = {
	accountIds: ["{{accountDepartmentId}}"],
};

const inputSchema = {
	type: "object",
	properties: {
		accountId: {
			type: "string",
		},
		accountDepartmentId: {
			type: "string",
		},
	},
	required: ["accountId"], // accountDepartmentId is not required, so is optional
} as JSONSchema7;

const result = tp.analyzeAndExecute(params as TemplateInput, inputSchema, {
	accountDepartmentId: null, // optional property not provided
	accountId: "salut",
});

console.log(JSON.stringify(result, null, 2));
