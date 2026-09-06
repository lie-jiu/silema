// Minimal test runner: bundles the (mostly pure) TS modules with esbuild —
// already in node_modules via wrangler, so the test suite adds zero deps —
// then executes tests/*.test.mjs with the node:test runner.
//   npm test
import { build } from "esbuild";
import { readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

rmSync(join(root, ".test-build"), { recursive: true, force: true });
await build({
  entryPoints: [
    "src/adapters.ts",
    "src/totp.ts",
    "src/time.ts",
    "src/messages.ts",
    "src/checkin.ts",
  ].map((p) => join(root, p)),
  outdir: join(root, ".test-build"),
  bundle: true,
  format: "esm",
  // "node" 而非 "neutral"：neutral 下 esbuild 解析不了 mimemessage 的 CJS 入口；
  // 测试本身就跑在 Node 里，用 node 平台恰好一致。
  platform: "node",
  // cloudflare:email is a Workers-only runtime module, only ever imported
  // dynamically inside the send path — nothing the tests execute.
  external: ["cloudflare:*", "hono"],
  logLevel: "silent",
});

for (const f of readdirSync(join(root, "tests")).filter((f) => f.endsWith(".test.mjs"))) {
  await import(new URL(`../tests/${f}`, import.meta.url).href);
}
