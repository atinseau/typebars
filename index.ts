import { Typebars } from "./src";

const tp = new Typebars();

const result = tp.analyze("10");

console.log(typeof result);
