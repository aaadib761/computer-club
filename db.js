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

    // columns added after the first version; older databases get them added here
    addMissingColumns('admins', {
        token_version: 'INTEGER NOT NULL DEFAULT 0',  // bumping it logs the admin out everywhere
        last_login_at: 'DATETIME',
        password_changed_at: 'DATETIME',
        role: "TEXT NOT NULL DEFAULT 'owner'",  // owner, editor or checkin; admins from before roles existed are owners
        // 2-step verification (see twofactor.js); secrets are stored encrypted
        totp_secret: 'TEXT',          // set once 2-step login is turned on
        totp_pending: 'TEXT',         // during setup, until the first code is confirmed
        totp_enabled_at: 'DATETIME',
        totp_last_step: 'INTEGER',    // the last code's time window, so a code can't be used twice
        recovery_codes: 'TEXT',       // JSON list of hashed one-time recovery codes
    });
    addMissingColumns('members', {
        student_id: 'TEXT',
        club_id: 'TEXT',
        batch: 'TEXT',
        department: 'TEXT',
        fee_paid: 'INTEGER NOT NULL DEFAULT 0',  // one-time membership fee: 1 = paid
        fee_paid_at: 'DATETIME',
        fee_note: 'TEXT',                        // e.g. receipt number or who collected it
        portal_password: 'TEXT',                 // bcrypt hash; empty until the member sets up the member portal
        portal_token_version: 'INTEGER NOT NULL DEFAULT 0',  // bumping it logs the member out everywhere
        portal_last_login_at: 'DATETIME',
    }, () => {
        // no two members can share a student or club ID (empty ones are allowed to repeat)
        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS members_student_id ON members (student_id)`, (err) => {
            if (err) console.error('Error creating student_id index:', err.message);
        });
        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS members_club_id ON members (club_id)`, (err) => {
            if (err) console.error('Error creating club_id index:', err.message);
        });
    });
    addMissingColumns('join_requests', { student_id: 'TEXT', batch: 'TEXT', department: 'TEXT', photo_path: 'TEXT' });
    addMissingColumns('events', {
        category: 'TEXT',       // Seminar, Workshop, Contest...
        speaker: 'TEXT',        // resource person
        speaker_title: 'TEXT',  // e.g. "Lecturer, Department of CSE"
        venue: 'TEXT',
        duration: 'TEXT',       // e.g. "1.5 hours"
        registration_open: 'INTEGER NOT NULL DEFAULT 0',  // 1 = members can register online
        capacity: 'INTEGER',    // seat limit for registration (empty = no limit)
        certificates: 'INTEGER NOT NULL DEFAULT 1',  // 1 = attendees get a participation certificate (emailed after the event)
    });
    // when each attendee's certificate was emailed, so nobody gets it twice
    addMissingColumns('attendance', { certificate_sent_at: 'DATETIME' });

    // members who registered for an event online (one registration per member per event)
    db.run(`CREATE TABLE IF NOT EXISTS event_registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        member_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (event_id, member_id),
        FOREIGN KEY (event_id) REFERENCES events(id),
        FOREIGN KEY (member_id) REFERENCES members(id)
    )`, (err) => {
        if (err) console.error('Error creating event_registrations table:', err.message);
    });

    // faculty advisors and moderators shown on the About page
    db.run(`CREATE TABLE IF NOT EXISTS advisors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        designation TEXT,
        message TEXT,
        photo_path TEXT,
        profile_url TEXT,
        sort_order INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error('Error creating advisors table:', err.message);
    });

    // who changed what in the admin panel (owners read it on the Activity page)
    // admin_username is copied in, so entries still make sense after an admin is renamed or removed
    db.run(`CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER,
        admin_username TEXT,
        area TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error('Error creating activity_log table:', err.message);
    });

    // snapshots of past committees: the term name plus a frozen list of who held which position
    db.run(`CREATE TABLE IF NOT EXISTS committee_archive (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        term TEXT NOT NULL,
        members_json TEXT NOT NULL,
        archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error('Error creating committee_archive table:', err.message);
    });
});

// Adds any columns from `wanted` that the table doesn't have yet, then calls `done`.
function addMissingColumns(table, wanted, done) {
    db.all(`PRAGMA table_info(${table})`, (err, columns) => {
        if (err) return console.error(`Error reading ${table} columns:`, err.message);
        const existing = columns.map(c => c.name);
        db.serialize(() => {
            Object.entries(wanted).forEach(([name, type]) => {
                if (existing.includes(name)) return;
                db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`, (err) => {
                    if (err) console.error(`Error adding ${table}.${name}:`, err.message);
                });
            });
            if (done) done();
        });
    });
}

module.exports = db;