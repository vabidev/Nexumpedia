import assert from "node:assert/strict";
import {
  diffLines,
  normalizeSnapshotReferences,
  normalizeSnapshotInfobox,
} from "../src/helpers.js";

const diff = diffLines(
  "linha 1\nlinha antiga\nlinha 3",
  "linha 1\nlinha nova\nlinha 3",
);

assert.deepEqual(
  diff.map((part) => part.type),
  ["same", "remove", "add", "same"],
);
assert.match(diff.find((part) => part.type === "remove").text, /linha antiga/);
assert.match(diff.find((part) => part.type === "add").text, /linha nova/);

assert.deepEqual(
  normalizeSnapshotReferences([
    { citation_key: "fonte", title: "Título", published_date: "2026-09-25T00:00:00.000Z" },
    { citation_key: "", title: "Inválida" },
  ]),
  [{
    citation_key: "fonte",
    title: "Título",
    author: "",
    publisher: "",
    url: "",
    published_date: "2026-09-25",
    accessed_date: "",
    note: "",
  }],
);

assert.deepEqual(
  normalizeSnapshotInfobox({
    title: "Resumo",
    media_id: 7,
    caption: "Legenda",
    fields: [{ label: "Campo", value: "Valor", position: 0 }],
  }),
  {
    title: "Resumo",
    media_id: 7,
    caption: "Legenda",
    fields: [{ label: "Campo", value: "Valor" }],
  },
);

assert.equal(normalizeSnapshotInfobox({}), null);

console.log("History checks passed.");
