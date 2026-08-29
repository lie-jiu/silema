-- 快速签到令牌：邮件/消息里的 {checkin_url} 指向 /c/<token>，点开即签到。
--
-- 用随机串存库而不是 HMAC 自签名，是为了可吊销、可审计：能查到这一条链接
-- 是何时为何生成的、有没有被点过；改密码或怀疑泄露时删表即可全部作废。
-- 代价是发消息时多一次写库，相对消息本身的网络耗时可以忽略。
CREATE TABLE checkin_tokens (
  token TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,          -- 'warning' | 'trigger' | 'test'
  recipient_id INTEGER,           -- 触发群发时是接收人，警告时为空
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,                -- 首次签到时间，仅用于审计，不影响重复点击
  use_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_checkin_tokens_exp ON checkin_tokens(expires_at);
