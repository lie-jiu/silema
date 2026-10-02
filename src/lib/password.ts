import { b64url, constantTimeEqual, unb64url } from "./util";

const ENC = new TextEncoder();
/**
 * workd 的 WebCrypto 对 PBKDF2 有硬上限：超过 100000 轮直接抛
 * `Pbkdf2 failed: iteration counts above 100000 are not supported`。
 * 本地 miniflare 用的是 Node 的 WebCrypto，没有这个上限，所以只有在真机上才会暴露。
 * 10 万轮低于 OWASP 对 PBKDF2-SHA256 的当前建议，补偿是这道口令永远不单独生效：
 * 必须同时有 TOTP（或恢复码），且登录按 IP 限流 10 次/15 分钟。
 */
const ITERATIONS = 100_000;

/**
 * `ADMIN_PASSWORD_HASH` 的自描述格式：`pbkdf2$<iterations>$<saltB64>$<hashB64>`。
 * Workers 无原生 bcrypt/argon2id，纯 JS 实现会打爆 CPU 配额，故用 WebCrypto PBKDF2-SHA256；
 * 前缀自描述意味着将来换 argon2id（WASM）不需要改调用方。
 */
async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ENC.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as ArrayBuffer, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  if (!stored) return false;
  const [algo, iterRaw, saltRaw, hashRaw] = stored.split("$");
  if (algo !== "pbkdf2" || !iterRaw || !saltRaw || !hashRaw) return false;
  const expected = await derive(password, unb64url(saltRaw), Number(iterRaw));
  return constantTimeEqual(b64url(expected), hashRaw);
}
