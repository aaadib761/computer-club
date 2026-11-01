// Printable membership cards, front + back: card.html?id=12 (one member) or card.html?ids=12,15,20 (many).
requireLogin();

const params = new URLSearchParams(location.search);
const memberIds = (params.get('ids') || params.get('id') || '')
    .split(',').map(Number).filter(id => Number.isInteger(id) && id > 0);
const warnings = document.getElementById('card-warnings');
const sheet = document.getElementById('card-sheet');

// the rules under "N.B." on the back, one paragraph per line (Settings > Membership card can replace them)
const DEFAULT_BACK_TEXT = [
    'This card must be carried at all times when you are within the NDUBCC club. It is not transferable. '
        + 'Illegal use of this card will be considered as an offence and membership of this card-holder may be cancelled.',
    'Loss of this card must be reported immediately to the Moderator\'s Office and a new one provided with a specified fee.',
].join('\n');

const CARD_SLOGAN = 'Be The Crowd Make NDUB Proud';

// the degree printed as PROGRAM, from the member's department; any other department is printed as it is
const PROGRAMS = {
    CSE: 'B.Sc. in CSE',
    EEE: 'B.Sc. in EEE',
    BBA: 'BBA',
    English: 'BA in English',
    Law: 'LLB (Hons)',
    Economics: 'BSS in Economics',
    Microbiology: 'B.Sc. in Microbiology',
};

function warn(text) {
    warnings.insertAdjacentHTML('beforeend', `<div class="alert alert-error">${escapeHtml(text)}</div>`);
}

