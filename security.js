// Password rules and login lockouts, shared by server.js and create-admin.js.

const MIN_PASSWORD_LENGTH = 8;

// Passwords that appear at the top of every leaked-password list (8+ characters, since shorter ones
// are already refused), plus a few local favourites. Checked without caring about capital letters.
const COMMON_PASSWORDS = new Set([
    'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssword', 'p@ssw0rd',
    'pass1234', 'mypassword', 'newpassword', 'changeme', 'changeme1', 'letmein1', 'welcome1', 'welcome123',
    '12345678', '123456789', '1234567890', '0123456789', '87654321', '11111111', '00000000', '12341234',
    '11223344', '12121212', '123123123', '1q2w3e4r', '1q2w3e4r5t', 'q1w2e3r4', 'qwertyui', 'qwertyuiop',
    'qwerty123', 'qwerty12', 'asdfghjk', 'asdfghjkl', 'zxcvbnm1', 'zxcvbnma', 'iloveyou', 'iloveyou1',
    'sunshine', 'princess', 'football', 'baseball', 'superman', 'batman123', 'starwars', 'trustno1',
    'whatever', 'computer', 'internet', 'shadow123', 'master123', 'dragon123', 'monkey123', 'abc12345',
    'abcd1234', 'abcdefgh', 'aa123456', 'a1234567', 'admin123', 'admin1234', 'administrator', 'adminadmin',
    'root1234', 'test1234', 'testtest', 'guest123', 'user1234', 'login123', 'secret123', 'default1',
    'bangladesh', 'bangladesh1', 'bangladesh123', 'dhaka123', 'dhaka1234', 'ndub1234', 'ndub12345',
    'ndubcc123', 'ndubcc1234', 'computerclub', 'computer123', 'student123', 'university',
]);

// Returns an error message, or null if the password is fine. `personal` lists things the password
// shouldn't contain, like the username or club ID.
function passwordProblem(password, { field = 'password', personal = [] } = {}) {
    if (typeof password !== 'string') return `${field} is required.`;
    if (password.length < MIN_PASSWORD_LENGTH) return `${field} must be at least ${MIN_PASSWORD_LENGTH} characters`;
    // bcrypt only uses the first 72 bytes of a password, so longer ones are refused
    if (Buffer.byteLength(password) > 72) return `${field} must be at most 72 characters.`;

    const lower = password.toLowerCase();
    const easy = `${field} is too easy to guess. Try a few unrelated words, or mix letters, numbers and symbols.`;
    if (COMMON_PASSWORDS.has(lower)) return easy;
    if (/^(.)\1+$/.test(lower)) return easy;                               // aaaaaaaa
    if (isSequence(lower)) return easy;                                     // 23456789, abcdefgh, 98765432
    if (/^(.{1,4})\1+$/.test(lower)) return easy;                           // abcabcabc, 12121212
    const name = personal.map(p => String(p || '').toLowerCase()).find(p => p.length >= 3 && lower.includes(p));
    if (name) return `${field} can't contain your username or ID.`;
    return null;
}

// every character is one step up (or down) from the one before, like 12345678 or hgfedcba
function isSequence(text) {
    const steps = new Set();
    for (let i = 1; i < text.length; i++) steps.add(text.charCodeAt(i) - text.charCodeAt(i - 1));
    return steps.size === 1 && (steps.has(1) || steps.has(-1));
}

// Locks a login name for a while after too many wrong passwords in a row, so nobody can keep guessing
// one account's password from many different IP addresses (the per-IP rate limit can't stop that).
// It counts any name typed, real or not, so the answers don't reveal which accounts exist.
// Kept in memory: a server restart clears it, which is fine for lockouts measured in minutes.
class LoginLockout {
    constructor({ maxFailures = 5, lockMinutes = 15 } = {}) {
        this.maxFailures = maxFailures;
        this.lockMs = lockMinutes * 60 * 1000;
        this.entries = new Map();   // name -> { failures, lockedUntil }
    }

    key(name) {
        return String(name || '').trim().toLowerCase().slice(0, 100);
    }

    // minutes left if this name is locked right now, otherwise 0
    minutesLeft(name) {
        const entry = this.entries.get(this.key(name));
        if (!entry || !entry.lockedUntil) return 0;
        const left = entry.lockedUntil - Date.now();
        if (left <= 0) {
            this.entries.delete(this.key(name));
            return 0;
        }
        return Math.ceil(left / 60000);
    }

    // records a wrong password; returns true if this failure just locked the name
    fail(name) {
        this.prune();
        const key = this.key(name);
        const entry = this.entries.get(key) || { failures: 0, lockedUntil: 0 };
        entry.failures += 1;
        entry.lastFailure = Date.now();
        const locked = entry.failures >= this.maxFailures;
        if (locked) {
            entry.failures = 0;
            entry.lockedUntil = Date.now() + this.lockMs;
        }
        this.entries.set(key, entry);
        return locked;
    }

    succeed(name) {
        this.entries.delete(this.key(name));
    }

    // forget entries that have been quiet for a whole lock period, so the map can't grow without limit;
    // recent ones stay, so typing lots of made-up names can't wipe a real account's failure count
    prune() {
        if (this.entries.size < 1000) return;
        const quietSince = Date.now() - this.lockMs;
        for (const [key, entry] of this.entries) {
            if (entry.lockedUntil < Date.now() && entry.lastFailure < quietSince) this.entries.delete(key);
        }
    }
}

module.exports = { MIN_PASSWORD_LENGTH, passwordProblem, LoginLockout };
