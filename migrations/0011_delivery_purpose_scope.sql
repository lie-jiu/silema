-- 0009 的幂等索引是 UNIQUE(recipient_id, cycle)，但 0010 引入了 purpose 之后，
-- 「警告」和「触发群发」两类投递共用了同一个唯一性命名空间：
--   - 警告入队  cycle = owner.warning_sent_at
--   - 触发入队  cycle = 触发发生的时刻 now
-- 两者正常相隔 warning_hours 小时，不会重合；可一旦 cycle 值撞上，
-- INSERT OR IGNORE 会静默丢弃后插入的那一行 —— 丢掉的若是警告，所有者
-- 就失去了触发前的最后一次自救机会，且没有任何报错。
--
-- 把 purpose 纳入唯一索引，让两类投递各自独立去重：
-- 触发行仍是 (recipient_id, cycle, 'trigger') 唯一，幂等保证不减；
-- 警告行获得自己的命名空间，不再可能被触发行顶掉。
DROP INDEX IF EXISTS idx_deliveries_cycle;
CREATE UNIQUE INDEX idx_deliveries_cycle ON deliveries(recipient_id, cycle, purpose);
