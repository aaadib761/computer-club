require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = express();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const UPLOAD_TYPE_ERROR = 'Only JPEG, PNG, and WEBP images are allowed';

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const UniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
        cb(null, UniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(UPLOAD_TYPE_ERROR));
        }
    }
});

const PORT = process.env.PORT || 3000 ;
const JWT_SECRET = process.env.JWT_SECRET ;
if (!JWT_SECRET) {
    console.error('JWT_SECRET is not set. Add it to your .env file.');
    process.exit(1);
}
const loginLimiter = rateLimit({ 
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many Login attempts. Please try again later.' }
});

function verifyAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Authorization header missing' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token missing' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });

        req.user = user;
        next();
    })
}

function removeFile(filePath) {
    if (!filePath) return;
    fs.unlink(filePath, (err) => {
        if (err && err.code !== 'ENOENT') console.error('Error removing file:', err.message);
    });
}

async function addWatermark(inputPath, outputPath, text) {
    const image = sharp(inputPath);
    const metadata = await image.metadata();
    const svgText = `
    <svg width="${metadata.width}" height="${metadata.height}">
     <text x="${metadata.width-10}" y="${metadata.height-10}"
     font-family="Arial" font-size="20" fill="white"
     fill-opacity="0.7" text-anchor="end">
     ${text}
     </text>
     </svg>
     `;
       await image
       .composite([{ input: Buffer.from(svgText), gravity: 'southeast'}])
       .toFile(outputPath);
}

app.use(express.json());
app.use('/uploads', express.static('uploads'));

// members

app.post('/members', verifyAdmin, (req, res) => {
    const { name, email, phone, position, position_rank } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'name and email required.' });
    const query = `INSERT INTO members (name, email, phone, position, position_rank) VALUES (?, ?, ?, ?, ?)`;
    db.run(query, [name, email, phone, position || null, position_rank || null], function (err) {
        if (err) {

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
    const watermarkedPath = 'uploads/wm-' + req.file.filename;

    try {
        await addWatermark(originalPath, watermarkedPath, 'Developed by Abdullah Ahsan');
    } catch (err) {
        console.error('Error watermarking image:', err.message);
        removeFile(originalPath);
        return res.status(500).json({ error: 'Failed to process image.' });
    }
    removeFile(originalPath);

    db.get(`SELECT photo_path FROM members WHERE id = ?`, [req.params.id], (err, existing) => {
        if (err) {
            console.error('Error fetching member:', err.message);
            removeFile(watermarkedPath);
            return res.status(500).json({ error: 'Failed to save photo.' });
        }
        if (!existing) {
            removeFile(watermarkedPath);
            return res.status(404).json({ error: 'Member not found' });
        }

        db.run(`UPDATE members SET photo_path = ? WHERE id = ?`, [watermarkedPath, req.params.id], function (err) {
            if (err) {
                console.error('Error saving photo path:', err.message);
                removeFile(watermarkedPath);
                res.status(500).json({ error: 'Failed to save photo.' });
            } else {
                removeFile(existing.photo_path);
                res.status(200).json({ id: req.params.id, photo_path: watermarkedPath });
            }
        });
    });
});


app.get('/members', verifyAdmin, (req, res) => {
    const query = `SELECT * From members`;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching members:', err.message);
            res.status(500).json({ error: 'Failed to fetch members' });
        } else {
            const cleaned = rows.map(member => {
                if (!member.position) {
                    const { position, position_rank, photo_path, ...rest } = member;
                    return rest;
                }
                return member;
            });
            res.status(200).json(cleaned);
        }
    });
});

app.get('/members/executive', (req, res) => {
    const query = `Select * From members WHERE position_rank IS NOT NULL ORDER BY position_rank ASC`;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching executive members:', err.message);
            res.status(500).json({ error: 'Failed to fetch executive members' });
        } else {
            res.status(200).json(rows);
        }
    });
});


app.put('/members/:id', verifyAdmin, (req, res) => {
    const memberId = req.params.id;

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
            if (err) {
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
    if (!title || !date) return res.status(400).json({ error: 'title and date required.' });
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

app.get('/events', verifyAdmin, (req, res) => {
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

app.put('/events/:id', verifyAdmin, (req, res) => {
    const eventId = req.params.id;

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

app.post('/attendance', verifyAdmin, (req, res) => {
    const { member_id, event_id, status } = req.body;
    if (!member_id || !event_id || !status) return res.status(400).json({ error: 'member_id, event_id and status required.' });
    const query = `INSERT INTO attendance (member_id, event_id, status) VALUES (?, ?, ?)`;
    db.run(query, [member_id, event_id, status], function (err) {
        if (err) {
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
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const query = `INSERT INTO admins (username, password) VALUES (?, ?)`;
    db.run(query, [username, hashedPassword], function (err) {
        if (err) {
            console.error('Error regsitering admin:', err.message);
            res.status(500).json({ error: 'Failed to register admin' });
        } else {
            res.status(201).json({ id: this.lastID, username });
        }
    });
});

app.post('/admin/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
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
                const token = jwt.sign({ id: rows.id, username: rows.username }, JWT_SECRET, { expiresIn: '1h' });
                res.status(200).json({ token });
            }
        }
    });
});

app.put('/admin/password', verifyAdmin, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ error: 'oldPassword and newPassword required' });
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
            db.run(`UPDATE admins SET password = ? WHERE id = ?`, [hashedNewPassword, req.user.id], function (err) {
                if (err) {
                    console.error('Error updating password:', err.message);
                    return res.status(500).json({ error: 'Failed to update password' });
                } else {
                    return res.status(200).json({ message: 'Password updated successfully' });
                }
            });
        }
    });
});
 
app.put('/admin/username', verifyAdmin, async (req, res) => {
    const { newUsername, currentPassword } = req.body;
    if (!newUsername || !currentPassword) return res.status(400).json({ error: 'newUsername and currentPassword required' });
 
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
            if (err) {
                console.error('Error updating username:', err.message);
                return res.status(500).json({ error: 'Failed to update username' });
            } else {
                return res.status(200).json({ message: 'Username updated successfully' });
            }
        });
    });
});
// join requests

app.post('/join-requests', (req, res) => {
    const { name, email, phone, reason } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'name and email required.' });

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
    db.run(`UPDATE join_requests SET status = ? WHERE id = ?`, [status, req.params.id], function (err) {
        if (err) {
            console.error('Error updating join request:', err.message);
            res.status(500).json({ error: 'Failed to update request' });
        } else if (this.changes === 0) {
            res.status(404).json({ error: 'request not found' });
        } else {
            res.status(200).json({ id: req.params.id, status });
        }
    });
});

// contact messages


app.post('/contact', (req, res) => {
    const { name, email, message } = req.body;
    if (!name || !email || !message) return res.status(400).json({ error: 'name, email and message required.' });
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

// announcements

app.post('/announcements', verifyAdmin, (req, res) => {
    const { title, body } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body required.' });
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

    try {
        await addWatermark(originalPath, watermarkedPath, 'Developed by Abdullah Ahsan');
    } catch (err) {
        console.error('Error watermarking photo:', err.message);
        removeFile(originalPath);
        return res.status(500).json({ error: 'Failed to process image' });
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

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.message === UPLOAD_TYPE_ERROR) {
        console.error('File upload error:', err.message);
        res.status(400).json({ error: err.message });
    } else {
        console.error('Unexpected error:', err.message);
        res.status(500).json({ error: 'Unexpected error occurred' });
    }
});
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});