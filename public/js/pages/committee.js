async function loadCommittee() {
    const box = document.getElementById('committee');
    try {
        const members = await api('/members/executive');
        if (members.length === 0) {
            box.innerHTML = '<div class="empty">The committee will be announced soon.</div>';
            return;
        }
        box.innerHTML = members.map(m => `
            <article class="card member-card">
                ${m.photo_path
                    ? `<img class="avatar" src="${escapeHtml(photoUrl(m.photo_path))}" alt="${escapeHtml(m.name)}" loading="lazy">`
                    : `<div class="avatar" aria-hidden="true">${escapeHtml(initials(m.name))}</div>`}
                <h3>${escapeHtml(m.name)}</h3>
                <p class="role">${escapeHtml(m.position || 'Member')}</p>
            </article>`).join('');
    } catch (err) {
        box.innerHTML = `<div class="empty">Couldn't load the committee. ${escapeHtml(err.message)}</div>`;
    }
}

// e.g. "13th Executive Committee", set in Admin > About & Advisors
async function loadTerm() {
    const info = await clubInfo();
    if (!info.committee_term) return;
    const label = document.getElementById('term-label');
    label.textContent = info.committee_term;
    label.classList.remove('hidden');
}

async function loadPastCommittees() {
    try {
        const terms = await api('/committee-archive');
        if (!terms.length) return;
        document.getElementById('past-committees').innerHTML = terms.map(t => `
            <details class="past-term">
                <summary>${escapeHtml(t.term)}</summary>
                <ul>${t.members.map(m => `<li>${escapeHtml(m.name)} <span>— ${escapeHtml(m.position)}</span></li>`).join('')}</ul>
            </details>`).join('');
        document.getElementById('past-section').classList.remove('hidden');
    } catch { /* past committees are optional */ }
}

loadCommittee();
loadTerm();
loadPastCommittees();
