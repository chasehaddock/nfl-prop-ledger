import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("builds a deployable Prop Ledger site with its data files", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /Prop Ledger — NFL Season Totals/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /(?:src|href)="\.\/assets\//);
  assert.doesNotMatch(html, /(?:src|href)="\/assets\//);
  const assets = await readdir(new URL("../dist/assets/", import.meta.url));
  assert.ok(assets.some((file) => file.endsWith(".js")));
  assert.ok(assets.some((file) => file.endsWith(".css")));
  await access(new URL("../dist/data/current.json", import.meta.url));
  await access(new URL("../dist/data/history.json", import.meta.url));
  await access(new URL("../dist/data/week-1.json", import.meta.url));
  await access(new URL("../dist/data/week-1-history.json", import.meta.url));
});
