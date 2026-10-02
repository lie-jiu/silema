import { sha256Hex } from "./util";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉易混字符 I O 0 1

export function formatCode(raw: string): string {
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/** 10 个一次性恢复码；明文只在生成那次响应里出现，库里只存哈希（README「端点 · 认证」）。 */
export function generateBackupCodes(): string[] {
  return Array.from({ length: 10 }, () =>
    formatCode(
      Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => ALPHABET[b % ALPHABET.length]!).join(
        "",
      ),
    ),
  );
}

export async function hashBackupCodes(codes: string[]): Promise<string> {
  return JSON.stringify(await Promise.all(codes.map((code) => sha256Hex(normalize(code)))));
}

function normalize(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

/** 返回被消费的哈希；命中即由调用方从数组里移除。 */
export async function matchBackupCode(
  storedJson: string | null,
  code: string,
): Promise<{ hash: string; remaining: number } | null> {
  const hashes = parse(storedJson);
  if (hashes.length === 0) return null;
  const target = await sha256Hex(normalize(code));
  if (!hashes.includes(target)) return null;
  return { hash: target, remaining: hashes.length - 1 };
}

export function removeCode(storedJson: string | null, hash: string): string | null {
  const next = parse(storedJson).filter((h) => h !== hash);
  return next.length > 0 ? JSON.stringify(next) : null;
}

export function backupCodeCount(storedJson: string | null): number {
  return parse(storedJson).length;
}

function parse(storedJson: string | null): string[] {
  if (!storedJson) return [];
  try {
    const v = JSON.parse(storedJson);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
