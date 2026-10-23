require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const db = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = express();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const UPLOAD_TYPE_ERROR = 'Only JPEG, PNG, and WEBP images are allowed';
const INVALID_IMAGE_ERROR = "That file isn't a valid image.";
// the saved file's extension comes from the type we accept, never from the uploader's file name
const IMAGE_EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const UniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + IMAGE_EXTENSIONS[file.mimetype];
        cb(null, UniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024, files: 1 }, // one image, 5MB max
    fileFilter: (req, file, cb) => {
        if (IMAGE_EXTENSIONS[file.mimetype]) {
            cb(null, true);
        } else {
            cb(new Error(UPLOAD_TYPE_ERROR));
        }
    }
});

const PORT = process.env.PORT || 3000 ;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET ;
if (!JWT_SECRET) {
    console.error('JWT_SECRET is not set. Add it to your .env file.');
    process.exit(1);
}
// a short secret can be guessed, which would let someone forge admin logins
if (JWT_SECRET.length < 32) {
    const advice = 'JWT_SECRET should be at least 32 random characters. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"';
    if (IS_PRODUCTION) {
        console.error(advice);
        process.exit(1);
    }
    console.warn('Warning: ' + advice);
}
// behind a host's proxy (Render, Railway, nginx...), set TRUST_PROXY=1 so rate limits see each visitor's real IP
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
const loginLimiter = rateLimit({ 
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many Login attempts. Please try again later.' }
});
// each public form gets its own counter, so one form can't use up the other's limit
const formLimiter = () => rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many submissions. Please try again later.' }
});
const MIN_PASSWORD_LENGTH = 8;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

// Checks request fields against simple rules and returns an error message (or null if fine).
// With partial: true (edits), fields that weren't sent are skipped.
function checkFields(body, rules, { partial = false } = {}) {
    for (const [field, rule] of Object.entries(rules)) {
        const value = body[field];
        if (value === undefined && partial) continue;
        const empty = value === undefined || value === null || (typeof value === 'string' && !value.trim());
        if (empty) {
            if (rule.required) return `${field} is required.`;
            continue;
        }
        if (typeof value !== 'string') return `${field} must be text.`;
        if (rule.max && value.length > rule.max) return `${field} must be at most ${rule.max} characters.`;
        if (rule.email && !EMAIL_PATTERN.test(value)) return `${field} must be a valid email address.`;
        if (rule.date && !DATE_PATTERN.test(value)) return `${field} must look like 2026-11-15 or 2026-11-15T15:00.`;
    }
    return null;
}

const MEMBER_RULES = {
    name: { required: true, max: 100 },
    email: { required: true, max: 150, email: true },
    phone: { max: 30 },
    position: { max: 60 },
};
const EVENT_RULES = {
    title: { required: true, max: 120 },
    description: { max: 3000 },
    date: { required: true, date: true },
};
const ANNOUNCEMENT_RULES = {
    title: { required: true, max: 150 },
    body: { required: true, max: 3000 },
};

// usernames appear in URLs (DELETE /admin/:username), so keep them simple
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,50}$/;
const USERNAME_ERROR = 'Username must be 3-50 characters: letters, numbers, dots, dashes or underscores.';

// bcrypt only uses the first 72 bytes of a password, so longer ones are refused
function checkPassword(password, field = 'password') {
    if (typeof password !== 'string') return `${field} is required.`;
    if (password.length < MIN_PASSWORD_LENGTH) return `${field} must be at least ${MIN_PASSWORD_LENGTH} characters`;
    if (Buffer.byteLength(password) > 72) return `${field} must be at most 72 characters.`;
    return null;
}

function checkRank(value) {
    if (value === undefined || value === null || value === '') return null;
    const rank = Number(value);
    return Number.isInteger(rank) && rank >= 1 && rank <= 999 ? null : 'position_rank must be a whole number from 1 to 999.';
}

function verifyAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Authorization header missing' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token missing' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });

        // the token can outlive the account, so make sure the admin still exists
        db.get(`SELECT id, username, token_version FROM admins WHERE id = ?`, [user.id], (err, admin) => {
            if (err) {
                console.error('Error verifying admin:', err.message);
                return res.status(500).json({ error: 'Failed to verify admin' });
            }
            if (!admin) return res.status(401).json({ error: 'Admin account no longer exists' });
            // "log out everywhere" and password changes bump token_version, which retires older tokens
            if ((user.tv || 0) !== admin.token_version) {
                return res.status(401).json({ error: 'Session ended. Please log in again.' });
            }

            req.user = admin;
            next();
        });
    })
}

function signAdminToken(admin) {
    return jwt.sign({ id: admin.id, username: admin.username, tv: admin.token_version || 0 }, JWT_SECRET, { expiresIn: '1h' });
}

function removeFile(filePath) {
    if (!filePath) return;
    fs.unlink(filePath, (err) => {
        if (err && err.code !== 'ENOENT') console.error('Error removing file:', err.message);
    });
}

const WATERMARK_TEXT = 'NDUB Computer Club';

