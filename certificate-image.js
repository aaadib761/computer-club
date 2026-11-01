// Draws a participation certificate as a PNG picture (A4 landscape), so it can be attached to an email.
// Same design as the certificate page (public/certificate.html), built as SVG and turned into a PNG by sharp.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const QRCode = require('qrcode');

const WIDTH = 1754;    // A4 landscape at 150 dots per inch: sharp enough to print
const HEIGHT = 1240;
const ORANGE = '#e8601c';
const INK = '#2b2b2b';
const MUTED = '#6b6b6b';
// system fonts that cover Bangla too (Nirmala UI on Windows, Noto on Linux), then any sans-serif
const FONT = "'Poppins', 'Segoe UI', 'Nirmala UI', 'Noto Sans', 'Noto Sans Bengali', Arial, sans-serif";

const logoDataUri = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, 'public', 'images', 'logo.png')).toString('base64')}`;

function xml(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// SVG text doesn't wrap by itself, so split a sentence into lines of about `max` characters
function wrap(text, max) {
    const lines = [];
    let line = '';
    for (const word of String(text).split(/\s+/)) {
        if (line && (line + ' ' + word).length > max) {
            lines.push(line);
            line = word;
        } else {
            line = line ? `${line} ${word}` : word;
        }
    }
    if (line) lines.push(line);
    return lines;
}

// "2027-02-10T14:00" -> "10 February 2027"
function longDate(date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
    if (!match) return String(date || '');
    return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// The sentence under the name, worded like the certificate page:
// participated in the workshop "AI Basics" held on 10 February 2027 at Lab 1, conducted by Dr. Karim.
function participationText(event) {
    const kind = event.category ? event.category.toLowerCase() : 'event';
    let text = `participated in the ${kind} “${event.title}” held on ${longDate(event.date)}`;
    if (event.venue) text += ` at ${event.venue}`;
    if (event.speaker) text += `, conducted by ${event.speaker}`;
    return `${text}.`;
}

// cert: { name, code, verifyUrl, event: { title, date, category, venue, speaker }, president, moderator }
async function renderCertificatePng(cert) {
    const qr = await QRCode.toDataURL(cert.verifyUrl, { margin: 1, width: 300, errorCorrectionLevel: 'M' });
    // long names get smaller so they always fit on one line
    const nameSize = cert.name.length > 40 ? 58 : cert.name.length > 28 ? 70 : 82;
    // even line lengths (no single word left alone on the last line), at most ~88 characters each
    const sentence = participationText(cert.event);
    const lineCount = Math.ceil(sentence.length / 88);
    const lines = wrap(sentence, Math.ceil(sentence.length / lineCount) + 6);
    const lineHeight = 46;
    const textTop = 820;
    const signature = (x, name, title) => `
        <line x1="${x - 210}" y1="1035" x2="${x + 210}" y2="1035" stroke="${INK}" stroke-width="2.5"/>
        <text x="${x}" y="1072" font-size="28" font-weight="600" fill="${INK}" text-anchor="middle">${xml(name || '')}</text>
        <text x="${x}" y="1110" font-size="25" fill="${MUTED}" text-anchor="middle">${xml(title)}</text>`;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="${FONT}">
        <rect width="100%" height="100%" fill="#ffffff"/>
        <rect x="40" y="40" width="${WIDTH - 80}" height="${HEIGHT - 80}" fill="none" stroke="${ORANGE}" stroke-width="12"/>
        <rect x="74" y="74" width="${WIDTH - 148}" height="${HEIGHT - 148}" fill="none" stroke="${INK}" stroke-width="4"/>
        <image href="${logoDataUri}" x="${WIDTH / 2 - 95}" y="120" width="190" height="190" preserveAspectRatio="xMidYMid meet"/>
        <text x="${WIDTH / 2}" y="365" font-size="27" letter-spacing="4" fill="${MUTED}" text-anchor="middle">NDUB COMPUTER CLUB · NOTRE DAME UNIVERSITY BANGLADESH</text>
        <text x="${WIDTH / 2}" y="480" font-size="80" font-weight="700" fill="${ORANGE}" text-anchor="middle">Certificate of Participation</text>
        <text x="${WIDTH / 2}" y="575" font-size="34" fill="${INK}" text-anchor="middle">This is to certify that</text>
        <text x="${WIDTH / 2}" y="${670 + (82 - nameSize) / 3}" font-size="${nameSize}" font-weight="700" fill="${INK}" text-anchor="middle">${xml(cert.name)}</text>
        <line x1="${WIDTH / 2 - 420}" y1="715" x2="${WIDTH / 2 + 420}" y2="715" stroke="${INK}" stroke-width="3"/>
        ${lines.map((line, i) => `<text x="${WIDTH / 2}" y="${textTop - (lines.length - 1) * lineHeight / 2 + i * lineHeight}" font-size="34" fill="${INK}" text-anchor="middle">${xml(line)}</text>`).join('')}
        ${signature(390, cert.president, 'President, NDUBCC')}
        ${signature(WIDTH - 390, cert.moderator, 'Moderator, NDUBCC')}
        <image href="${qr}" x="${WIDTH / 2 - 85}" y="925" width="170" height="170"/>
        <text x="${WIDTH / 2}" y="1125" font-size="21" fill="${MUTED}" text-anchor="middle">${xml(cert.code)}</text>
    </svg>`;
    return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

module.exports = { renderCertificatePng };
