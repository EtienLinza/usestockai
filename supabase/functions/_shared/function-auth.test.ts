// Contract test: every deployed edge function must declare an auth mode, and
// the registry must not name functions that no longer exist.
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FUNCTION_AUTH_REGISTRY, corsFor } from "./function-auth.ts";

const FUNCTIONS_DIR = new URL("../", import.meta.url).pathname;

function listFunctionDirs(): string[] {
  const out: string[] = [];
  for (const entry of Deno.readDirSync(FUNCTIONS_DIR)) {
    if (!entry.isDirectory) continue;
    if (entry.name.startsWith("_")) continue;
    out.push(entry.name);
  }
  return out.sort();
}

Deno.test("every edge function declares an auth mode", () => {
  const missing = listFunctionDirs().filter((n) => !(n in FUNCTION_AUTH_REGISTRY));
  assert(missing.length === 0, `functions missing from registry: ${missing.join(", ")}`);
});

Deno.test("registry has no stale entries", () => {
  const dirs = new Set(listFunctionDirs());
  const stale = Object.keys(FUNCTION_AUTH_REGISTRY).filter((n) => !dirs.has(n));
  assert(stale.length === 0, `registry names non-existent functions: ${stale.join(", ")}`);
});

Deno.test("user-mode CORS rejects unknown origins", () => {
  const req = new Request("https://x.test", { headers: { origin: "https://evil.example" } });
  assert(corsFor("user", req)["Access-Control-Allow-Origin"] === "null");
  const ok = new Request("https://x.test", { headers: { origin: "https://usestockai.lovable.app" } });
  assert(corsFor("user", ok)["Access-Control-Allow-Origin"] === "https://usestockai.lovable.app");
  assert(corsFor("public", req)["Access-Control-Allow-Origin"] === "*");
});
