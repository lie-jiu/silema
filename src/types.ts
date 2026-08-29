export type ChannelType = "email" | "telegram" | "bark" | "ntfy" | "serverchan" | "serverchan3" | "webhook";

/* 投递用途：warning = 进入警告期时发给所有者的提醒；trigger = 警告期满后的群发。 */
export type DeliveryPurpose = "warning" | "trigger";

/* cancelled 表示本轮被签到或删除接收人取消 —— 保留该状态而不是删行，
 * 这样投递表同时充当审计日志，失败原因不会被签到抹掉。 */
export type DeliveryStatus = "pending" | "sent" | "failed" | "cancelled";

export const VALID_CHANNELS: ChannelType[] = ["email", "telegram", "bark", "ntfy", "serverchan", "serverchan3", "webhook"];

export interface Bindings {
  DB: D1Database;
  JWT_SECRET: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  APP_BASE_URL?: string;
  CRON_SECRET?: string;
  SEND_EMAIL?: SendEmail;
  /* 外部存活监控。两者都可选，未配置则心跳逻辑整体跳过。
   * HEARTBEAT_FAIL_URL 留空时回退到 HEARTBEAT_URL + "/fail"（Healthchecks.io 约定）。 */
  HEARTBEAT_URL?: string;
  HEARTBEAT_FAIL_URL?: string;
}

export interface Message {
  title?: string;
  body: string;
  imageUrl?: string;
}

export interface OwnerRow {
  id: number;
  totp_secret: string;
  timezone: string;
  expiry_hours: number;
  warning_hours: number;
  state: "normal" | "warning" | "triggered";
  last_checkin_at: number | null;
  warning_sent_at: number | null;
  triggered_at: number | null;
  session_epoch: number;
}

export interface RecipientRow {
  id: number;
  label: string;
  channel_type: ChannelType;
  config_json: string;
  on_warning: number;
  on_trigger: number;
  created_at: number;
}

export interface DeliveryRow {
  id: number;
  recipient_id: number;
  status: DeliveryStatus;
  purpose: DeliveryPurpose;
  cycle: number;
  attempts: number;
  last_error: string | null;
  created_at: number;
  sent_at: number | null;
  last_attempt_at: number | null;
}
