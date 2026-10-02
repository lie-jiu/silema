#!/usr/bin/env node
"use strict";
// 按文件名顺序执行 migrations/ 下全部 .sql。本地用；生产走 `wrangler d1 migrations apply`。
//   node scripts/migrate.cjs            # 本地
//   node scripts/migrate.cjs --remote   # 线上
const L = require("./_local.cjs");

L.runMigrations({ local: !process.argv.includes("--remote") });
console.log("migrations/ 已按序执行完毕");