// Saves an uploaded image: turns phone photos the right way up, drops hidden
// metadata (like GPS location), and adds the club watermark if asked.
async function processImage(inputPath, outputPath, { watermark = false } = {}) {
    const image = sharp(inputPath).rotate();
    if (watermark) {
        const { width, height, orientation } = await sharp(inputPath).metadata();
        // EXIF orientations 5-8 mean the photo is turned sideways, so width and height swap
        const [w, h] = orientation >= 5 ? [height, width] : [width, height];
        // size by the longer side so tall and wide photos get the same size text
        const fontSize = Math.max(16, Math.round(Math.max(w, h) * 0.025));
        const svgText = `
            <svg width="${w}" height="${h}">
                <text x="${w - fontSize * 0.6}" y="${h - fontSize * 0.6}"
                    font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold"
                    fill="white" fill-opacity="0.75" stroke="black" stroke-opacity="0.25" stroke-width="1"
                    text-anchor="end">${WATERMARK_TEXT}</text>
            </svg>`;
        image.composite([{ input: Buffer.from(svgText) }]);
    }
    await image.toFile(outputPath);
}

// Security headers. The Content-Security-Policy only lets the browser run our own
// script files (no inline or injected scripts) and load fonts from Google Fonts.
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            // only force https once the site is actually served over https
            upgradeInsecureRequests: IS_PRODUCTION ? [] : null,
        },
    },
    strictTransportSecurity: IS_PRODUCTION,
}));

// small JSON bodies only; nothing here needs more than a few KB
app.use(express.json({ limit: '50kb' }));
app.use('/uploads', express.static('uploads'));
// the website; pages keep their .html extension so they never clash with API routes like /events
app.use(express.static('public'));

// members

app.post('/members', verifyAdmin, (req, res) => {
    const { name, email, phone, position, position_rank } = req.body;
    const invalid = checkFields(req.body, MEMBER_RULES) || checkRank(position_rank);
    if (invalid) return res.status(400).json({ error: invalid });
    const query = `INSERT INTO members (name, email, phone, position, position_rank) VALUES (?, ?, ?, ?, ?)`;
    db.run(query, [name, email, phone, position || null, position_rank || null], function (err) {
        if (err && err.message.includes('UNIQUE')) {
            res.status(409).json({ error: 'A member with this email already exists.' });
        } else if (err) {
            console.error('Error inserting member:', err.message);
            res.status(500).json({ error: 'Failed to add member' });
        } else {
            res.status(201).json({ id: this.lastID, name, email, phone, position, position_rank });
        }
    });
});

app.post('/members/:id/photo', verifyAdmin, upload.single('photo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Failed to upload the image.' });

    const originalPath = req.file.path;
    // member portraits stay clean: no watermark
    const photoPath = 'uploads/photo-' + req.file.filename;

    try {
        await processImage(originalPath, photoPath);
    } catch (err) {
        // sharp can't read it, so it isn't really an image (whatever its name says)
        console.error('Error processing image:', err.message);
        removeFile(originalPath);
        return res.status(400).json({ error: INVALID_IMAGE_ERROR });
    }
    removeFile(originalPath);

    db.get(`SELECT photo_path FROM members WHERE id = ?`, [req.params.id], (err, existing) => {
        if (err) {
            console.error('Error fetching member:', err.message);
            removeFile(photoPath);
            return res.status(500).json({ error: 'Failed to save photo.' });
        }
        if (!existing) {
            removeFile(photoPath);
            return res.status(404).json({ error: 'Member not found' });
        }

        db.run(`UPDATE members SET photo_path = ? WHERE id = ?`, [photoPath, req.params.id], function (err) {
            if (err) {
                console.error('Error saving photo path:', err.message);
                removeFile(photoPath);
                res.status(500).json({ error: 'Failed to save photo.' });
            } else {
                removeFile(existing.photo_path);
                res.status(200).json({ id: req.params.id, photo_path: photoPath });
            }
        });
    });
});

app.delete('/members/:id/photo', verifyAdmin, (req, res) => {
    db.get(`SELECT photo_path FROM members WHERE id = ?`, [req.params.id], (err, existing) => {
        if (err) {
            console.error('Error fetching member:', err.message);
            return res.status(500).json({ error: 'Failed to remove photo.' });
        }
        if (!existing) return res.status(404).json({ error: 'Member not found' });
        if (!existing.photo_path) return res.status(404).json({ error: 'Member has no photo' });

        db.run(`UPDATE members SET photo_path = NULL WHERE id = ?`, [req.params.id], (err) => {
            if (err) {
                console.error('Error removing photo path:', err.message);
                res.status(500).json({ error: 'Failed to remove photo.' });
            } else {
                removeFile(existing.photo_path);
                res.status(200).json({ message: 'Photo removed.' });
            }
        });
    });
});

app.get('/members', verifyAdmin, (req, res) => {
    // committee members first (by rank), then everyone else by name
    const query = `SELECT * FROM members ORDER BY position_rank IS NULL, position_rank, name COLLATE NOCASE`;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching members:', err.message);
            res.status(500).json({ error: 'Failed to fetch members' });
        } else {
            res.status(200).json(rows);
        }
    });
});

