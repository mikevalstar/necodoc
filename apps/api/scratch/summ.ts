import { readFileSync } from "node:fs";
import { designedDraftSchema, templateDiff } from "@necodoc/shared";
import { aiModel } from "../src/ai";
import { suggestDescription, suggestNote } from "../src/assistant";

if (!aiModel) throw new Error("no ai");
const a = designedDraftSchema.parse(JSON.parse(readFileSync("scratch/bond.json", "utf8")));
const b = designedDraftSchema.parse(JSON.parse(readFileSync("scratch/bond2.json", "utf8")));
console.log("DESC:", await suggestDescription(aiModel, b));
console.log("NOTE:", await suggestNote(aiModel, { name: b.name, diff: templateDiff(a, b) }));
console.log("FIRST:", await suggestNote(aiModel, { name: a.name, first: a }));
