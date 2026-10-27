// Admin event page: online registrations and participation certificates.
// Uses eventId from event.js (loaded first).

async function loadRegistrations() {
    const section = document.getElementById('registrations-section');
    const list = document.getElementById('registrations');
    try {
        const [event, registrations] = await Promise.all([
            api(`/events/${encodeURIComponent(eventId)}`),
            adminApi(`/events/${encodeURIComponent(eventId)}/registrations`),
        ]);
        // only show the section when registration is (or was) used for this event
        if (!event.registration_open && !registrations.length) return section.classList.add('hidden');
        section.classList.remove('hidden');

        const checkedIn = registrations.filter(r => r.checked_in).length;
        document.getElementById('registrations-summary').textContent =
            `${registrations.length}${event.capacity ? ` / ${event.capacity}` : ''} registered · ${checkedIn} checked in` +
            (event.registration_open ? '' : ' · registration closed');

        list.innerHTML = registrations.length
            ? registrations.map(r => `
                <div class="row">
                    ${avatarHtml(r)}
                    <div class="row-main">
                        <h3>${escapeHtml(r.name)} ${r.checked_in ? '<span class="badge badge-present">checked in</span>' : ''}</h3>
                        <p class="meta">${[r.club_id ? `Club ${escapeHtml(r.club_id)}` : '', [r.department, r.batch].filter(Boolean).map(escapeHtml).join('-'),
                            `registered ${formatDate(r.created_at, { isUtc: true })}`].filter(Boolean).join(' · ')}</p>
                    </div>
                    ${hasRole('checkin') ? '' : `<button class="btn btn-sm btn-danger" data-remove-registration="${r.member_id}" data-name="${escapeHtml(r.name)}">Remove</button>`}
                </div>`).join('')
            : '<div class="empty">Nobody has registered yet. Share the event link so members can sign up.</div>';
    } catch (err) {
        section.classList.remove('hidden');
        list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

document.getElementById('registrations').addEventListener('click', async (e) => {
    const button = e.target.closest('[data-remove-registration]');
    if (!button) return;
    if (!(await confirmBox({ title: `Remove ${button.dataset.name}'s registration?`, message: 'Their seat becomes free for someone else.', confirmText: 'Remove' }))) return;
    try {
        await adminApi(`/events/${encodeURIComponent(eventId)}/registrations/${button.dataset.removeRegistration}`, { method: 'DELETE' });
        toast('Registration removed');
        loadRegistrations();
    } catch (err) {
        toast(err.message, 'error');
    }
});

async function loadCertificates() {
    const section = document.getElementById('certificates-section');
    const list = document.getElementById('certificates');
    if (hasRole('checkin')) return;  // certificates are for editors and owners
    try {
        const event = await api(`/events/${encodeURIComponent(eventId)}`);
        if (isUpcoming(event.date) && eventStatus(event).key !== 'today') return section.classList.add('hidden');
        const certificates = await adminApi(`/events/${encodeURIComponent(eventId)}/certificates`);
        section.classList.remove('hidden');
        list.innerHTML = certificates.length
            ? certificates.map(c => `
                <div class="row">
                    <div class="row-main">
                        <h3>${escapeHtml(c.name)}</h3>
                        <p class="meta">Certificate ${escapeHtml(c.code)}</p>
                    </div>
                    <a class="btn btn-sm btn-ghost" href="../certificate.html?code=${encodeURIComponent(c.code)}" target="_blank" rel="noopener">Open certificate</a>
                </div>`).join('')
            : '<div class="empty">No one is marked present or late yet, so there are no certificates.</div>';
    } catch (err) {
        section.classList.remove('hidden');
        list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

// attendance changes (buttons or check-in) can change who gets a certificate
function refreshEventExtras() {
    loadRegistrations();
    loadCertificates();
}
document.getElementById('attendance').addEventListener('click', (e) => {
    if (e.target.closest('button[data-status]')) setTimeout(refreshEventExtras, 400);
});

refreshEventExtras();
