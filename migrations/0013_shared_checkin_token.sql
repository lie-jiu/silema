-- 签到令牌改为「一次事件一条」。
--
-- 0012 的令牌是在每个频道的发送循环里各自生成的：配了 N 个警告通道，一次
-- 警告就造出 N 条互不相同的链接，所有者同时收到 N 个互不相干的入口。而令牌
-- 是一次性的 —— 点过其中一条，其余全部变成「已使用」，等于一次警告白扔了
-- N-1 条链接，还让人怀疑「是不是点错了」。
--
-- 现在按事件（cycle）预先生成一条，所有频道的 {checkin_url} 只读这一条：
--   · 警告：cycle = warning_sent_at
--   · 触发：cycle = 触发时刻（deliveries.cycle）
--   · 测试：cycle = 发送时刻
-- 重试时用 getOrIssueSharedToken 按 cycle 查回同一条，不会每重试一次就换一个
-- 入口。一次性语义不变：首次签到即作废，其余入口统一显示「已使用」。

ALTER TABLE checkin_tokens ADD COLUMN cycle INTEGER;

-- 按 (purpose, cycle) 查回本轮共用的那一条。
CREATE INDEX idx_checkin_tokens_cycle ON checkin_tokens(purpose, cycle);

-- recipient_id 停止写入：令牌是全体接收人共用的，不再属于某一个人。
-- 列保留以免破坏存量数据，语义上作废。
