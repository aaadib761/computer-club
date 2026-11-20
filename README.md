# NDUB Computer Club Management System

A website and database for the Notre Dame University Bangladesh Computer Club (NDUBCC). It keeps members, events, attendance, fees, certificates and every executive committee in one place, with a public website, an admin panel and a member portal.

Built with Node.js, Express 5 and SQLite. The front end is plain HTML, CSS and JavaScript.

## Features

**Public website**
- Home, events (with search, year filter and calendar export), gallery, committee, about and contact pages
- Online join form, reviewed by the committee
- Membership card and certificate verification by QR code or club ID

**Member portal**
- Log in with club ID and password
- See your membership card, register for events and download certificates

**Admin panel**
- Members: add, edit, search and filter; print ID cards at real card size (85.6 × 54 mm) with a QR code
- Events: registrations, door check-in by scanning QR cards, attendance (present, late, absent) and photos
- Certificates emailed automatically to everyone who attended, after the event ends
- Membership fee dashboard by department and batch
- Executive committees: the current committee plus the panel list of every past committee
- Downloads of any list as Excel, CSV or PDF
- Admin roles (owner, editor, check-in), 2-step login with an authenticator app, and an activity log
- Daily automatic database backups

## Requirements

- [Node.js](https://nodejs.org) 22.2 or newer (developed on Node.js 24)
- A Gmail account, only if you want the site to send emails

## Getting started

1. Get the code and install the packages:

   ```bash
   git clone https://github.com/<your-username>/club-db.git
   cd club-db
   npm install
   ```

2. Create your settings file by copying the example:

   ```bash
   cp .env.example .env
   ```

   On Windows Command Prompt, use `copy .env.example .env`.

3. Open `.env` and set `JWT_SECRET` to a long random value. Generate one with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   The other settings are optional and explained in `.env.example`.

4. Create the first admin account:

   ```bash
   node create-admin.js <username> <password>
   ```

   The password needs at least 8 characters, and common passwords are refused. The first admin is an owner, who can add other admins in **Settings**.

5. Start the server:

   ```bash
   npm start
   ```

6. Open <http://localhost:3000> for the website and <http://localhost:3000/admin/login.html> for the admin panel.

The database (`club.db`) and its tables are created automatically the first time the server starts.

## Configuration

All settings live in `.env`. See `.env.example` for details.

| Setting | Needed | What it does |
| --- | --- | --- |
| `JWT_SECRET` | Yes | Signs logins and encrypts 2-step login secrets. Keep it private. Changing it logs everyone out and turns off 2-step login. |
| `PORT` | No | Port the server listens on (default 3000) |
| `NODE_ENV` | No | Set to `production` when the site is live |
| `PUBLIC_URL` | No | The site's public address. Set it before printing ID cards, because their QR codes point here. |
| `TRUST_PROXY` | No | Set to `1` when running behind a hosting proxy |
| `CLUB_TIMEZONE` | No | Time zone for event times (default `Asia/Dhaka`) |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | No | Turn on emails. Use a Gmail [app password](https://myaccount.google.com/apppasswords), not your normal password. |

Club details such as the contact email, address, membership fee and card text are set in the admin panel under **Settings**.

## Project structure

| Path | What it is |
| --- | --- |
| `server.js` | The Express server: every page route and API |
| `db.js` | Opens `club.db` and creates or upgrades the 13 tables |
| `mailer.js` | Email sending and templates |
| `certificate-image.js` | Draws certificate images |
| `exporter.js` | Builds the CSV and Excel downloads |
| `security.js` | Password rules and login lockout |
| `twofactor.js` | 2-step login codes (TOTP) |
| `create-admin.js` | Command to create an admin |
| `reset-2fa.js` | Emergency command to turn off an admin's 2-step login |
| `public/` | The website, member portal and admin panel |
| `uploads/` | Uploaded photos (not in Git) |
| `backups/` | Daily database backups (not in Git) |

## Useful commands

| Command | What it does |
| --- | --- |
| `npm start` | Start the server |
| `node create-admin.js <username> <password>` | Create an admin account |
| `node reset-2fa.js <username>` | Turn off 2-step login for an admin who has lost their phone and recovery codes |

## Data and privacy

`.env`, `club.db`, `uploads/` and `backups/` are listed in `.gitignore` and never uploaded to GitHub. They hold your secret key and members' personal details. Back them up separately, and copy `club.db` and `uploads/` together when moving the site to another computer.

## Authors

Developed by Abdullah Ahsan and Aloyshius Ryan Gomes for the NDUB Computer Club.