// public route, so only expose what the website shows (no email or phone)
app.get('/members/executive', (req, res) => {
    const query = `SELECT id, name, position, position_rank, photo_path FROM members WHERE position_rank IS NOT NULL ORDER BY position_rank ASC`;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching executive members:', err.message);
            res.status(500).json({ error: 'Failed to fetch executive members' });
        } else {
            res.status(200).json(rows);
        }
    });
});

app.get('/members/:id', verifyAdmin, (req, res) => {
    db.get(`SELECT * FROM members WHERE id = ?`, [req.params.id], (err, row) => {
        if (err) {
            console.error('Error fetching member:', err.message);
            res.status(500).json({ error: 'Failed to fetch member' });
        } else if (!row) {
            res.status(404).json({ error: 'Member not found' });
        } else {
            res.status(200).json(row);
        }
    });
});


app.put('/members/:id', verifyAdmin, (req, res) => {
    const memberId = req.params.id;
    const invalid = checkFields(req.body, MEMBER_RULES, { partial: true }) || checkRank(req.body.position_rank);
    if (invalid) return res.status(400).json({ error: invalid });

    db.get(`SELECT * FROM members WHERE id = ?`, [memberId], (err, existing) => {
        if (err) {
            console.error('Error fetching member:', err.message);
            return res.status(500).json({ error: 'Failed to fetch member' });
        }
        if (!existing) {
            return res.status(404).json({ error: 'Member not found' });
        }

        const name = req.body.name !== undefined ? req.body.name : existing.name;
        const email = req.body.email !== undefined ? req.body.email : existing.email;
        const phone = req.body.phone !== undefined ? req.body.phone : existing.phone;
        const position = req.body.position !== undefined ? req.body.position : existing.position;
        const position_rank = req.body.position_rank !== undefined ? req.body.position_rank : existing.position_rank;

        const query = `UPDATE members SET name = ?, email = ?, phone = ?, position = ?, position_rank = ? WHERE id = ?`;
        db.run(query, [name, email, phone, position, position_rank, memberId], function (err) {
            if (err && err.message.includes('UNIQUE')) {
                res.status(409).json({ error: 'A member with this email already exists.' });
            } else if (err) {
                console.error('Error updating member:', err.message);
                res.status(500).json({ error: 'Failed to update member' });
            } else {
                res.status(200).json({ id: memberId, name, email, phone, position, position_rank });
            }
        });
    });
});

app.delete('/members/:id', verifyAdmin, (req, res) => {
    const memberId = req.params.id;

    db.get(`SELECT photo_path FROM members WHERE id = ?`, [memberId], (err, existing) => {
        if (err) {
            console.error('Error fetching member:', err.message);
            return res.status(500).json({ error: 'Failed to delete member' });
        }
        if (!existing) return res.status(404).json({ error: 'member not found.' });

        // attendance rows reference the member, so they have to go first
        db.run(`DELETE FROM attendance WHERE member_id = ?`, [memberId], (err) => {
            if (err) {
                console.error('Error deleting member attendance:', err.message);
                return res.status(500).json({ error: 'Failed to delete member' });
            }
            db.run(`DELETE FROM members WHERE id = ?`, [memberId], function (err) {
                if (err) {
                    console.error('Error deleting member:', err.message);
                    res.status(500).json({ error: 'Failed to delete member' });
                } else {
                    removeFile(existing.photo_path);
                    res.status(200).json({ message: 'member deleted.' });
                }
            });
        });
    });
});

// events

app.post('/events', verifyAdmin, (req, res) => {
    const { title, description, date } = req.body;
    const invalid = checkFields(req.body, EVENT_RULES);
    if (invalid) return res.status(400).json({ error: invalid });
    const query = `INSERT INTO events (title, description, date) Values (?, ?, ?)`;
    db.run(query, [title, description, date], function (err) {
        if (err) {
            console.error('Error inserting event:', err.message);
            res.status(500).json({ error: 'Failed to add event' });
        } else {
            res.status(201).json({ id: this.lastID, title, description, date });
        }
    });
});

app.get('/events', (req, res) => {
    const query = `Select * From events`;
    db.all(query, [], (err, rows) => {
        if (err) {

            const errorMessage = 'Error fetching events: ' + err.message;
            console.error(errorMessage);
            res.status(500).json({ error: 'Failed to fetch events' });
        } else {
            res.status(200).json(rows);
        }
    });
});

app.get('/events/:id', (req, res) => {
    db.get(`SELECT * FROM events WHERE id = ?`, [req.params.id], (err, row) => {
        if (err) {
            console.error('Error fetching event:', err.message);
            res.status(500).json({ error: 'Failed to fetch event' });
        } else if (!row) {
            res.status(404).json({ error: 'Event not found' });
        } else {
            res.status(200).json(row);
        }
    });
});

