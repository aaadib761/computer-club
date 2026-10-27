require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const QRCode = require('qrcode');
const crypto = require('crypto');
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
        if (rule.pattern && !rule.pattern.test(value.trim())) return rule.patternError;
        if (rule.oneOf && !rule.oneOf.includes(value)) return `${field} must be one of: ${rule.oneOf.join(', ')}.`;
    }
    return null;
}

// student and club IDs: letters, numbers and dashes, stored in capitals so "ab-1" and "AB-1" are the same ID
const ID_PATTERN = /^[A-Za-z0-9-]{3,30}$/;
function cleanId(value) {
    return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null;
}
function cleanText(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Turns a "UNIQUE constraint failed" database error into a message people understand (or null).
function duplicateMessage(err) {
    if (!err || !err.message.includes('UNIQUE')) return null;
    if (err.message.includes('student_id')) return 'A member with this student ID already exists.';
    if (err.message.includes('club_id')) return 'A member with this club ID already exists.';
    if (err.message.includes('email')) return 'A member with this email already exists.';
    return 'That already exists.';
}

// a phone number: 7-15 digits, optionally with a leading + and spaces, dashes or brackets,
// e.g. 01712345678, +880 1712-345678, (02) 955-1234
const PHONE_PATTERN = /^(?=(?:\D*\d){7,15}\D*$)\+?[0-9\s()-]+$/;

const MEMBER_RULES = {
    name: { required: true, max: 100 },
    email: { required: true, max: 150, email: true },
    phone: { required: true, max: 30, pattern: PHONE_PATTERN, patternError: 'Phone number should have 7-15 digits (spaces, +, - and brackets are fine).' },
    position: { max: 60 },
    student_id: { required: true, pattern: ID_PATTERN, patternError: 'Student ID must be 3-30 letters, numbers or dashes.' },
    club_id: { pattern: ID_PATTERN, patternError: 'Club ID must be 3-30 letters, numbers or dashes.' },
    batch: { required: true, max: 30 },
    department: { required: true, max: 60 },
};
const EVENT_CATEGORIES = ['Seminar', 'Workshop', 'Contest', 'Fest', 'Picnic', 'Meetup', 'Other'];
const EVENT_RULES = {
    title: { required: true, max: 120 },
    description: { max: 3000 },
    date: { required: true, date: true },
    category: { oneOf: EVENT_CATEGORIES },
    speaker: { max: 100 },
    speaker_title: { max: 120 },
    venue: { max: 120 },
    duration: { max: 30 },
};
const EVENT_FIELDS = Object.keys(EVENT_RULES);
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

// Runs SQL statements one after another: [[sql, params], ...]. Calls done(err) after the last one or the first failure.
function runInOrder(statements, done) {
    const [first, ...rest] = statements;
    if (!first) return done(null);
    db.run(first[0], first[1], (err) => (err ? done(err) : runInOrder(rest, done)));
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
// turn off browser features the site never uses (helmet doesn't set this one);
// admin pages may use the camera, for scanning membership cards at event check-in
app.use((req, res, next) => {
    const camera = req.path.startsWith('/admin/') ? 'camera=(self)' : 'camera=()';
    res.setHeader('Permissions-Policy', `${camera}, microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()`);
    next();
});

// small JSON bodies only; nothing here needs more than a few KB
app.use(express.json({ limit: '50kb' }));
app.use('/uploads', express.static('uploads'));

// the QR-code reader used by admin check-in (served from node_modules so it stays a local script)
app.get('/vendor/jsQR.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules', 'jsqr', 'dist', 'jsQR.js'));
});

