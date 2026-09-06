import test from "node:test";
import assert from "node:assert/strict";
import {
  splitMessage,
  fillTemplate,
  buildVars,
  buildMessage,
  placeholdersFor,
  DEFAULT_WARNING_TITLE,
  DEFAULT_TRIGGER_TITLE,
} from "../.test-build/messages.js";

test("splitMessage: first line becomes title", () => {
  assert.deepEqual(splitMessage("标题\n正文第一行\n正文第二行"), {
    title: "标题",
    body: "正文第一行\n正文第二行",
  });
});

test("splitMessage: single line has no title (default title kicks in later)", () => {
  assert.deepEqual(splitMessage("只有一行"), { body: "只有一行" });
});

test("splitMessage: leading empty line means no title", () => {
  assert.deepEqual(splitMessage("\n正文"), { body: "正文" });
});

test("fillTemplate replaces known vars and keeps unknown ones", () => {
  const out = fillTemplate("你好 {label}，{typo_name} 于 {time}", { label: "我", time: "12:00" });
  assert.equal(out, "你好 我，{typo_name} 于 12:00");
});

test("fillTemplate handles adjacency and braces without names", () => {
  assert.equal(fillTemplate("{a}{a}{}", { a: "x" }), "xx{}");
});

test("buildVars: checkin_url falls back to site", () => {
  const vars = buildVars({ purpose: "warning", tz: "UTC", site: "https://s.example", checkinUrl: "" });
  assert.equal(vars.checkin_url, "https://s.example");
});

test("buildVars: no site and no link omits checkin_url so the placeholder stays visible", () => {
  const vars = buildVars({ purpose: "trigger", tz: "UTC", site: "", checkinUrl: "" });
  assert.equal("checkin_url" in vars, false);
  const out = fillTemplate("点此签到：{checkin_url}", vars);
  assert.equal(out, "点此签到：{checkin_url}");
});

test("buildVars carries numeric fields as strings", () => {
  const vars = buildVars({ purpose: "warning", tz: "UTC", site: "s", checkinUrl: "c", expiryHours: 18, warningHours: 10 });
  assert.equal(vars.expiry_hours, "18");
  assert.equal(vars.warning_hours, "10");
});

test("buildMessage falls back to built-in defaults for legacy empty content", () => {
  const vars = buildVars({ purpose: "trigger", tz: "UTC", site: "s", checkinUrl: "c", time: "T" });
  const m = buildMessage("", { title: DEFAULT_TRIGGER_TITLE, body: "body {time}" }, vars);
  assert.equal(m.title, DEFAULT_TRIGGER_TITLE);
  assert.equal(m.body, "body T");
});

test("buildMessage: custom single-line content keeps the default title", () => {
  const vars = buildVars({ purpose: "warning", tz: "UTC", site: "s", checkinUrl: "c", deadline: "D" });
  const m = buildMessage("自定义正文 {deadline}", { title: DEFAULT_WARNING_TITLE, body: "" }, vars);
  assert.equal(m.title, DEFAULT_WARNING_TITLE);
  assert.equal(m.body, "自定义正文 D");
});

test("placeholdersFor scopes: deadline only in warning, time only in trigger", () => {
  const w = placeholdersFor("warning").map((p) => p.name);
  const t = placeholdersFor("trigger").map((p) => p.name);
  assert.ok(w.includes("deadline") && !w.includes("time"));
  assert.ok(t.includes("time") && !t.includes("deadline"));
  assert.ok(w.includes("checkin_url") && t.includes("checkin_url"));
});