app.put('/events/:id', verifyAdmin, (req, res) => {
    const eventId = req.params.id;
    const invalid = checkFields(req.body, EVENT_RULES, { partial: true });
    if (invalid) return res.status(400).json({ error: invalid });

    db.get(`SELECT * FROM events WHERE id = ?`, [eventId], (err, existing) => {
        if (err) {
            console.error('Error fetching event:', err.message);
            return res.status(500).json({ error: 'Failed to fetch event' });
        }
        if (!existing) {
            return res.status(404).json({ error: 'Event not found' });
        }

        const title = req.body.title !== undefined ? req.body.title : existing.title;
        const description = req.body.description !== undefined ? req.body.description : existing.description;
        const date = req.body.date !== undefined ? req.body.date : existing.date;

        const query = `UPDATE events SET title = ?, description = ?, date = ? WHERE id = ?`;
        db.run(query, [title, description, date, eventId], function (err) {
            if (err) {
                console.error('Error updating event:', err.message);
                res.status(500).json({ error: 'Failed to update event' });
            } else {
                res.status(200).json({ id: eventId, title, description, date });

            }
        });
    });
});

app.delete('/events/:id', verifyAdmin, (req, res) => {
    const eventId = req.params.id;

    db.get(`SELECT id FROM events WHERE id = ?`, [eventId], (err, existing) => {
        if (err) {
            console.error('Error fetching event:', err.message);
            return res.status(500).json({ error: 'Failed to delete event.' });
        }
        if (!existing) return res.status(404).json({ error: 'event not found' });

        db.all(`SELECT photo_path FROM event_photos WHERE event_id = ?`, [eventId], (err, photos) => {
            if (err) {
                console.error('Error fetching event photos:', err.message);
                return res.status(500).json({ error: 'Failed to delete event.' });
            }
            // attendance and photo rows reference the event, so they have to go first
            db.run(`DELETE FROM attendance WHERE event_id = ?`, [eventId], (err) => {
                if (err) {
                    console.error('Error deleting event attendance:', err.message);
                    return res.status(500).json({ error: 'Failed to delete event.' });
                }
                db.run(`DELETE FROM event_photos WHERE event_id = ?`, [eventId], (err) => {
                    if (err) {
                        console.error('Error deleting event photos:', err.message);
                        return res.status(500).json({ error: 'Failed to delete event.' });
                    }
                    db.run(`DELETE FROM events WHERE id = ?`, [eventId], (err) => {
                        if (err) {
                            console.error('Error deleting event:', err.message);
                            res.status(500).json({ error: 'Failed to delete event.' });
                        } else {
                            photos.forEach(photo => removeFile(photo.photo_path));
                            res.status(200).json({ message: 'event deleted.' });
                        }
                    });
                });
            });
        });
    });
});

// attendance

const ATTENDANCE_STATUSES = ['present', 'absent', 'late'];

app.post('/attendance', verifyAdmin, (req, res) => {
    const { member_id, event_id, status } = req.body;
    if (!member_id || !event_id || !status) return res.status(400).json({ error: 'member_id, event_id and status required.' });
    if (!ATTENDANCE_STATUSES.includes(status)) return res.status(400).json({ error: 'status must be present, absent or late.' });
    const query = `INSERT INTO attendance (member_id, event_id, status) VALUES (?, ?, ?)`;
    db.run(query, [member_id, event_id, status], function (err) {
        if (err && err.message.includes('UNIQUE')) {
            res.status(409).json({ error: 'Attendance for this member and event already exists.' });
        } else if (err && err.message.includes('FOREIGN KEY')) {
            res.status(404).json({ error: 'Member or event not found' });
        } else if (err) {
            console.error('Error inserting attendance:', err.message);
            res.status(500).json({ error: 'Failed to add attendance' });
        } else {
            res.status(201).json({ id: this.lastID, member_id, event_id, status });
        }

    });
});

app.get('/events/:id/attendance', verifyAdmin, (req, res) => {
    const eventId = req.params.id;
    const query = `SELECT * FROM attendance WHERE event_id = ?`;
    db.all(query, [eventId], (err, rows) => {
        if (err) {
            console.error('Error fetching attendance:', err.message);
            res.status(500).json({ error: 'Failed to fetch attendance' });
        } else {
            res.status(200).json(rows);
        }
    });
});

app.put('/attendance/:id', verifyAdmin, (req, res) => {
    const { status } = req.body;
    if (!ATTENDANCE_STATUSES.includes(status)) return res.status(400).json({ error: 'status must be present, absent or late.' });
    db.run(`UPDATE attendance SET status = ? WHERE id = ?`, [status, req.params.id], function (err) {
        if (err) {
            console.error('Error updating attendance:', err.message);
            res.status(500).json({ error: 'Failed to update attendance' });
        } else if (this.changes === 0) {
            res.status(404).json({ error: 'Attendance record not found' });
        } else {
            res.status(200).json({ id: req.params.id, status });
        }
    });
});

app.delete('/attendance/:id', verifyAdmin, (req, res) => {
    db.run(`DELETE FROM attendance WHERE id = ?`, [req.params.id], function (err) {

        if (err) {
            console.error('Error deleting attendance:', err.message);
            res.status(500).json({ error: 'Failed to delete attendance' });
        } else if (this.changes === 0) {
            res.status(404).json({ error: 'Attendance record not found' });
        } else {
            res.status(200).json({ message: 'Attendance record deleted' });
        }
    });
});

