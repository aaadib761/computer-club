const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./club.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
    }

})

db.serialize(() => {
    db.run(`PRAGMA foreign_keys = ON;`);


    db.run(`CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT ,
        position TEXT,
        position_rank INTEGER,
        photo_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('Error creating members table:', err.message);
        } else {
            console.log('Members table created or already exists.');
        }
    });

    db.run(`CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT ,
        date DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        
        )`, (err) => {
            if (err) {
                console.error('Error creating events table:', err.message);
            } else {
                console.log('Events table created or already exists.');
            }
        });
     
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (member_id) REFERENCES members(id),
        FOREIGN KEY (event_id) REFERENCES events(id)
        )`, (err) => {
            if (err) {
                console.error('Error creating attendance table:', err.message);
            } else {
                console.log('Attendance table created or already exists.');
            }
        });

    // one attendance record per member per event
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS attendance_member_event ON attendance (member_id, event_id)`, (err) => {
        if (err) console.error('Error creating attendance index:', err.message);
    });
    db.run(`CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('Error creating admins table:', err.message);
        } else {
            console.log('admins table created or already exists.');
        }

    });

    // columns added later for Settings > Security; older databases get them added here
    db.all(`PRAGMA table_info(admins)`, (err, columns) => {
        if (err) return console.error('Error reading admins columns:', err.message);
        const existing = columns.map(c => c.name);
        const wanted = {
            token_version: 'INTEGER NOT NULL DEFAULT 0',  // bumping it logs the admin out everywhere
            last_login_at: 'DATETIME',
            password_changed_at: 'DATETIME',
        };
        db.serialize(() => {
            Object.entries(wanted).forEach(([name, type]) => {
                if (existing.includes(name)) return;
                db.run(`ALTER TABLE admins ADD COLUMN ${name} ${type}`, (err) => {
                    if (err) console.error(`Error adding admins.${name}:`, err.message);
                });
            });
        });
    });

    // club info edited in Settings (contact email, social links...), one row per item
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`, (err) => {
        if (err) console.error('Error creating settings table:', err.message);
    });

    db.run(`CREATE TABLE IF NOT EXISTS join_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        reason TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if  (err) {
                console.error('Error creating join_requests table:',err.message);
            } else {
                console.log('join_requests table created or already exists.');
            }
        });

    db.run(`CREATE TABLE IF NOT EXISTS contact_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
              if (err) {
                console.error('Error creating contact_message table:',err.message);
              } else {
                console.log('contact_messages table created or already exists.');
              }
        });

    db.run(`CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        posted_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('Error creating announcements table:',err.message);
            } else {
                console.log('announcements table created or already exists.');
            }
        });
        
    db.run(`CREATE TABLE IF NOT EXISTS event_photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        photo_path TEXT NOT NULL,
        caption TEXT,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) 
        )`, (err) => {
            if (err) {
                console.error('Error creating event_photos table:',err.message);
            } else {
                console.log('event_photos table created or already exists.');
            }
        });    
});

module.exports = db;