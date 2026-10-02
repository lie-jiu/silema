-- 0001_init.sql — 全新初始化，无迁移包袱（docs/backend.md §4）
-- 部署 = 新建/清空 D1 → 应用本文件 → scripts/init-owner.cjs

CREATE TABLE owner (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  totp_secret TEXT NOT NULL,
  totp_last_step INTEGER NOT NULL DEFAULT 0,  -- 已使用的 TOTP 步数，防同码重放
  backup_codes TEXT,                          -- 哈希后的恢复码 JSON 数组；用掉一个即从数组移除
  session_epoch INTEGER NOT NULL DEFAULT 1,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  state TEXT NOT NULL DEFAULT 'normal' CHECK (state IN ('normal','locked')),
  streak INTEGER NOT NULL DEFAULT 0,          -- 连续签到天数（展示）
  missed_streak INTEGER NOT NULL DEFAULT 0,   -- 连续未签到天数（满 3 天锁死，见 0002）
  last_checkin_at INTEGER,
  locked_at INTEGER,
  final_sent_at INTEGER,                      -- 第一条最终消息送达时刻；NULL = 未送达，每日 12:00 重试
  last_send_at INTEGER,
  last_judge_at INTEGER NOT NULL,             -- init-owner 写入部署时刻，判定窗口起点永不为 NULL
  last_cron_at INTEGER,
  last_cron_status TEXT,                      -- 'ok' | 'error'
  last_cron_error TEXT                        -- 必须带 [send] / [judge] 前缀
);

CREATE TABLE checkin_tokens (
  token TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('prompt','reminder','final','test')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL DEFAULT '',
  channel_type TEXT NOT NULL,
  config_json TEXT NOT NULL,
  on_prompt INTEGER NOT NULL DEFAULT 0,       -- 日常提醒通道（12:00 链接 + 24:00 未签到提醒）
  on_final INTEGER NOT NULL DEFAULT 1,        -- 紧急联系人（最终消息）
  prompt_content TEXT NOT NULL DEFAULT '',
  reminder_content TEXT NOT NULL DEFAULT '',
  final_content TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);