// admin auth

// the first admin is created with create-admin.js, not through this route
app.post('/admin/register', verifyAdmin, async (req, res) => {
    const { username, password } = req.body;
    if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) return res.status(400).json({ error: USERNAME_ERROR });
    const passwordError = checkPassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });
    const hashedPassword = await bcrypt.hash(password, 10);
    const query = `INSERT INTO admins (username, password) VALUES (?, ?)`;
    db.run(query, [username, hashedPassword], function (err) {
        if (err && err.message.includes('UNIQUE')) {
            res.status(409).json({ error: 'That username is already taken.' });
        } else if (err) {
            console.error('Error registering admin:', err.message);
            res.status(500).json({ error: 'Failed to register admin' });
        } else {
            res.status(201).json({ id: this.lastID, username });
        }
    });
});

app.post('/admin/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
        return res.status(400).json({ error: 'username and password required' });
    }
    const query = `SELECT * FROM admins WHERE username = ?`;

    db.get(query, [username], async (err, rows) => {
        if (err) {
            console.error('Error fetching admin:', err.message);
            res.status(500).json({ error: 'Failed to fetch admin' });
        } else if (!rows) {
            res.status(401).json({ error: 'Invalid username or password' });
        } else {
            const isPasswordValid = await bcrypt.compare(password, rows.password);
            if (!isPasswordValid) {
                res.status(401).json({ error: 'Invalid username or password' });
            } else {
                db.run(`UPDATE admins SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`, [rows.id], (err) => {
                    if (err) console.error('Error saving last login:', err.message);
                });
                res.status(200).json({ token: signAdminToken(rows) });
            }
        }
    });
});

app.put('/admin/password', verifyAdmin, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (typeof oldPassword !== 'string' || !oldPassword) return res.status(400).json({ error: 'oldPassword and newPassword required' });
    const passwordError = checkPassword(newPassword, 'newPassword');
    if (passwordError) return res.status(400).json({ error: passwordError });
    const query = `SELECT * FROM admins WHERE id = ?`;
    db.get(query, [req.user.id], async (err, row) => {
        if (err) {
            console.error('Error fetching admin:', err.message);
            return res.status(500).json({ error: 'Failed to fetch admin' });
        } else if (!row) {
            return res.status(404).json({ error: 'Admin not found' });
        } else {
            const isOldPasswordValid = await bcrypt.compare(oldPassword, row.password);
            if (!isOldPasswordValid) {
                return res.status(401).json({ error: 'Invalid old password' });
            }
            const hashedNewPassword = await bcrypt.hash(newPassword, 10);
            // a new password also logs out every other session; this one gets a fresh token
            const query = `UPDATE admins SET password = ?, password_changed_at = CURRENT_TIMESTAMP,
                token_version = token_version + 1 WHERE id = ?`;
            db.run(query, [hashedNewPassword, req.user.id], function (err) {
                if (err) {
                    console.error('Error updating password:', err.message);
                    return res.status(500).json({ error: 'Failed to update password' });
                }
                const token = signAdminToken({ ...row, token_version: row.token_version + 1 });
                return res.status(200).json({ message: 'Password updated successfully', token });
            });
        }
    });
});
 
app.put('/admin/username', verifyAdmin, async (req, res) => {
    const { newUsername, currentPassword } = req.body;
    if (!newUsername || typeof currentPassword !== 'string' || !currentPassword) return res.status(400).json({ error: 'newUsername and currentPassword required' });
    if (typeof newUsername !== 'string' || !USERNAME_PATTERN.test(newUsername)) return res.status(400).json({ error: USERNAME_ERROR });
 
    const query = `SELECT * FROM admins WHERE id = ?`;
    db.get(query, [req.user.id], async (err, row) => {
        if (err) {
            console.error('Error fetching admin:', err.message);
            return res.status(500).json({ error: 'Failed to fetch admin' });
        }
        if (!row) return res.status(404).json({ error: 'Admin not found' });
        const isPasswordValid = await bcrypt.compare(currentPassword, row.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid password' });
        }
 
        db.run(`UPDATE admins SET username = ? WHERE id = ?`, [newUsername, req.user.id], function (err) {
            if (err && err.message.includes('UNIQUE')) {
                return res.status(409).json({ error: 'That username is already taken.' });
            } else if (err) {
                console.error('Error updating username:', err.message);
                return res.status(500).json({ error: 'Failed to update username' });
            } else {
                return res.status(200).json({ message: 'Username updated successfully' });
            }
        });
    });
});

app.post('/admin/logout-all', verifyAdmin, (req, res) => {
    db.run(`UPDATE admins SET token_version = token_version + 1 WHERE id = ?`, [req.user.id], (err) => {
        if (err) {
            console.error('Error logging out everywhere:', err.message);
            res.status(500).json({ error: 'Failed to log out everywhere' });
        } else {
            res.status(200).json({ message: 'Logged out on every device' });
        }
    });
});