// "Ana, Rahim and 3 others" style list for warnings
function nameList(people) {
    const names = people.map(p => p.name);
    return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

// the QR code is made by the server; fetched with the admin login, then shown as an image
async function qrImage(memberId) {
    const res = await fetch(`/members/${memberId}/qr`, { headers: { Authorization: `Bearer ${currentAdmin().token}` } });
    if (!res.ok) throw new Error('Could not make a QR code');
    return URL.createObjectURL(await res.blob());
}

function cardFront(member, settings) {
    const program = PROGRAMS[member.department] || member.department || '—';
    return `
        <div class="id-card idc-front" aria-label="Front of ${escapeHtml(member.name)}'s card">
            <img class="idc-logo" src="../images/logo.png" alt="">
            <div class="idc-title">Notre Dame University Bangladesh<br>Computer Club (NDUBCC)</div>
            <div class="idc-pill">Membership Id Card</div>
            <div class="idc-photo">
                ${member.photo_path
                    ? `<img src="${escapeHtml(photoUrl(member.photo_path))}" alt="">`
                    : `<span>${escapeHtml(initials(member.name))}</span>`}
            </div>
            <dl class="idc-fields">
                <dt>NAME</dt><dd class="idc-name">${escapeHtml(member.name)}</dd>
                <dt>PROGRAM</dt><dd>${escapeHtml(program)}</dd>
                <dt>NDUB ID</dt><dd>${escapeHtml(member.student_id || '—')}</dd>
                <dt>CLUB ID</dt><dd>${escapeHtml(member.club_id)}</dd>
            </dl>
            <div class="idc-sign">
                ${settings.card_signature ? `<img src="${escapeHtml(photoUrl(settings.card_signature))}" alt="">` : ''}
                <span>Moderator</span>
            </div>
            <div class="idc-band">${escapeHtml(CARD_SLOGAN)}</div>
        </div>`;
}

function cardBack(member, qrUrl, settings) {
    const rules = (settings.card_back_text || DEFAULT_BACK_TEXT).split('\n').map(r => r.trim()).filter(Boolean);
    const contact = [
        settings.address,
        settings.contact_email && `E-mail: ${settings.contact_email}`,
        settings.website && `Website: ${settings.website}`,
    ].filter(Boolean);
    return `
        <div class="id-card idc-back" aria-label="Back of ${escapeHtml(member.name)}'s card">
            <b class="idc-nb">N.B.</b>
            ${rules.map(r => `<p>${escapeHtml(r)}</p>`).join('')}
            <p>If found, please return this card to the Moderator's Office:</p>
            <p class="idc-club"><b>Notre Dame University Bangladesh Computer Club</b></p>
            <p class="idc-contact">${contact.map(escapeHtml).join('<br>')}</p>
            <div class="idc-qr">
                <img src="${escapeHtml(qrUrl)}" alt="QR code to verify this card">
                <b>${escapeHtml(member.club_id)}</b>
            </div>
        </div>`;
}

async function loadCards() {
    if (!memberIds.length) return warn('No members chosen. Open this page from the Members list.');

    let members, settings;
    try {
        [members, settings] = await Promise.all([adminApi('/members'), api('/settings')]);
    } catch (err) {
        return warn(err.message);
    }

    const chosen = memberIds.map(id => members.find(m => m.id === id)).filter(Boolean);
    const noClubId = chosen.filter(m => !m.club_id);
    const printable = chosen.filter(m => m.club_id);

    // a card needs a club ID (the QR code points to it); the rest are only reminders
    if (noClubId.length) warn(`Skipped (no club ID yet): ${nameList(noClubId)}. Add club IDs in Members → Edit.`);
    const unpaid = printable.filter(m => m.fee_paid !== 1);
    if (unpaid.length) warn(`Fee not paid yet: ${nameList(unpaid)}. You can still print, but the club usually issues cards after payment.`);
    const noPhoto = printable.filter(m => !m.photo_path);
    if (noPhoto.length) warn(`No photo: ${nameList(noPhoto)}. Upload one in Members → Photo for a proper card.`);
    if (!settings.card_signature) warn('No moderator signature yet, so the signature line will be empty. Upload one in Settings > Membership card.');
    const missingContact = [!settings.address && 'address', !settings.contact_email && 'email', !settings.website && 'website'].filter(Boolean);
    if (missingContact.length) warn(`The back of the card has no ${missingContact.join(', ')} yet. Add ${missingContact.length === 1 ? 'it' : 'them'} in Settings > Club info.`);
    if (settings.card_valid_until && new Date(`${settings.card_valid_until}T23:59`) < new Date()) {
        warn('The "Cards valid until" date in Settings has already passed, so these cards would show as expired.');
    }
    if (!printable.length) return;

    let qrUrls;
    try {
        qrUrls = await Promise.all(printable.map(m => qrImage(m.id)));
    } catch (err) {
        return warn(err.message);
    }

    // the card shows the club ID under the QR code, so each member gets their own back
    sheet.innerHTML = printable.map((m, i) => `
        <div class="card-pair">${cardFront(m, settings)}${cardBack(m, qrUrls[i], settings)}</div>`).join('');
    await fitNames();

    document.title = printable.length === 1 ? `${printable[0].name} — Membership Card` : `${printable.length} Membership Cards`;
    document.getElementById('card-count').textContent =
        `${printable.length} card${printable.length === 1 ? '' : 's'} · ${Math.ceil(printable.length / 4)} A4 page${printable.length > 4 ? 's' : ''}`;
    document.getElementById('print-btn').disabled = false;
}

// A long name is made just small enough to fit on one line (down to 1.8 mm). Longer still, it goes onto
// two lines in the same row, shrinking again if needed (down to 1.4 mm); only beyond that is it cut with "…".
// Measured once the card font has loaded, since the fallback font has different widths.
async function fitNames() {
    await document.fonts.ready;
    const shrink = (name, min, tooBig) => {
        let size = parseFloat(name.style.fontSize) || 2.2;
        while (tooBig() && size > min) {
            size = Math.round((size - 0.1) * 10) / 10;
            name.style.fontSize = `${size}mm`;
        }
    };
    document.querySelectorAll('.idc-name').forEach(name => {
        name.style.fontSize = '';
        name.classList.remove('idc-name-wrap');
        shrink(name, 1.8, () => name.scrollWidth > name.clientWidth);
        if (name.scrollWidth <= name.clientWidth) return;
        name.classList.add('idc-name-wrap');
        shrink(name, 1.4, () => name.scrollHeight > name.clientHeight + 1);
    });
}

document.getElementById('print-btn').addEventListener('click', () => window.print());

loadCards();
