// Printable membership cards, front + back: card.html?id=12 (one member) or card.html?ids=12,15,20 (many).
requireLogin();

const params = new URLSearchParams(location.search);
const memberIds = (params.get('ids') || params.get('id') || '')
    .split(',').map(Number).filter(id => Number.isInteger(id) && id > 0);
const warnings = document.getElementById('card-warnings');
const sheet = document.getElementById('card-sheet');

const DEFAULT_BACK_TEXT = 'This card is the property of NDUB Computer Club.\nShow this card at club events.\nThis card is not transferable.';

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

function cardFront(member, qrUrl, validUntil) {
    const bottomRight = validUntil
        ? `Valid until ${formatDate(validUntil, { withTime: false })}`
        : `Member since ${String(member.created_at || '').slice(0, 4)}`;
    return `
        <div class="id-card" aria-label="Front of ${escapeHtml(member.name)}'s card">
            <div class="id-card-top">
                <img src="../images/logo.png" alt="">
                <div><b>NDUB COMPUTER CLUB</b><span>Membership Card</span></div>
            </div>
            <div class="id-card-body">
                <div class="id-card-photo">
                    ${member.photo_path
                        ? `<img src="${escapeHtml(photoUrl(member.photo_path))}" alt="">`
                        : `<span>${escapeHtml(initials(member.name))}</span>`}
                </div>
                <dl class="id-card-details">
                    <dt>Name</dt><dd>${escapeHtml(member.name)}</dd>
                    <dt>Club ID</dt><dd>${escapeHtml(member.club_id)}</dd>
                    <dt>Student ID</dt><dd>${escapeHtml(member.student_id || '—')}</dd>
                    <dt>Department</dt><dd>${escapeHtml([member.department, member.batch].filter(Boolean).join('-') || '—')}</dd>
                </dl>
                <img class="id-card-qr" src="${escapeHtml(qrUrl)}" alt="QR code to verify this card">
            </div>
            <div class="id-card-bottom">
                <span>Notre Dame University Bangladesh</span>
                <span>${escapeHtml(bottomRight)}</span>
            </div>
        </div>`;
}

function cardBack(settings) {
    const rules = (settings.card_back_text || DEFAULT_BACK_TEXT).split('\n').map(r => r.trim()).filter(Boolean);
    const contact = [settings.contact_email, settings.contact_phone].filter(Boolean).join(' · ');
    return `
        <div class="id-card id-card-back" aria-label="Back of card">
            <div class="back-head">NDUB COMPUTER CLUB</div>
            <ul class="back-rules">${rules.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
            <div class="back-return">
                <b>If found, please return to NDUB Computer Club</b>
                ${contact ? `<span>${escapeHtml(contact)}</span>` : ''}
                ${settings.address ? `<span>${escapeHtml(settings.address)}</span>` : ''}
            </div>
            <div class="back-foot">Scan the QR code on the front to check this card is genuine.</div>
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

    const back = cardBack(settings);
    sheet.innerHTML = printable.map((m, i) => `
        <div class="card-pair">${cardFront(m, qrUrls[i], settings.card_valid_until)}${back}</div>`).join('');

    document.title = printable.length === 1 ? `${printable[0].name} — Membership Card` : `${printable.length} Membership Cards`;
    document.getElementById('card-count').textContent =
        `${printable.length} card${printable.length === 1 ? '' : 's'} · ${Math.ceil(printable.length / 4)} A4 page${printable.length > 4 ? 's' : ''}`;
    document.getElementById('print-btn').disabled = false;
}

document.getElementById('print-btn').addEventListener('click', () => window.print());

loadCards();
