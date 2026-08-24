export type ChannelType = "email" | "telegram" | "bark" | "ntfy" | "serverchan" | "serverchan3" | "webhook";

export const VALID_CHANNELS: ChannelType[] = ["email", "telegram", "bark", "ntfy", "serverchan", "serverchan3", "webhook"];

export interface Bindings {
  DB: D1Database;
  IMG: R2Bucket;
  JWT_SECRET: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  APP_BASE_URL?: string;
  CRON_SECRET?: string;
  SEND_EMAIL?: SendEmail;
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
  status: "pending" | "sent" | "failed";
  attempts: number;
  last_error: string | null;
  created_at: number;
  sent_at: number | null;
  last_attempt_at: number | null;
}