// Link previews for Facebook, WhatsApp, LinkedIn... These sites don't run our JavaScript, so the
// server adds the preview tags (title, description, image) to public pages before sending them.
function escapeAttr(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function previewTags({ title, description, image, url, large }) {
    return [
        ['og:type', 'website'],
        ['og:site_name', 'NDUB Computer Club'],
        ['og:title', title],
        ['og:description', description],
        ['og:image', image],
        ['og:url', url],
    ].map(([property, content]) => `<meta property="${property}" content="${escapeAttr(content)}">`)
        .concat(`<meta name="twitter:card" content="${large ? 'summary_large_image' : 'summary'}">`)
        .join('\n    ');
}

app.get(/^\/([a-z0-9-]+\.html)?$/, (req, res, next) => {
    const page = req.params[0] || 'index.html';
    const file = path.join(__dirname, 'public', page);
    fs.readFile(file, 'utf8', (err, html) => {
        if (err) return next();  // not a page we have: let the normal 404 handle it
        const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
        const preview = {
            title: (html.match(/<title>([^<]*)<\/title>/) || [])[1] || 'NDUB Computer Club',
            description: (html.match(/<meta name="description" content="([^"]*)"/) || [])[1]
                || 'NDUB Computer Club: seminars, workshops, contests and more at Notre Dame University Bangladesh.',
            image: `${base}/images/logo.png`,
            url: base + req.originalUrl,
            large: false,
        };
        const send = () => res.type('html').send(html.replace('</head>', `    ${previewTags(preview)}\n</head>`));

        // an event link shows that event's title, details and first photo
        const eventId = page === 'event.html' ? Number(req.query.id) : NaN;
        if (!Number.isInteger(eventId)) return send();
        const query = `SELECT e.title, e.date, e.venue, e.description,
            (SELECT photo_path FROM event_photos p WHERE p.event_id = e.id ORDER BY p.id LIMIT 1) AS photo
            FROM events e WHERE e.id = ?`;
        db.get(query, [eventId], (err, event) => {
            if (!err && event) {
                preview.title = `${event.title} | NDUB Computer Club`;
                const when = [String(event.date).replace('T', ' at '), event.venue].filter(Boolean).join(' · ');
                preview.description = [when, (event.description || '').slice(0, 180)].filter(Boolean).join(' — ');
                if (event.photo) {
                    preview.image = `${base}/${event.photo}`;
                    preview.large = true;
                }
            }
            send();
        });
    });
});

// the website; pages keep their .html extension so they never clash with API routes like /events.
// The folder is found next to server.js, so it works even when the server is started from elsewhere.
app.use(express.static(path.join(__dirname, 'public')));

// members

app.post('/members', verifyAdmin, (req, res) => {
    const { name, email, phone, position, position_rank } = req.body;
    const invalid = checkFields(req.body, MEMBER_RULES) || checkRank(position_rank);
    if (invalid) return res.status(400).json({ error: invalid });
    const query = `INSERT INTO members (name, email, phone, position, position_rank, student_id, club_id, batch, department)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const cleanPosition = (position || '').trim() || null;
    // a rank without a position means nothing, so it isn't stored
    const cleanRank = cleanPosition && position_rank ? Number(position_rank) : null;
    const student_id = cleanId(req.body.student_id);
    const club_id = cleanId(req.body.club_id);
    const batch = cleanText(req.body.batch);
    const department = cleanText(req.body.department);
    db.run(query, [name, email, phone, cleanPosition, cleanRank, student_id, club_id, batch, department], function (err) {
        const duplicate = duplicateMessage(err);
        if (duplicate) {
            res.status(409).json({ error: duplicate });
        } else if (err) {
            console.error('Error inserting member:', err.message);
            res.status(500).json({ error: 'Failed to add member' });
        } else {
            res.status(201).json({ id: this.lastID, name, email, phone, position: cleanPosition, position_rank: cleanRank, student_id, club_id, batch, department });
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
    // having a position puts someone on the committee; rank only sets the order (no rank = after ranked ones)
    const query = `SELECT id, name, position, position_rank, photo_path FROM members
        WHERE position IS NOT NULL AND TRIM(position) != ''
        ORDER BY position_rank IS NULL, position_rank, name COLLATE NOCASE`;
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
        const newPosition = req.body.position !== undefined ? req.body.position : existing.position;
        const position = (newPosition || '').trim() || null;
        const newRank = req.body.position_rank !== undefined ? req.body.position_rank : existing.position_rank;
        // removing the position also removes the rank
        const position_rank = position && newRank ? Number(newRank) : null;
        const student_id = req.body.student_id !== undefined ? cleanId(req.body.student_id) : existing.student_id;
        const club_id = req.body.club_id !== undefined ? cleanId(req.body.club_id) : existing.club_id;
        const batch = req.body.batch !== undefined ? cleanText(req.body.batch) : existing.batch;
        const department = req.body.department !== undefined ? cleanText(req.body.department) : existing.department;

        const query = `UPDATE members SET name = ?, email = ?, phone = ?, position = ?, position_rank = ?,
            student_id = ?, club_id = ?, batch = ?, department = ? WHERE id = ?`;
        db.run(query, [name, email, phone, position, position_rank, student_id, club_id, batch, department, memberId], function (err) {
            const duplicate = duplicateMessage(err);
            if (duplicate) {
                res.status(409).json({ error: duplicate });
            } else if (err) {
                console.error('Error updating member:', err.message);
                res.status(500).json({ error: 'Failed to update member' });
            } else {
                res.status(200).json({ id: memberId, name, email, phone, position, position_rank, student_id, club_id, batch, department });
            }
        });
    });
});

// one-time membership fee: mark a member as paid or unpaid, with an optional note (receipt no., who collected it)
app.put('/members/:id/fee', verifyAdmin, (req, res) => {
    if (typeof req.body.paid !== 'boolean') return res.status(400).json({ error: 'paid must be true or false.' });
    const invalid = checkFields(req.body, { fee_note: { max: 120 } });
    if (invalid) return res.status(400).json({ error: invalid });
    const query = req.body.paid
        ? `UPDATE members SET fee_paid = 1, fee_paid_at = CURRENT_TIMESTAMP, fee_note = ? WHERE id = ?`
        : `UPDATE members SET fee_paid = 0, fee_paid_at = NULL, fee_note = ? WHERE id = ?`;
    db.run(query, [cleanText(req.body.fee_note), req.params.id], function (err) {
        if (err) {
            console.error('Error updating fee status:', err.message);
            res.status(500).json({ error: 'Failed to update fee status' });
        } else if (this.changes === 0) {
            res.status(404).json({ error: 'Member not found' });
        } else {
            res.status(200).json({ id: req.params.id, fee_paid: req.body.paid });
        }
    });
});

// The QR code printed on a member's ID card. It opens the public verification page for their club ID.
// Set PUBLIC_URL in .env once the site is live, so cards always point at the real address.
app.get('/members/:id/qr', verifyAdmin, (req, res) => {
    db.get(`SELECT club_id FROM members WHERE id = ?`, [req.params.id], async (err, member) => {
        if (err) {
            console.error('Error fetching member:', err.message);
            return res.status(500).json({ error: 'Failed to make QR code' });
        }
        if (!member) return res.status(404).json({ error: 'Member not found' });
        if (!member.club_id) return res.status(400).json({ error: 'Give this member a club ID first.' });
        const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
        const url = `${base}/verify.html?club_id=${encodeURIComponent(member.club_id)}`;
        try {
            const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
            res.type('image/svg+xml').send(svg);
        } catch (err) {
            console.error('Error making QR code:', err.message);
            res.status(500).json({ error: 'Failed to make QR code' });
        }
    });
});

// Public check that a club ID card is real. Limited so nobody can quickly list every member.
const verifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Too many checks. Please try again later.' },
});

app.get('/verify/:clubId', verifyLimiter, (req, res) => {
    const clubId = cleanId(req.params.clubId);
    if (!clubId || !ID_PATTERN.test(clubId)) return res.status(400).json({ error: 'That is not a valid club ID.' });
    // only what's already printed on the card: name, photo and club ID (no email, phone or student ID)
    const query = `SELECT name, club_id, photo_path, fee_paid, created_at FROM members WHERE club_id = ?`;
    db.get(query, [clubId], (err, member) => {
        if (err) {
            console.error('Error verifying member:', err.message);
            return res.status(500).json({ error: 'Failed to check' });
        }
        if (!member) return res.status(404).json({ error: 'No member has this club ID.' });
        // cards stop being valid after the "Cards valid until" date in Settings (if one is set)
        db.get(`SELECT value FROM settings WHERE key = 'card_valid_until'`, [], (err, setting) => {
            const validUntil = !err && setting ? setting.value : null;
            const now = new Date();
            const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            const expired = !!validUntil && today > validUntil;
            res.status(200).json({
                name: member.name,
                club_id: member.club_id,
                photo_path: member.photo_path,
                active: member.fee_paid === 1 && !expired,
                fee_paid: member.fee_paid === 1,
                expired,
                valid_until: validUntil,
                member_since: String(member.created_at || '').slice(0, 4),
            });
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

        // attendance and registration rows reference the member, so they have to go first
        runInOrder([
            [`DELETE FROM event_registrations WHERE member_id = ?`, [memberId]],
            [`DELETE FROM attendance WHERE member_id = ?`, [memberId]],
        ], (err) => {
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

// Registration settings aren't text, so they're checked apart from EVENT_RULES.
// Fields not sent keep the event's current value.
function readRegistration(body, existing = {}) {
    const open = body.registration_open !== undefined ? body.registration_open : existing.registration_open;
    const cap = body.capacity !== undefined ? body.capacity : existing.capacity;
    if (open !== undefined && open !== null && ![true, false, 0, 1].includes(open)) {
        return { error: 'registration_open must be true or false.' };
    }
    const noLimit = cap === undefined || cap === null || cap === '';
    if (!noLimit && !(Number.isInteger(Number(cap)) && Number(cap) >= 1 && Number(cap) <= 10000)) {
        return { error: 'capacity must be a whole number from 1 to 10000.' };
    }
    return { registration_open: open ? 1 : 0, capacity: noLimit ? null : Number(cap) };
}

app.post('/events', verifyAdmin, (req, res) => {
    const invalid = checkFields(req.body, EVENT_RULES);
    if (invalid) return res.status(400).json({ error: invalid });
    const registration = readRegistration(req.body);
    if (registration.error) return res.status(400).json({ error: registration.error });

    const values = [...EVENT_FIELDS.map(field => cleanText(req.body[field])), registration.registration_open, registration.capacity];
    const columns = [...EVENT_FIELDS, 'registration_open', 'capacity'];
    const query = `INSERT INTO events (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
    db.run(query, values, function (err) {
        if (err) {
            console.error('Error inserting event:', err.message);
            res.status(500).json({ error: 'Failed to add event' });
        } else {
            res.status(201).json({ id: this.lastID, ...Object.fromEntries(columns.map((c, i) => [c, values[i]])) });
        }
    });
});

// attendees = members marked present or late, so nobody has to count by hand;
// registered = members who signed up online
const EVENT_SELECT = `SELECT e.*,
    (SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id AND a.status IN ('present', 'late')) AS attendees,
    (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id = e.id) AS registered
    FROM events e`;

app.get('/events', (req, res) => {
    db.all(EVENT_SELECT, [], (err, rows) => {
        if (err) {
            console.error('Error fetching events:', err.message);
            res.status(500).json({ error: 'Failed to fetch events' });
        } else {
            res.status(200).json(rows);
        }
    });
});

app.get('/event-categories', (req, res) => {
    res.status(200).json(EVENT_CATEGORIES);
});

app.get('/events/:id', (req, res) => {
    db.get(`${EVENT_SELECT} WHERE e.id = ?`, [req.params.id], (err, row) => {
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

        const registration = readRegistration(req.body, existing);
        if (registration.error) return res.status(400).json({ error: registration.error });

        // fields not sent keep their current value
        const updated = {
            ...Object.fromEntries(EVENT_FIELDS.map(field =>
                [field, req.body[field] !== undefined ? cleanText(req.body[field]) : existing[field]])),
            ...registration,
        };
        const columns = Object.keys(updated);

        const query = `UPDATE events SET ${columns.map(c => `${c} = ?`).join(', ')} WHERE id = ?`;
        db.run(query, [...columns.map(c => updated[c]), eventId], function (err) {
            if (err) {
                console.error('Error updating event:', err.message);
                res.status(500).json({ error: 'Failed to update event' });
            } else {
                res.status(200).json({ id: eventId, ...updated });
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
            // attendance, registration and photo rows reference the event, so they have to go first
            runInOrder([
                [`DELETE FROM event_registrations WHERE event_id = ?`, [eventId]],
                [`DELETE FROM attendance WHERE event_id = ?`, [eventId]],
            ], (err) => {
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

// only NDUB students can apply, so the Join form needs their university email
const STUDENT_EMAIL_DOMAIN = 'student.ndub.edu.bd';

// the Join form is sent as form-data because it includes the applicant's photo
app.post('/join-requests', formLimiter(), upload.single('photo'), async (req, res) => {
    const uploaded = req.file ? req.file.path : null;
    const fail = (status, error) => {
        removeFile(uploaded);
        res.status(status).json({ error });
    };

    const { name, email, phone, reason } = req.body;
    const invalid = checkFields(req.body, {
        name: { required: true, max: 100 },
        email: { required: true, max: 150, email: true },
        phone: MEMBER_RULES.phone,
        reason: { max: 1000 },
        student_id: MEMBER_RULES.student_id,
        batch: MEMBER_RULES.batch,
        department: MEMBER_RULES.department,
    });
    if (invalid) return fail(400, invalid);
    if (!email.trim().toLowerCase().endsWith('@' + STUDENT_EMAIL_DOMAIN)) {
        return fail(400, `Please use your NDUB student email (yourname@${STUDENT_EMAIL_DOMAIN}).`);
    }
    if (!['on', 'true', 'yes'].includes(String(req.body.declaration).toLowerCase())) {
        return fail(400, 'Please tick the declaration to confirm your information is correct.');
    }
    if (!uploaded) return fail(400, 'Please upload a recent photo of yourself.');

    const photoPath = 'uploads/applicant-' + req.file.filename;
    try {
        await processImage(uploaded, photoPath);
    } catch (err) {
        console.error('Error processing applicant photo:', err.message);
        return fail(400, INVALID_IMAGE_ERROR);
    }
    removeFile(uploaded);

    const student_id = cleanId(req.body.student_id);
    const batch = cleanText(req.body.batch);
    const department = cleanText(req.body.department);
    const query = `INSERT INTO join_requests (name, email, phone, reason, student_id, batch, department, photo_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    db.run(query, [name.trim(), email.trim().toLowerCase(), phone || null, reason || null, student_id, batch, department, photoPath], function (err) {
        if (err) {
            console.error('Error submitting join request:', err.message);
            removeFile(photoPath);
            res.status(500).json({ error: 'Failed to submit request' });
        } else {
            res.status(201).json({ id: this.lastID, status: 'pending' });
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

    db.get(`SELECT * FROM join_requests WHERE id = ?`, [req.params.id], async (err, request) => {
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

        // the member gets their own copy of the applicant photo, so deleting the request later doesn't remove it
        let memberPhoto = null;
        if (request.photo_path) {
            memberPhoto = 'uploads/photo-' + path.basename(request.photo_path).replace(/^applicant-/, '');
            try {
                await fs.promises.copyFile(request.photo_path, memberPhoto);
            } catch (err) {
                console.error('Error copying applicant photo:', err.message);
                memberPhoto = null;
            }
        }

        const query = `INSERT INTO members (name, email, phone, student_id, batch, department, photo_path) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        db.run(query, [request.name, request.email, request.phone, request.student_id, request.batch, request.department, memberPhoto], function (err) {
            if (err) removeFile(memberPhoto);
            const duplicate = duplicateMessage(err);
            if (duplicate) return res.status(409).json({ error: duplicate });
            if (err) {
                console.error('Error creating member from join request:', err.message);
                return res.status(500).json({ error: 'Failed to create member' });
            }
            updateStatus(this.lastID);
        });
    });
});

app.delete('/join-requests/:id', verifyAdmin, (req, res) => {
    db.get(`SELECT photo_path FROM join_requests WHERE id = ?`, [req.params.id], (err, request) => {
        if (err) {
            console.error('Error fetching join request:', err.message);
            return res.status(500).json({ error: 'Failed to delete request' });
        }
        if (!request) return res.status(404).json({ error: 'request not found' });
        db.run(`DELETE FROM join_requests WHERE id = ?`, [req.params.id], (err) => {
            if (err) {
                console.error('Error deleting join request:', err.message);
                res.status(500).json({ error: 'Failed to delete request' });
            } else {
                removeFile(request.photo_path);
                res.status(200).json({ message: 'Join request deleted' });
            }
        });
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

// advisors & moderators (About page) — public to read, admins to edit

const ADVISOR_RULES = {
    name: { required: true, max: 100 },
    role: { required: true, max: 60 },
    designation: { max: 120 },
    message: { max: 1500 },
    profile_url: { max: 300, pattern: /^https?:\/\/\S+$/i, patternError: 'profile_url must be a full link starting with https://' },
};
const ADVISOR_FIELDS = Object.keys(ADVISOR_RULES);

function checkSortOrder(value) {
    if (value === undefined || value === null || value === '') return null;
    const order = Number(value);
    return Number.isInteger(order) && order >= 1 && order <= 999 ? null : 'sort_order must be a whole number from 1 to 999.';
}

app.get('/advisors', (req, res) => {
    db.all(`SELECT * FROM advisors ORDER BY sort_order IS NULL, sort_order, id`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching advisors:', err.message);
            res.status(500).json({ error: 'Failed to fetch advisors' });
        } else {
            res.status(200).json(rows);
        }
    });
});

app.post('/advisors', verifyAdmin, (req, res) => {
    const invalid = checkFields(req.body, ADVISOR_RULES) || checkSortOrder(req.body.sort_order);
    if (invalid) return res.status(400).json({ error: invalid });
    const values = [...ADVISOR_FIELDS.map(f => cleanText(req.body[f])), req.body.sort_order ? Number(req.body.sort_order) : null];
    const query = `INSERT INTO advisors (${ADVISOR_FIELDS.join(', ')}, sort_order) VALUES (${values.map(() => '?').join(', ')})`;
    db.run(query, values, function (err) {
        if (err) {
            console.error('Error adding advisor:', err.message);
            res.status(500).json({ error: 'Failed to add advisor' });
        } else {
            res.status(201).json({ id: this.lastID });
        }
    });
});

app.put('/advisors/:id', verifyAdmin, (req, res) => {
    const invalid = checkFields(req.body, ADVISOR_RULES, { partial: true }) || checkSortOrder(req.body.sort_order);
    if (invalid) return res.status(400).json({ error: invalid });
    db.get(`SELECT * FROM advisors WHERE id = ?`, [req.params.id], (err, existing) => {
        if (err) {
            console.error('Error fetching advisor:', err.message);
            return res.status(500).json({ error: 'Failed to update advisor' });
        }
        if (!existing) return res.status(404).json({ error: 'Advisor not found' });
        const pick = f => (req.body[f] !== undefined ? cleanText(req.body[f]) : existing[f]);
        const sortOrder = req.body.sort_order !== undefined ? (req.body.sort_order ? Number(req.body.sort_order) : null) : existing.sort_order;
        const query = `UPDATE advisors SET ${ADVISOR_FIELDS.map(f => `${f} = ?`).join(', ')}, sort_order = ? WHERE id = ?`;
        db.run(query, [...ADVISOR_FIELDS.map(pick), sortOrder, req.params.id], (err) => {
            if (err) {
                console.error('Error updating advisor:', err.message);
                res.status(500).json({ error: 'Failed to update advisor' });
            } else {
                res.status(200).json({ message: 'Advisor updated' });
            }
        });
    });
});

app.delete('/advisors/:id', verifyAdmin, (req, res) => {
    db.get(`SELECT photo_path FROM advisors WHERE id = ?`, [req.params.id], (err, existing) => {
        if (err) {
            console.error('Error fetching advisor:', err.message);
            return res.status(500).json({ error: 'Failed to delete advisor' });
        }
        if (!existing) return res.status(404).json({ error: 'Advisor not found' });
        db.run(`DELETE FROM advisors WHERE id = ?`, [req.params.id], (err) => {
            if (err) {
                console.error('Error deleting advisor:', err.message);
                res.status(500).json({ error: 'Failed to delete advisor' });
            } else {
                removeFile(existing.photo_path);
                res.status(200).json({ message: 'Advisor deleted' });
            }
        });
    });
});

app.post('/advisors/:id/photo', verifyAdmin, upload.single('photo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Photo is required' });
    const originalPath = req.file.path;
    const photoPath = 'uploads/advisor-' + req.file.filename;
    try {
        await processImage(originalPath, photoPath);
    } catch (err) {
        console.error('Error processing advisor photo:', err.message);
        removeFile(originalPath);
        return res.status(400).json({ error: INVALID_IMAGE_ERROR });
    }
    removeFile(originalPath);

    db.get(`SELECT photo_path FROM advisors WHERE id = ?`, [req.params.id], (err, existing) => {
        if (err || !existing) {
            removeFile(photoPath);
            if (err) console.error('Error fetching advisor:', err.message);
            return res.status(err ? 500 : 404).json({ error: err ? 'Failed to save photo' : 'Advisor not found' });
        }
        db.run(`UPDATE advisors SET photo_path = ? WHERE id = ?`, [photoPath, req.params.id], (err) => {
            if (err) {
                console.error('Error saving advisor photo:', err.message);
                removeFile(photoPath);
                return res.status(500).json({ error: 'Failed to save photo' });
            }
            removeFile(existing.photo_path);
            res.status(200).json({ photo_path: photoPath });
        });
    });
});

app.delete('/advisors/:id/photo', verifyAdmin, (req, res) => {
    db.get(`SELECT photo_path FROM advisors WHERE id = ?`, [req.params.id], (err, existing) => {
        if (err) {
            console.error('Error fetching advisor:', err.message);
            return res.status(500).json({ error: 'Failed to remove photo' });
        }
        if (!existing) return res.status(404).json({ error: 'Advisor not found' });
        db.run(`UPDATE advisors SET photo_path = NULL WHERE id = ?`, [req.params.id], (err) => {
            if (err) {
                console.error('Error removing advisor photo:', err.message);
                return res.status(500).json({ error: 'Failed to remove photo' });
            }
            removeFile(existing.photo_path);
            res.status(200).json({ message: 'Photo removed' });
        });
    });
});

// past committees — a frozen copy of who held which position when a term ended

app.get('/committee-archive', (req, res) => {
    db.all(`SELECT * FROM committee_archive ORDER BY archived_at DESC, id DESC`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching committee archive:', err.message);
            return res.status(500).json({ error: 'Failed to fetch past committees' });
        }
        res.status(200).json(rows.map(r => ({ id: r.id, term: r.term, archived_at: r.archived_at, members: JSON.parse(r.members_json) })));
    });
});

app.post('/committee-archive', verifyAdmin, (req, res) => {
    const invalid = checkFields(req.body, { term: { required: true, max: 80 } });
    if (invalid) return res.status(400).json({ error: invalid });
    // names and positions only: the archive is public, and department/batch are private
    const query = `SELECT name, position FROM members
        WHERE position IS NOT NULL AND TRIM(position) != ''
        ORDER BY position_rank IS NULL, position_rank, name COLLATE NOCASE`;
    db.all(query, [], (err, members) => {
        if (err) {
            console.error('Error reading committee:', err.message);
            return res.status(500).json({ error: 'Failed to archive committee' });
        }
        if (!members.length) return res.status(400).json({ error: 'There is no committee to archive yet.' });
        db.run(`INSERT INTO committee_archive (term, members_json) VALUES (?, ?)`, [req.body.term.trim(), JSON.stringify(members)], function (err) {
            if (err) {
                console.error('Error archiving committee:', err.message);
                return res.status(500).json({ error: 'Failed to archive committee' });
            }
            res.status(201).json({ id: this.lastID, members: members.length });
        });
    });
});

app.delete('/committee-archive/:id', verifyAdmin, (req, res) => {
    db.run(`DELETE FROM committee_archive WHERE id = ?`, [req.params.id], function (err) {
        if (err) {
            console.error('Error deleting archived committee:', err.message);
            res.status(500).json({ error: 'Failed to delete' });
        } else if (this.changes === 0) {
            res.status(404).json({ error: 'Not found' });
        } else {
            res.status(200).json({ message: 'Deleted' });
        }
    });
});

// every gallery photo with its event, newest events first (Gallery page)
app.get('/photos', (req, res) => {
    const query = `SELECT p.id, p.photo_path, p.caption, p.event_id, e.title AS event_title, e.date AS event_date, e.category
        FROM event_photos p JOIN events e ON e.id = p.event_id
        ORDER BY e.date DESC, p.id`;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching photos:', err.message);
            res.status(500).json({ error: 'Failed to fetch photos' });
        } else {
            res.status(200).json(rows);
        }
    });
});

// club info (Settings page) — public to read, admins to edit

const SETTING_KEYS = ['contact_email', 'contact_phone', 'address', 'facebook', 'instagram', 'linkedin', 'github', 'youtube',
    'about_text', 'objectives', 'founded_year', 'committee_term', 'membership_fee', 'card_back_text', 'card_valid_until'];
const LINK_KEYS = ['facebook', 'instagram', 'linkedin', 'github', 'youtube'];
// most settings are short; the About page texts can be longer
const SETTING_MAX = { about_text: 3000, objectives: 2000, committee_term: 80, card_back_text: 600 };

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
        if (value.length > (SETTING_MAX[key] || 300)) return res.status(400).json({ error: `${key} is too long.` });
        if (value && key === 'founded_year' && !/^(19|20)\d{2}$/.test(value)) {
            return res.status(400).json({ error: 'founded_year must be a year like 2017.' });
        }
        if (value && key === 'card_valid_until' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return res.status(400).json({ error: 'card_valid_until must be a date like 2027-06-30.' });
        }
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

// ---------- event check-in, registration and certificates ----------

// "2026-11-30" or "2026-11-30T14:00" -> has that moment already arrived?
function eventHasStarted(date) {
    const text = String(date || '');
    const start = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00` : text);
    return !isNaN(start) && start <= new Date();
}

// Members prove who they are with their club ID + student ID (both printed on their card).
function findMemberByIds(clubId, studentId, done) {
    const club = cleanId(clubId);
    const student = cleanId(studentId);
    if (!club || !student) return done(null, null);
    db.get(`SELECT id, name, club_id, photo_path FROM members WHERE club_id = ? AND student_id = ?`, [club, student], done);
}

// shared by the public register / certificate forms, so nobody can guess ID pairs quickly
const memberFormLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many tries. Please wait a few minutes and try again.' },
});

// QR check-in at the door: the scanned card gives a club ID, which marks the member present.
app.post('/events/:id/checkin', verifyAdmin, (req, res) => {
    const clubId = cleanId(req.body.club_id);
    if (!clubId) return res.status(400).json({ error: 'No club ID found.' });
    db.get(`SELECT id FROM events WHERE id = ?`, [req.params.id], (err, event) => {
        if (err) {
            console.error('Error fetching event:', err.message);
            return res.status(500).json({ error: 'Check-in failed' });
        }
        if (!event) return res.status(404).json({ error: 'Event not found' });
        db.get(`SELECT id, name, club_id, photo_path FROM members WHERE club_id = ?`, [clubId], (err, member) => {
            if (err) {
                console.error('Error fetching member:', err.message);
                return res.status(500).json({ error: 'Check-in failed' });
            }
            if (!member) return res.status(404).json({ error: `No member has club ID ${clubId}.` });
            db.get(`SELECT id, status FROM attendance WHERE event_id = ? AND member_id = ?`, [event.id, member.id], (err, row) => {
                if (err) {
                    console.error('Error fetching attendance:', err.message);
                    return res.status(500).json({ error: 'Check-in failed' });
                }
                if (row && ['present', 'late'].includes(row.status)) return res.status(200).json({ member, already: true });
                const [query, params] = row
                    ? [`UPDATE attendance SET status = 'present' WHERE id = ?`, [row.id]]
                    : [`INSERT INTO attendance (member_id, event_id, status) VALUES (?, ?, 'present')`, [member.id, event.id]];
                db.run(query, params, (err) => {
                    if (err) {
                        console.error('Error checking in:', err.message);
                        return res.status(500).json({ error: 'Check-in failed' });
                    }
                    res.status(200).json({ member, already: false });
                });
            });
        });
    });
});

// Public: a member registers for an upcoming event (if registration is open and seats are left).
app.post('/events/:id/register', memberFormLimiter, (req, res) => {
    db.get(`${EVENT_SELECT} WHERE e.id = ?`, [req.params.id], (err, event) => {
        if (err) {
            console.error('Error fetching event:', err.message);
            return res.status(500).json({ error: 'Registration failed' });
        }
        if (!event) return res.status(404).json({ error: 'Event not found' });
        if (!event.registration_open) return res.status(400).json({ error: 'Registration is not open for this event.' });
        if (eventHasStarted(event.date)) return res.status(400).json({ error: 'This event has already started.' });

        findMemberByIds(req.body.club_id, req.body.student_id, (err, member) => {
            if (err) {
                console.error('Error fetching member:', err.message);
                return res.status(500).json({ error: 'Registration failed' });
            }
            if (!member) return res.status(400).json({ error: 'Club ID and student ID don\'t match any member.' });
            // someone already registered should hear that, even when the event is now full
            db.get(`SELECT 1 FROM event_registrations WHERE event_id = ? AND member_id = ?`, [event.id, member.id], (err, existing) => {
                if (err) {
                    console.error('Error checking registration:', err.message);
                    return res.status(500).json({ error: 'Registration failed' });
                }
                if (existing) return res.status(200).json({ name: member.name, already: true });
                if (event.capacity && event.registered >= event.capacity) {
                    return res.status(409).json({ error: 'Sorry, all seats are taken.' });
                }
                db.run(`INSERT INTO event_registrations (event_id, member_id) VALUES (?, ?)`, [event.id, member.id], (err) => {
                    if (err && err.message.includes('UNIQUE')) return res.status(200).json({ name: member.name, already: true });
                    if (err) {
                        console.error('Error registering:', err.message);
                        return res.status(500).json({ error: 'Registration failed' });
                    }
                    res.status(201).json({ name: member.name, already: false });
                });
            });
        });
    });
});

// Public: a member cancels their own registration.
app.post('/events/:id/unregister', memberFormLimiter, (req, res) => {
    findMemberByIds(req.body.club_id, req.body.student_id, (err, member) => {
        if (err) {
            console.error('Error fetching member:', err.message);
            return res.status(500).json({ error: 'Could not cancel' });
        }
        if (!member) return res.status(400).json({ error: 'Club ID and student ID don\'t match any member.' });
        db.run(`DELETE FROM event_registrations WHERE event_id = ? AND member_id = ?`, [req.params.id, member.id], function (err) {
            if (err) {
                console.error('Error cancelling registration:', err.message);
                return res.status(500).json({ error: 'Could not cancel' });
            }
            if (this.changes === 0) return res.status(404).json({ error: 'You weren\'t registered for this event.' });
            res.status(200).json({ name: member.name });
        });
    });
});

// Admin: who registered, and whether they've checked in yet.
app.get('/events/:id/registrations', verifyAdmin, (req, res) => {
    const query = `SELECT m.id AS member_id, m.name, m.club_id, m.student_id, m.department, m.batch, m.photo_path, r.created_at,
        EXISTS (SELECT 1 FROM attendance a WHERE a.event_id = r.event_id AND a.member_id = m.id
            AND a.status IN ('present', 'late')) AS checked_in
        FROM event_registrations r JOIN members m ON m.id = r.member_id
        WHERE r.event_id = ? ORDER BY r.created_at`;
    db.all(query, [req.params.id], (err, rows) => {
        if (err) {
            console.error('Error fetching registrations:', err.message);
            res.status(500).json({ error: 'Failed to fetch registrations' });
        } else {
            res.status(200).json(rows);
        }
    });
});

app.delete('/events/:id/registrations/:memberId', verifyAdmin, (req, res) => {
    db.run(`DELETE FROM event_registrations WHERE event_id = ? AND member_id = ?`, [req.params.id, req.params.memberId], function (err) {
        if (err) {
            console.error('Error removing registration:', err.message);
            res.status(500).json({ error: 'Failed to remove registration' });
        } else if (this.changes === 0) {
            res.status(404).json({ error: 'Registration not found' });
        } else {
            res.status(200).json({ message: 'Registration removed' });
        }
    });
});

// Certificate codes look like NDUBCC-6-12-1A2B3C4D5E (event 6, member 12). The last part is a
// signature made with JWT_SECRET, so nobody can invent a valid code for an event they missed.
function certificateSignature(eventId, memberId) {
    return crypto.createHmac('sha256', JWT_SECRET).update(`certificate:${eventId}:${memberId}`).digest('hex').slice(0, 10).toUpperCase();
}
function certificateCode(eventId, memberId) {
    return `NDUBCC-${eventId}-${memberId}-${certificateSignature(eventId, memberId)}`;
}
function readCertificateCode(code) {
    const match = /^NDUBCC-(\d{1,9})-(\d{1,9})-([0-9A-F]{10})$/.exec(String(code || '').toUpperCase());
    if (!match) return null;
    const [, eventId, memberId, signature] = match;
    const expected = Buffer.from(certificateSignature(eventId, memberId));
    const given = Buffer.from(signature);
    return crypto.timingSafeEqual(expected, given) ? { eventId: Number(eventId), memberId: Number(memberId) } : null;
}

// Public: an attendee gets their certificate code after the event (club ID + student ID).
app.post('/certificates/claim', memberFormLimiter, (req, res) => {
    const eventId = Number(req.body.event_id);
    if (!Number.isInteger(eventId)) return res.status(400).json({ error: 'Choose an event.' });
    db.get(`SELECT id, date FROM events WHERE id = ?`, [eventId], (err, event) => {
        if (err) {
            console.error('Error fetching event:', err.message);
            return res.status(500).json({ error: 'Could not get the certificate' });
        }
        if (!event) return res.status(404).json({ error: 'Event not found' });
        if (!eventHasStarted(event.date)) return res.status(400).json({ error: 'Certificates are available after the event.' });
        findMemberByIds(req.body.club_id, req.body.student_id, (err, member) => {
            if (err) {
                console.error('Error fetching member:', err.message);
                return res.status(500).json({ error: 'Could not get the certificate' });
            }
            if (!member) return res.status(400).json({ error: 'Club ID and student ID don\'t match any member.' });
            const query = `SELECT 1 FROM attendance WHERE event_id = ? AND member_id = ? AND status IN ('present', 'late')`;
            db.get(query, [event.id, member.id], (err, attended) => {
                if (err) {
                    console.error('Error checking attendance:', err.message);
                    return res.status(500).json({ error: 'Could not get the certificate' });
                }
                if (!attended) return res.status(404).json({ error: 'Our attendance records don\'t show you at this event. Please contact the committee if this is a mistake.' });
                res.status(200).json({ code: certificateCode(event.id, member.id) });
            });
        });
    });
});

// Public: show (and so verify) a certificate from its code.
app.get('/certificates/:code', (req, res) => {
    const parsed = readCertificateCode(req.params.code);
    if (!parsed) return res.status(404).json({ error: 'This certificate code is not valid.' });
    const query = `SELECT m.name, e.title, e.date, e.category, e.speaker, e.venue
        FROM attendance a JOIN members m ON m.id = a.member_id JOIN events e ON e.id = a.event_id
        WHERE a.event_id = ? AND a.member_id = ? AND a.status IN ('present', 'late')`;
    db.get(query, [parsed.eventId, parsed.memberId], (err, row) => {
        if (err) {
            console.error('Error fetching certificate:', err.message);
            return res.status(500).json({ error: 'Could not load the certificate' });
        }
        if (!row) return res.status(404).json({ error: 'This certificate is no longer valid.' });
        // signature lines: the current president and the club's moderator, if they're set up
        db.get(`SELECT name FROM members WHERE LOWER(TRIM(position)) = 'president' LIMIT 1`, [], (err, president) => {
            db.get(`SELECT name FROM advisors WHERE LOWER(TRIM(role)) = 'moderator' ORDER BY sort_order IS NULL, sort_order LIMIT 1`, [], (err2, moderator) => {
                res.status(200).json({
                    code: certificateCode(parsed.eventId, parsed.memberId),
                    name: row.name,
                    event: { title: row.title, date: row.date, category: row.category, speaker: row.speaker, venue: row.venue },
                    president: president ? president.name : null,
                    moderator: moderator ? moderator.name : null,
                });
            });
        });
    });
});

// The QR code printed on a certificate: it opens the certificate's own page, which proves it's real.
app.get('/certificates/:code/qr', async (req, res) => {
    if (!readCertificateCode(req.params.code)) return res.status(404).json({ error: 'This certificate code is not valid.' });
    const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const url = `${base}/certificate.html?code=${encodeURIComponent(req.params.code.toUpperCase())}`;
    try {
        res.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
    } catch (err) {
        console.error('Error making certificate QR code:', err.message);
        res.status(500).json({ error: 'Failed to make QR code' });
    }
});

// Admin: certificate codes for everyone who attended an event.
app.get('/events/:id/certificates', verifyAdmin, (req, res) => {
    const query = `SELECT m.id AS member_id, m.name FROM attendance a JOIN members m ON m.id = a.member_id
        WHERE a.event_id = ? AND a.status IN ('present', 'late') ORDER BY m.name COLLATE NOCASE`;
    db.all(query, [req.params.id], (err, rows) => {
        if (err) {
            console.error('Error fetching attendees:', err.message);
            return res.status(500).json({ error: 'Failed to fetch certificates' });
        }
        res.status(200).json(rows.map(r => ({ ...r, code: certificateCode(req.params.id, r.member_id) })));
    });
});

// spreadsheet (CSV) downloads for Settings > Export data

const EXPORTS = {
    members: `SELECT id, name, student_id, club_id, department, batch, email, phone, position, position_rank,
        CASE fee_paid WHEN 1 THEN 'paid' ELSE 'unpaid' END AS fee, fee_paid_at, fee_note, created_at FROM members ORDER BY name`,
    attendance: `SELECT e.date AS event_date, e.title AS event, m.name AS member, m.student_id, m.club_id, m.department, m.batch, m.email, a.status
        FROM attendance a JOIN events e ON e.id = a.event_id JOIN members m ON m.id = a.member_id
        ORDER BY e.date DESC, m.name`,
    'join-requests': `SELECT id, name, student_id, department, batch, email, phone, reason, status, created_at FROM join_requests ORDER BY created_at DESC`,
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

// database backups: a full copy of club.db, made once a day and on demand from Settings

const BACKUP_DIR = path.join(__dirname, 'backups');
const BACKUPS_TO_KEEP = 30;
const BACKUP_NAME_PATTERN = /^club-\d{4}-\d{2}-\d{2}-\d{6}\.db$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function listBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
        .filter(name => BACKUP_NAME_PATTERN.test(name))
        .map(name => {
            const stats = fs.statSync(path.join(BACKUP_DIR, name));
            return { name, size: stats.size, created_at: stats.mtime.toISOString() };
        })
        .sort((a, b) => b.name.localeCompare(a.name)); // names contain the date, so this is newest first
}

// VACUUM INTO writes a clean, consistent copy even while the server is using the database
function makeBackup(done) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const iso = new Date().toISOString(); // e.g. 2026-10-27T19:20:05.123Z
    const name = `club-${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, '')}.db`; // club-2026-10-27-192005.db
    db.run(`VACUUM INTO ?`, [path.join(BACKUP_DIR, name)], (err) => {
        if (err) {
            console.error('Error backing up database:', err.message);
            return done && done(err);
        }
        // keep only the newest backups so the folder doesn't grow forever
        listBackups().slice(BACKUPS_TO_KEEP).forEach(old => removeFile(path.join(BACKUP_DIR, old.name)));
        console.log(`Database backed up to backups/${name}`);
        if (done) done(null, name);
    });
}

// checked every hour: back up if the newest backup is a day old (or there is none)
function backupIfDue() {
    const newest = listBackups()[0];
    if (!newest || Date.now() - new Date(newest.created_at).getTime() >= DAY_MS) makeBackup();
}

app.get('/backups', verifyAdmin, (req, res) => {
    res.status(200).json(listBackups());
});

app.post('/backups', verifyAdmin, (req, res) => {
    makeBackup((err, name) => {
        if (err) return res.status(500).json({ error: 'Failed to back up the database' });
        res.status(201).json(listBackups().find(b => b.name === name));
    });
});

app.get('/backups/:name', verifyAdmin, (req, res) => {
    const name = req.params.name;
    // only plain backup file names, so nobody can ask for ../.env or other files
    if (!BACKUP_NAME_PATTERN.test(name) || !fs.existsSync(path.join(BACKUP_DIR, name))) {
        return res.status(404).json({ error: 'Backup not found' });
    }
    res.download(path.join(BACKUP_DIR, name), name);
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
    // give the database a moment to finish setting up its tables first
    setTimeout(backupIfDue, 5000);
    setInterval(backupIfDue, 60 * 60 * 1000);
});