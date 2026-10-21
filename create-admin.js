// Creates an admin from the command line, e.g. for the very first admin:
//   node create-admin.js <username> <password>
const bcrypt = require('bcrypt');
const db = require('./db');

const [username, password] = process.argv.slice(2);

if (!username || !password) {
    console.error('Usage: node create-admin.js <username> <password>');
    process.exit(1);
}

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
