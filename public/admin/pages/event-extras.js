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
        const info = await adminApi(`/events/${encodeURIComponent(eventId)}/certificates`);
        section.classList.remove('hidden');
        const status = document.getElementById('certificates-status');
        const sendBtn = document.getElementById('send-certificates-btn');
        const unsent = info.attendees.filter(c => !c.certificate_sent_at).length;
        const sentCount = info.attendees.length - unsent;
        const endsAt = info.ends_at ? formatDate(info.ends_at, { isUtc: true, withTime: true }) : 'the end of the event';

        if (!info.enabled) {
            status.textContent = 'Certificates are turned off for this event. To give them, edit the event and tick "Give participation certificates".';
        } else if (!info.email) {
            status.innerHTML = 'Email is off, so certificates can\'t be emailed. Members can still open theirs from the event page on the website. Turn email on in <a href="settings.html">Settings</a>.';
        } else if (!info.ended) {
            status.textContent = `Certificates will be emailed automatically to everyone marked present or late when the event ends (${endsAt}).`;
        } else if (info.auto_window_passed && unsent) {
            status.textContent = `This event ended on ${endsAt}. Certificates are only sent automatically for a few days after an event, so use "Send certificates now" for anyone still waiting.`;
        } else {
            status.textContent = `Certificates are emailed automatically after the event (it ended ${endsAt}). Sent to ${sentCount} of ${info.attendees.length}.`;
        }
        sendBtn.classList.toggle('hidden', !(info.enabled && info.email && unsent));
        sendBtn.textContent = `Send certificates now (${unsent})`;

        list.innerHTML = info.attendees.length
            ? info.attendees.map(c => `
                <div class="row">
                    <div class="row-main">
                        <h3>${escapeHtml(c.name)}
                            ${!info.enabled ? '' : c.certificate_sent_at
                                ? `<span class="badge badge-approved" title="Emailed ${formatDate(c.certificate_sent_at, { isUtc: true })}">Emailed</span>`
                                : '<span class="badge badge-pending">Not emailed yet</span>'}</h3>
                        <p class="meta">Certificate ${escapeHtml(c.code)}${c.certificate_sent_at ? ` · emailed ${formatDate(c.certificate_sent_at, { isUtc: true })}` : ''}</p>
                    </div>
                    <div class="btn-group">
                        <a class="btn btn-sm btn-ghost" href="/certificates/${encodeURIComponent(c.code)}/image.png?download=1">Download</a>
                        <a class="btn btn-sm btn-ghost" href="../certificate.html?code=${encodeURIComponent(c.code)}" target="_blank" rel="noopener">Open</a>
                    </div>
                </div>`).join('')
            : '<div class="empty">No one is marked present or late yet, so there are no certificates.</div>';
    } catch (err) {
        section.classList.remove('hidden');
        list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

document.getElementById('send-certificates-btn').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    if (!(await confirmBox({
        title: 'Email certificates now?',
        message: 'Everyone marked present or late who hasn\'t had their certificate yet will get it by email now.',
        confirmText: 'Send',
        danger: false,
    }))) return;
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
        const { sent, failed } = await adminApi(`/events/${encodeURIComponent(eventId)}/certificates/send`, { method: 'POST' });
        toast(failed ? `${sent} sent, ${failed} failed. Check the email settings and try again.` : `${sent} certificate${sent === 1 ? '' : 's'} emailed`, failed ? 'error' : 'success');
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        button.disabled = false;
        loadCertificates();
    }
});

// attendance changes (buttons or check-in) can change who gets a certificate
function refreshEventExtras() {
    loadRegistrations();
    loadCertificates();
}
document.getElementById('attendance').addEventListener('click', (e) => {
    if (e.target.closest('button[data-status]')) setTimeout(refreshEventExtras, 400);
});

refreshEventExtras();
