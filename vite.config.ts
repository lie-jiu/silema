import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const ASSET_SOURCES = [
  "node_modules/htmx.org/dist/htmx.min.js",
  "src/client/hold-button.js",
  "src/client/dialog.js",
  "src/client/chips.js",
];

/**
 * `/assets/*` 的版本号取自文件内容而不是时间戳或 commit：内容不变则 URL 不变（重复部署不打
 * 穿缓存），内容一变则 URL 必变（所以能挂 `immutable`，不存在用户跑着旧脚本的窗口）。
 * 换行先归一成 LF：本机 `core.autocrlf=true`，一次 `git checkout` 就会把 CRLF 写回工作区，
 * 不归一的话同样的内容会因为行尾不同而换掉版本号、白白让所有人重下一次。
 */
const assetVersion = createHash("sha256")
  .update(
    ASSET_SOURCES.map((p) =>
      readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8").replace(/\r\n/g, "\n"),
    ).join("\n"),
  )
  .digest("hex")
  .slice(0, 10);

export default defineConfig({
  plugins: [cloudflare(), tailwindcss()],
  define: { __ASSET_VERSION__: JSON.stringify(assetVersion) },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/", import.meta.url)) },
  },
  server: { port: 5173 },
});
