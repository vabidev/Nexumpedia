import assert from "node:assert/strict";
import { citationKeysFromContent, renderMarkup } from "../src/helpers.js";

const references = [
  {
    citation_key: "fonte1",
    title: "Fonte de teste",
  },
];

const html = renderMarkup(
  "Primeira afirmação.[^fonte1]\n\nOutra afirmação.[^fonte1]",
  references,
);

assert.match(html, /id="cite-fonte1-1"/);
assert.match(html, /id="cite-fonte1-2"/);
assert.match(html, /href="#ref-fonte1"/);
assert.deepEqual(
  citationKeysFromContent("A[^fonte1] B[^FONTE2] C[^fonte1]"),
  ["fonte1", "fonte2", "fonte1"],
);

const missing = renderMarkup("Texto.[^inexistente]", references);
assert.match(missing, /citation-missing/);

console.log("Citation checks passed.");
