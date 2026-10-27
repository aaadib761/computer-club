// Creates an admin from the command line, e.g. for the very first admin:
//   node create-admin.js <username> <password>
const bcrypt = require('bcrypt');
const { passwordProblem } = require('./security');

const [username, password] = process.argv.slice(2);

if (!username || !password) {
    console.error('Usage: node create-admin.js <username> <password>');
    process.exit(1);
}
if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
    console.error('Username must be 3-50 characters: letters, numbers, dots, dashes or underscores.');
    process.exit(1);
}
const problem = passwordProblem(password, { field: 'Password', personal: [username] });
if (problem) {
    console.error(problem);
    process.exit(1);
}

// opened only after the checks, so a refused password doesn't touch the database
const db = require('./db');

bcrypt.hash(password, 10).then((hashedPassword) => {
    db.serialize(() => {
        db.run(`INSERT INTO admins (username, password) VALUES (?, ?)`, [username, hashedPassword], function (err) {
            if (err) {
                console.error('Error creating admin:', err.message);
                process.exitCode = 1;
            } else {
                console.log(`Admin "${username}" created.`);
            }
            db.close();
        });
    });
});