app.get('/admins', verifyAdmin, (req, res) => {
    const query = `SELECT id, username, created_at, last_login_at, password_changed_at FROM admins ORDER BY created_at ASC`;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching admins:', err.message);
            res.status(500).json({ error: 'Failed to fetch admins' });
        } else {
            res.status(200).json(rows);
        }
    });
});

app.delete('/admin/:username', verifyAdmin, (req, res) => {
    // blocking self-delete also means the last admin can never be removed
    if (req.params.username === req.user.username) {
        return res.status(400).json({ error: 'You cannot delete your own account.' });
    }
    db.run(`DELETE FROM admins WHERE username = ?`, [req.params.username], function (err) {
        if (err) {
            console.error('Error deleting admin:', err.message);
            res.status(500).json({ error: 'Failed to delete admin' });
        } else if (this.changes === 0) {
            res.status(404).json({ error: 'Admin not found' });
        } else {
            res.status(200).json({ message: 'Admin deleted' });
        }
    });
});

// join requests

app.post('/join-requests', formLimiter(), (req, res) => {
    const { name, email, phone, reason } = req.body;
    const invalid = checkFields(req.body, {
        name: { required: true, max: 100 },
        email: { required: true, max: 150, email: true },
        phone: { max: 30 },
        reason: { max: 1000 },
    });
    if (invalid) return res.status(400).json({ error: invalid });

    const query = `INSERT INTO join_requests (name, email, phone, reason) VALUES (?, ?, ?, ?)`;
    db.run(query, [name, email, phone || null, reason || null], function (err) {
        if (err) {
            console.error('Error submitting join request:', err.message);
            res.status(500).json({ error: 'Failed to submit request' });
        } else {
            res.status(201).json({ id: this.lastID, name, email, phone, reason, status: 'pending' });
        }

    });
});

app.get('/join-requests', verifyAdmin, (req, res) => {
    db.all(`SELECT * FROM join_requests ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching join requests:', err.message);
            res.status(500).json({ error: 'Failed to fetch requests' });
        } else {
            res.status(200).json(rows);
        }
    });
});

app.put('/join-requests/:id', verifyAdmin, (req, res) => {
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'status must be pending, approved or rejected.' });
    }

    db.get(`SELECT * FROM join_requests WHERE id = ?`, [req.params.id], (err, request) => {
        if (err) {
            console.error('Error fetching join request:', err.message);
            return res.status(500).json({ error: 'Failed to update request' });
        }
        if (!request) return res.status(404).json({ error: 'request not found' });

        const updateStatus = (memberId) => {
            db.run(`UPDATE join_requests SET status = ? WHERE id = ?`, [status, req.params.id], (err) => {
                if (err) {
                    console.error('Error updating join request:', err.message);
                    res.status(500).json({ error: 'Failed to update request' });
                } else {
                    res.status(200).json({ id: req.params.id, status, member_id: memberId });
                }
            });
        };

        // approving a request turns the applicant into a member
        if (status !== 'approved' || request.status === 'approved') return updateStatus(undefined);

        db.run(`INSERT INTO members (name, email, phone) VALUES (?, ?, ?)`, [request.name, request.email, request.phone], function (err) {
            if (err && err.message.includes('UNIQUE')) {
                return res.status(409).json({ error: 'A member with this email already exists.' });
            }
            if (err) {
                console.error('Error creating member from join request:', err.message);
                return res.status(500).json({ error: 'Failed to create member' });
            }
            updateStatus(this.lastID);
        });
    });
});

app.delete('/join-requests/:id', verifyAdmin, (req, res) => {
    db.run(`DELETE FROM join_requests WHERE id = ?`, [req.params.id], function (err) {
        if (err) {
            console.error('Error deleting join request:', err.message);
            res.status(500).json({ error: 'Failed to delete request' });
        } else if (this.changes === 0) {
            res.status(404).json({ error: 'request not found' });
        } else {
            res.status(200).json({ message: 'Join request deleted' });
        }
    });
});

// contact messages


app.post('/contact', formLimiter(), (req, res) => {
    const { name, email, message } = req.body;
    const invalid = checkFields(req.body, {
        name: { required: true, max: 100 },
        email: { required: true, max: 150, email: true },
        message: { required: true, max: 2000 },
    });
    if (invalid) return res.status(400).json({ error: invalid });
    const query = `INSERT INTO contact_messages (name, email, message) VALUES (?, ?, ?)`;
    db.run(query, [name, email, message], function (err) {
        if (err) {
            console.error('Error submitting contact message:', err.message);
            res.status(500).json({ error: 'Failed to submit message' });
        } else {
            res.status(201).json({ id: this.lastID, name, email, message });
        }
    });
});

app.get('/contact', verifyAdmin, (req, res) => {
    db.all(`SELECT * FROM contact_messages ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching messages:', err.message);
            res.status(500).json({ error: 'Failed to fetch message' });
        } else {
            res.status(200).json(rows);
        }
    });
});

app.delete('/contact/:id', verifyAdmin, (req, res) => {
    db.run(`DELETE FROM contact_messages WHERE id = ?`, [req.params.id], function (err) {
        if (err) {
            console.error('Error deleting message:', err.message);
            res.status(500).json({ error: 'Failed to delete message' });
        } else if (this.changes === 0) {
            res.status(404).json({ error: 'Message not found' });
        } else {
            res.status(200).json({ message: 'Message deleted' });
        }
    });
});

