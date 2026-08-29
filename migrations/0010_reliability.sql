-- Cron 巡检状态（上次运行时间、成功/失败、连续失败次数）。单键 upsert，
-- 成本约 4 行/次 —— cron 每 5 分钟一次，一天约 1.1k 行，可忽略。
CREATE TABLE system_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 区分「警告」与「触发群发」两类投递。警告此前直接发送、完全不落库，
-- 一旦失败没有任何痕迹 —— 而它是所有者避免触发的最后机会。
ALTER TABLE deliveries ADD COLUMN purpose TEXT NOT NULL DEFAULT 'trigger';

-- 按轮次查询投递结果。0009 已把 idx_deliveries_cycle 用作 UNIQUE 索引名。
CREATE INDEX idx_deliveries_cycle_time ON deliveries(cycle DESC, created_at DESC);
