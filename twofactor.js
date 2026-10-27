// 2-step verification for admin logins: 6-digit codes from an authenticator app
// (Google Authenticator, Microsoft Authenticator, Authy...), using the standard TOTP method (RFC 6238),
// plus one-time recovery codes for when the phone is lost. Built on Node's crypto, no extra packages.
const crypto = require('crypto');

const ISSUER = 'NDUB Computer Club';
const STEP_SECONDS = 30;   // a new code every 30 seconds
const DIGITS = 6;
const RECOVERY_CODE_COUNT = 10;

// ---------- base32 (the format authenticator apps expect for the secret) ----------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
    let bits = 0, value = 0, out = '';
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
    return out;
}

function base32Decode(text) {
    let bits = 0, value = 0;
    const bytes = [];
    for (const char of text.replace(/=+$/, '').toUpperCase()) {
        const index = BASE32.indexOf(char);
        if (index === -1) throw new Error('Not a base32 secret');
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

// ---------- codes ----------

function newSecret() {
    return base32Encode(crypto.randomBytes(20));   // 160 bits, the size the standard recommends
}

// what the QR code holds; scanning it adds "NDUB Computer Club (username)" to the app
function otpauthUri(secret, username) {
    const label = encodeURIComponent(`${ISSUER}:${username}`);
    return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

function currentStep(now = Date.now()) {
    return Math.floor(now / 1000 / STEP_SECONDS);
}

function codeAt(secret, step) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 15;
    const number = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
    return String(number).padStart(DIGITS, '0');
}

// Checks a typed code. Accepts the current 30-second window and one either side (phone clocks drift).
// Returns the matching step, or null. A step at or before `lastUsedStep` is refused, so a code that
// was just used (or seen over someone's shoulder) can't be used again.
function checkCode(secret, code, lastUsedStep = -1) {
    const typed = String(code || '').replace(/\s+/g, '');
    if (!new RegExp(`^\\d{${DIGITS}}$`).test(typed)) return null;
    const now = currentStep();
    for (const step of [now - 1, now, now + 1]) {
        if (step <= lastUsedStep) continue;
        const expected = Buffer.from(codeAt(secret, step));
        if (crypto.timingSafeEqual(expected, Buffer.from(typed))) return step;
    }
    return null;
}

// ---------- storing the secret ----------
// Secrets are encrypted before they go in the database, so a leaked database or backup file
// doesn't let anyone make codes. The key comes from JWT_SECRET: if JWT_SECRET ever changes,
// stored secrets can't be read any more and admins need their 2-step login reset (see reset-2fa.js).

function keyFrom(appSecret) {
    return Buffer.from(crypto.hkdfSync('sha256', appSecret, Buffer.alloc(0), 'ndubcc-admin-2fa', 32));
}

function encryptSecret(secret, appSecret) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(appSecret), iv);
    const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

// returns the secret, or null if it can't be read (e.g. JWT_SECRET changed)
function decryptSecret(stored, appSecret) {
    try {
        const [version, iv, tag, data] = String(stored || '').split(':');
        if (version !== 'v1') return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(appSecret), Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    } catch {
        return null;
    }
}

// ---------- recovery codes ----------
// Ten random codes like "k7m2-x9qp-4hrt", each usable once. Only their hashes are stored.

function hashRecoveryCode(code) {
    const clean = String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return crypto.createHash('sha256').update(`ndubcc-recovery:${clean}`).digest('hex');
}

function newRecoveryCodes() {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';   // no 0/o or 1/l/i, which are easy to misread
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
        const chars = Array.from(crypto.randomBytes(12), b => alphabet[b % alphabet.length]).join('');
        return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
    });
    return { codes, hashes: codes.map(hashRecoveryCode) };
}

// returns the remaining hashes if `code` matched one (it's used up), or null
function useRecoveryCode(storedHashes, code) {
    const hashes = Array.isArray(storedHashes) ? storedHashes : [];
    const hash = hashRecoveryCode(code);
    const index = hashes.findIndex(h => crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash)));
    return index === -1 ? null : hashes.filter((_, i) => i !== index);
}

module.exports = {
    newSecret, otpauthUri, checkCode, codeAt, currentStep,
    encryptSecret, decryptSecret, newRecoveryCodes, useRecoveryCode,
};
