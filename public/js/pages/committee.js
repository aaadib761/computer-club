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

loadCommittee();