// public counts for the home page (numbers only, no personal data)
app.get('/stats', (req, res) => {
    const query = `SELECT
        (SELECT COUNT(*) FROM members) AS members,
        (SELECT COUNT(*) FROM events) AS events,
        (SELECT COUNT(*) FROM event_photos) AS photos`;
    db.get(query, [], (err, row) => {
        if (err) {
            console.error('Error fetching stats:', err.message);
            res.status(500).json({ error: 'Failed to fetch stats' });
        } else {
            res.status(200).json(row);
        }
    });
});

// club info (Settings page) — public to read, admins to edit

const SETTING_KEYS = ['contact_email', 'contact_phone', 'address', 'facebook', 'instagram', 'linkedin', 'github', 'youtube'];
const LINK_KEYS = ['facebook', 'instagram', 'linkedin', 'github', 'youtube'];

app.get('/settings', (req, res) => {
    db.all(`SELECT key, value FROM settings`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching settings:', err.message);
            return res.status(500).json({ error: 'Failed to fetch settings' });
        }
        const settings = Object.fromEntries(SETTING_KEYS.map(key => [key, null]));
        rows.forEach(row => { if (SETTING_KEYS.includes(row.key)) settings[row.key] = row.value; });
        res.status(200).json(settings);
    });
});

app.put('/settings', verifyAdmin, (req, res) => {
    const updates = {};
    for (const key of SETTING_KEYS) {
        if (req.body[key] === undefined) continue;
        const value = String(req.body[key] ?? '').trim();
        if (value.length > 300) return res.status(400).json({ error: `${key} is too long.` });
        if (value && LINK_KEYS.includes(key) && !/^https?:\/\/\S+$/i.test(value)) {
            return res.status(400).json({ error: `${key} must be a full link starting with https://` });
        }
        if (value && key === 'contact_email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            return res.status(400).json({ error: 'contact_email must be a valid email address.' });
        }
        updates[key] = value;
    }

    const entries = Object.entries(updates);
    if (!entries.length) return res.status(400).json({ error: 'Nothing to save.' });

    let remaining = entries.length;
    let failed = false;
    entries.forEach(([key, value]) => {
        // an empty value removes the item
        const [query, params] = value
            ? [`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value]]
            : [`DELETE FROM settings WHERE key = ?`, [key]];
        db.run(query, params, (err) => {
            if (err) {
                console.error('Error saving settings:', err.message);
                failed = true;
            }
            if (--remaining > 0) return;
            if (failed) res.status(500).json({ error: 'Failed to save some settings' });
            else res.status(200).json({ message: 'Settings saved' });
        });
    });
});

// spreadsheet (CSV) downloads for Settings > Export data

const EXPORTS = {
    members: `SELECT id, name, email, phone, position, position_rank, created_at FROM members ORDER BY name`,
    attendance: `SELECT e.date AS event_date, e.title AS event, m.name AS member, m.email, a.status
        FROM attendance a JOIN events e ON e.id = a.event_id JOIN members m ON m.id = a.member_id
        ORDER BY e.date DESC, m.name`,
    'join-requests': `SELECT id, name, email, phone, reason, status, created_at FROM join_requests ORDER BY created_at DESC`,
    messages: `SELECT id, name, email, message, created_at FROM contact_messages ORDER BY created_at DESC`,
};

function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    // stop spreadsheet apps from running text that looks like a formula
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

app.get('/export/:type', verifyAdmin, (req, res) => {
    const query = EXPORTS[req.params.type];
    if (!query) return res.status(404).json({ error: 'Unknown export' });

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error exporting data:', err.message);
            return res.status(500).json({ error: 'Failed to export data' });
        }
        const headers = rows.length ? Object.keys(rows[0]) : ['no data'];
        const lines = [headers.map(csvCell).join(','), ...rows.map(row => headers.map(h => csvCell(row[h])).join(','))];
        const date = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="ndubcc-${req.params.type}-${date}.csv"`);
        // the BOM makes Excel read Bangla and other non-English text correctly
        res.send('﻿' + lines.join('\r\n'));
    });
});

// announcements

app.post('/announcements', verifyAdmin, (req, res) => {
    const { title, body } = req.body;
    const invalid = checkFields(req.body, ANNOUNCEMENT_RULES);
    if (invalid) return res.status(400).json({ error: invalid });
    const query = `INSERT INTO announcements (title, body) VALUES (?, ?)`;

    db.run(query, [title, body], function (err) {
        if (err) {
            console.error('Error creating announcement:', err.message);
            res.status(500).json({ error: 'Failed to create announcement' });
        } else {
            res.status(201).json({ id: this.lastID, title, body });
        }
    });
});

app.get('/announcements', (req, res) => {
    db.all(`SELECT * FROM announcements ORDER BY posted_at DESC`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching announcements:', err.message);
            res.status(500).json({ error: 'Failed to fetch announcements' });
        } else {
            res.status(200).json(rows);
        }
    });
});

