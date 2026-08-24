// Length is leaked by naive constant-time compares that early-return on a
// size mismatch. Hashing both inputs first normalizes lengths, so the
// comparison itself leaks nothing about the plaintext (SHA-256 collisions are
// irrelevant here — the digest is compared in constant time).
export async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const ab = new Uint8Array(da);
  const bb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}
