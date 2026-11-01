// Sends the club's emails through a Gmail account.
// Set GMAIL_USER and GMAIL_APP_PASSWORD in .env (see .env.example). Without them, emails are skipped.
const nodemailer = require('nodemailer');

const CLUB_NAME = 'NDUB Computer Club';
const GMAIL_USER = process.env.GMAIL_USER;
// Google shows app passwords in groups of four ("abcd efgh ijkl mnop"); the spaces aren't part of it
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

const transporter = GMAIL_USER && GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } })
    : null;

if (!transporter) console.log('Email is off: set GMAIL_USER and GMAIL_APP_PASSWORD in .env to send emails.');

function isConfigured() {
    return !!transporter;
}

// links in emails must be full addresses; PUBLIC_URL is the live site, localhost is for testing
function siteUrl(pagePath) {
    const base = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
    return `${base}/${pagePath.replace(/^\/+/, '')}`;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Every email has the same simple look: a heading, a few paragraphs and an optional button.
// `paragraphs` are plain text (escaped here); the text version is built from the same parts.
function build({ subject, heading, paragraphs, button }) {
    const text = [heading, '', ...paragraphs.flatMap(p => [p, '']),
        ...(button ? [`${button.label}: ${button.url}`, ''] : []), `— ${CLUB_NAME}`].join('\n');
    const html = `<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #2b2b2b; line-height: 1.6;">
        <div style="border-top: 4px solid #e8601c; padding: 24px 0 8px;">
            <p style="margin: 0; color: #e8601c; font-weight: bold;">${CLUB_NAME}</p>
            <h1 style="font-size: 22px; margin: 8px 0 16px;">${escapeHtml(heading)}</h1>
            ${paragraphs.map(p => `<p style="margin: 0 0 14px;">${escapeHtml(p)}</p>`).join('')}
            ${button ? `<p style="margin: 22px 0;"><a href="${escapeHtml(button.url)}" style="background: #e8601c; color: #fff; padding: 12px 22px; border-radius: 999px; text-decoration: none; font-weight: bold;">${escapeHtml(button.label)}</a></p>` : ''}
            <p style="margin: 24px 0 0; color: #6b6b6b; font-size: 13px;">This email was sent by ${CLUB_NAME}. If you weren't expecting it, you can ignore it.</p>
        </div>
    </div>`;
    return { subject, text, html };
}

// The messages the club sends. Each returns { subject, text, html }.
const templates = {
    test: () => build({
        subject: `Test email from ${CLUB_NAME}`,
        heading: 'Email is working!',
        paragraphs: ['If you can read this, the website can send emails through your Gmail account.'],
    }),

    welcome: ({ name }) => build({
        subject: `Welcome to ${CLUB_NAME}!`,
        heading: `Welcome, ${name}!`,
        paragraphs: [
            'Your request to join the club has been approved. We\'re glad to have you!',
            'The committee will give you a club ID and a membership card soon. We\'ll email you again when your club ID is ready.',
        ],
        button: { label: 'See upcoming events', url: siteUrl('events.html') },
    }),

    clubIdReady: ({ name, clubId }) => build({
        subject: `Your club ID: ${clubId}`,
        heading: `Your club ID is ready, ${name}`,
        paragraphs: [
            `Your club ID is ${clubId}. It's printed on your membership card.`,
            'Set up your Member Portal account to register for events, see your membership card and download your certificates. You\'ll need your club ID, your student ID and this email address.',
        ],
        button: { label: 'Set up my account', url: siteUrl('portal.html') },
    }),

    registered: ({ name, event, when }) => build({
        subject: `You're registered: ${event.title}`,
        heading: `See you there, ${name}!`,
        paragraphs: [
            `You're registered for "${event.title}" on ${when}.`,
            ...(event.venue ? [`Venue: ${event.venue}`] : []),
            'Bring your membership card: we\'ll scan its QR code at the door. Can\'t make it? Please cancel so someone else can have your seat.',
        ],
        button: { label: 'Event details', url: siteUrl(`event.html?id=${event.id}`) },
    }),

    // sent after the event ends, with the certificate picture attached
    certificate: ({ name, event, code }) => build({
        subject: `Your certificate: ${event.title}`,
        heading: `Thanks for coming, ${name}!`,
        paragraphs: [
            `Thank you for taking part in "${event.title}". Your certificate of participation is attached to this email.`,
            'You can also open it online to print it or save it as a PDF. Anyone can check that it is genuine by scanning its QR code.',
            `Certificate code: ${code}`,
        ],
        button: { label: 'Open my certificate', url: siteUrl(`certificate.html?code=${encodeURIComponent(code)}`) },
    }),

    passwordReset: ({ name, link }) => build({
        subject: 'Reset your Member Portal password',
        heading: `Reset your password, ${name}`,
        paragraphs: [
            'Someone (hopefully you) asked to reset the password for your Member Portal account.',
            'The link below works once and expires in 1 hour. If you didn\'t ask for this, ignore this email: your password stays the same.',
        ],
        button: { label: 'Choose a new password', url: link },
    }),
};

// Sends now and waits; throws if Gmail refuses (used by the "Send test email" button).
async function sendMail(to, message) {
    if (!transporter) throw new Error('Email is not set up. Add GMAIL_USER and GMAIL_APP_PASSWORD to the .env file and restart the server.');
    await transporter.sendMail({ from: `"${CLUB_NAME}" <${GMAIL_USER}>`, to, ...message });
}

// For automatic emails: never makes a page wait or fail. Problems only go to the server log.
function sendInBackground(to, message) {
    if (!transporter || !to) return;
    sendMail(to, message)
        .then(() => console.log(`Email sent: "${message.subject}"`))
        .catch(err => console.error(`Email "${message.subject}" failed:`, err.message));
}

module.exports = { isConfigured, siteUrl, templates, sendMail, sendInBackground };
