// Generates the owner row SQL for initial deployment.
// Username/password are NOT stored in the database anymore — they live in
// Cloudflare Worker secrets (ADMIN_USERNAME / ADMIN_PASSWORD, set via
// `wrangler secret put`). This script only seeds the TOTP secret and defaults.
// Usage: node scripts/init-owner.cjs > seed.sql
const crypto = require('crypto');

function base32Encode(buf) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let result = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    result += chars[parseInt(chunk, 2)];
  }
  return result;
}

const totpSecret = base32Encode(crypto.randomBytes(20));

console.log('========================================');
console.log('  TOTP SECRET (shown once — save it!)');
console.log('========================================');
console.log('TOTP Secret:    ' + totpSecret);
console.log('========================================');
console.log('');
console.log('Then set the login credentials as Worker secrets:');
console.log('  npx wrangler secret put ADMIN_USERNAME');
console.log('  npx wrangler secret put ADMIN_PASSWORD');
console.log('');

const esc = (s) => s.replace(/'/g, "''");
const sql =
  `INSERT INTO owner (id, totp_secret, timezone, expiry_hours, warning_hours)\n` +
  `VALUES (1, '${esc(totpSecret)}', 'Asia/Shanghai', 24, 12);`;

console.log(sql);