app.put('/announcements/:id', verifyAdmin, (req, res) => {
    const announcementId = req.params.id;
    const invalid = checkFields(req.body, ANNOUNCEMENT_RULES, { partial: true });
    if (invalid) return res.status(400).json({ error: invalid });

    db.get(`SELECT * FROM announcements WHERE id = ?`, [announcementId], (err, existing) => {
        if (err) {
            console.error('Error fetching announcement:', err.message);
            return res.status(500).json({ error: 'Failed to fetch announcement' });
        }
        if (!existing) {
            return res.status(404).json({ error: 'Announcement not found' });
        }


        const title = req.body.title !== undefined ? req.body.title : existing.title;
        const body = req.body.body !== undefined ? req.body.body : existing.body;

        db.run(`UPDATE announcements SET title = ?, body = ? WHERE id = ?`, [title, body, announcementId], function (err) {
            if (err) {
                console.error('Error updating announcement:', err.message);
                res.status(500).json({ error: 'Failed to update announcement' });
            } else {
                res.status(200).json({ id: announcementId, title, body });
            }
        });
    });
});

app.delete('/announcements/:id', verifyAdmin, (req, res) => {
    db.run(`DELETE FROM announcements WHERE id = ?`, [req.params.id], function (err) {
        if (err) {
            console.error('Error deleting announcement:', err.message);
            res.status(500).json({ error: 'Failed to delete announcement' });
        } else if (this.changes === 0) {
            res.status(404).json({ error: 'Announcement not found' });
        } else {
            res.status(200).json({ message: 'Announcement deleted' });
        }
    });
});

// event photo gallery

app.post('/events/:id/photos', verifyAdmin, upload.single('photo'), async (req, res) => {
    const eventId = req.params.id;
    if (!req.file) {
        return res.status(400).json({ error: 'Photo is required' });
    }

    const originalPath = req.file.path;
    const watermarkedPath = 'uploads/wm-' + req.file.filename;
    const { caption } = req.body;
    const invalidCaption = checkFields(req.body, { caption: { max: 150 } });
    if (invalidCaption) {
        removeFile(originalPath);
        return res.status(400).json({ error: invalidCaption });
    }

    const event = await new Promise((resolve) => {
        db.get(`SELECT id FROM events WHERE id = ?`, [eventId], (err, row) => {
            if (err) console.error('Error fetching event:', err.message);
            resolve(err ? undefined : row);
        });
    });
    if (!event) {
        removeFile(originalPath);
        return res.status(404).json({ error: 'Event not found' });
    }

    try {
        await processImage(originalPath, watermarkedPath, { watermark: true });
    } catch (err) {
        console.error('Error watermarking photo:', err.message);
        removeFile(originalPath);
        return res.status(400).json({ error: INVALID_IMAGE_ERROR });
    }
    removeFile(originalPath);

    db.run(
        `INSERT INTO event_photos (event_id, photo_path, caption) VALUES (?, ?, ?)`,
        [eventId, watermarkedPath, caption || null],
        function (err) {
            if (err) {
                console.error('Error inserting event photo:', err.message);
                removeFile(watermarkedPath);
                return res.status(500).json({ error: 'Failed to insert event photo' });
            } else {
                res.status(201).json({ id: this.lastID, event_id: eventId, photo_path: watermarkedPath, caption });
            }
        }
    );
});

app.get('/events/:id/photos', (req, res) => {
    db.all(`SELECT * FROM event_photos WHERE event_id = ?`, [req.params.id], (err, rows) => {
        if (err) {
            console.error('Error fetching event photos:', err.message);
            res.status(500).json({ error: 'Failed to fetch photos' });
        } else {
            res.status(200).json(rows);
        }
    });
});

app.delete('/events/:id/photos/:photoId', verifyAdmin, (req, res) => {
    db.get(`SELECT photo_path FROM event_photos WHERE id = ? AND event_id = ?`, [req.params.photoId, req.params.id], (err, photo) => {
        if (err) {
            console.error('Error fetching event photo:', err.message);
            return res.status(500).json({ error: 'Failed to delete photo' });
        }
        if (!photo) return res.status(404).json({ error: 'Photo not found' });

        db.run(`DELETE FROM event_photos WHERE id = ?`, [req.params.photoId], (err) => {
            if (err) {
                console.error('Error deleting event photo:', err.message);
                res.status(500).json({ error: 'Failed to delete photo' });
            } else {
                removeFile(photo.photo_path);
                res.status(200).json({ message: 'Photo deleted' });
            }
        });
    });
});

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.message === UPLOAD_TYPE_ERROR) {
        console.error('File upload error:', err.message);
        res.status(400).json({ error: err.message });
    } else if (err.type === 'entity.too.large') {
        res.status(413).json({ error: 'That request is too large.' });
    } else if (err.type === 'entity.parse.failed') {
        res.status(400).json({ error: 'The request data is not valid JSON.' });
    } else {
        console.error('Unexpected error:', err.message);
        res.status(500).json({ error: 'Unexpected error occurred' });
    }
});
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});