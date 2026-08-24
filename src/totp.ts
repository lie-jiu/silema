function base32Decode(encoded: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = encoded.replace(/[^A-Z2-7]/gi, "").toUpperCase();
  let bits = "";
  for (const char of cleaned) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

async function hmacSHA1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data);
  return new Uint8Array(sig);
}

async function generateCode(secret: string, counter: number): Promise<string> {
  const key = base32Decode(secret);
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter & 0xffffffff);
  const data = new Uint8Array(buf);

  const hash = await hmacSHA1(key, data);
  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  return String(code % 1000000).padStart(6, "0");
}


async function matchCode(secret: string, token: string): Promise<number | null> {
  if (!token || token.length !== 6 || !/^\d{6}$/.test(token)) return null;
  const now = Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / 30);
  for (const delta of [-1, 0, 1]) {
    const slice = counter + delta;
    const expected = await generateCode(secret, slice);
    if (token === expected) return slice;
  }
  return null;
}

export async function verifyTOTP(secret: string, token: string): Promise<boolean> {
  return (await matchCode(secret, token)) !== null;
}

