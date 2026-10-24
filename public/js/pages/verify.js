// Membership check: opened from a card's QR code (verify.html?club_id=...) or by typing a club ID.
const form = document.getElementById('verify-form');
const input = document.getElementById('club_id');
const result = document.getElementById('result');

async function check(clubId) {
    result.innerHTML = '<div class="loading">Checking…</div>';
    try {
        const m = await api(`/verify/${encodeURIComponent(clubId)}`);
        const status = m.active ? '✅ Valid member' : m.expired ? '⏰ Card expired' : '⚠️ Membership not active';
        const explain = m.expired
            ? `This card was valid until ${formatDate(m.valid_until, { withTime: false })}. The member needs a new card.`
            : m.active ? '' : 'This person is registered, but their membership fee hasn\'t been recorded yet.';
        result.innerHTML = `
            <div class="card verify-result ${m.active ? 'is-valid' : 'is-inactive'}">
                ${m.photo_path
                    ? `<img class="avatar" src="${escapeHtml(photoUrl(m.photo_path))}" alt="">`
                    : `<div class="avatar" aria-hidden="true">${escapeHtml(initials(m.name))}</div>`}
                <div class="verify-status">${status}</div>
                <h2>${escapeHtml(m.name)}</h2>
                <p class="meta">Club ID <b>${escapeHtml(m.club_id)}</b>${m.member_since ? ` · Member since ${escapeHtml(m.member_since)}` : ''}
                    ${m.active && m.valid_until ? ` · Valid until ${formatDate(m.valid_until, { withTime: false })}` : ''}</p>
                ${explain ? `<p class="meta">${escapeHtml(explain)}</p>` : ''}
                <p class="meta" style="margin: 8px 0 0;">Check that the photo matches the person holding the card.</p>
            </div>`;
    } catch (err) {
        result.innerHTML = `
            <div class="card verify-result is-invalid">
                <div class="verify-status">❌ Not found</div>
                <p>${escapeHtml(err.message)}</p>
                <p class="meta" style="margin: 0;">If you scanned a card and see this, the card may not be genuine.</p>
            </div>`;
    }
}

form.addEventListener('submit', (e) => {
    e.preventDefault();
    const clubId = input.value.trim();
    if (!clubId) return input.focus();
    history.replaceState(null, '', `?club_id=${encodeURIComponent(clubId)}`);
    check(clubId);
});

const fromQr = new URLSearchParams(location.search).get('club_id');
if (fromQr) {
    input.value = fromQr;
    check(fromQr);
}
