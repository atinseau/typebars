import { Typebars } from "./src";

const tp = new Typebars();

const result = tp.execute({ name: "{{name:1}}", value: 42 }, undefined, {
	identifierData: {
		1: { name: "Arthur" },
	},
});

console.log(result);
