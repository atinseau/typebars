import type { JSONSchema7 } from "json-schema";
import { type TemplateInput, Typebars } from "./src";

const tp = new Typebars();

const params = { accountId: "{{accountId}}", ok: "salut" };

const coerceSchema = {
	type: "object",
	properties: {
		ok: { type: "string" },
		accountId: { type: "string", constraints: "IsUuid" },
	},
} as JSONSchema7;

const result = tp.analyzeAndExecute(
	params as TemplateInput,
	undefined,
	{},
	{
		excludeTemplateExpression: true,
		coerceSchema,
	},
);

console.log(JSON.stringify(result, null, 2));
