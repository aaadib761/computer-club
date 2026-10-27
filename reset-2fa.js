// Emergency: turns off 2-step login for an admin, from the command line on the server.
// Use it only when nobody can do it from Settings (every owner lost their phone and recovery codes,
// or JWT_SECRET was changed so the stored codes can't be read):
//   node reset-2fa.js <username>
// The admin is logged out everywhere and can then log in with just their password.
const [username] = process.argv.slice(2);

if (!username) {
    console.error('Usage: node reset-2fa.js <username>');
    process.exit(1);
}

const db = require('./db');

db.serialize(() => {
    db.run(`UPDATE admins SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_step = NULL,
        recovery_codes = NULL, token_version = token_version + 1 WHERE username = ?`, [username], function (err) {
        if (err) {
            // the 2-step columns are added when the server starts, so a database from before this feature lacks them
            console.error(/no such column/.test(err.message)
                ? 'This database has no 2-step login data yet. Start the server once, then try again.'
                : `Error resetting 2-step login: ${err.message}`);
            process.exitCode = 1;
            return db.close();
        }
        if (this.changes === 0) {
            console.error(`No admin is called "${username}".`);
            process.exitCode = 1;
            return db.close();
        }
        console.log(`2-step login is off for "${username}". They can log in with their password and turn it on again in Settings.`);
        // written to the activity log too, so owners can see it happened
        db.run(`INSERT INTO activity_log (admin_username, area, action, details) VALUES (?, 'admins', 'Reset 2-step login', 'from the command line (reset-2fa.js)')`,
            [username], () => db.close());
    });
});
