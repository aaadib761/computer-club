// Member portal: log in (or set up an account the first time), then see your card, events and certificates.

const MEMBER_TOKEN_KEY = 'ndubcc_member_token';

function memberToken() {
    try { return localStorage.getItem(MEMBER_TOKEN_KEY); } catch { return null; }
}
function saveMemberToken(token) {
    try {
        if (token) localStorage.setItem(MEMBER_TOKEN_KEY, token);
        else localStorage.removeItem(MEMBER_TOKEN_KEY);
    } catch { /* private mode: stays logged in until the page closes */ }
}

// api() with the member's login attached; an ended session sends them back to the login form
async function memberApi(path, options = {}) {
    try {
        return await api(path, { ...options, headers: { Authorization: `Bearer ${memberToken()}` } });
    } catch (err) {
        if (/log in/i.test(err.message)) showLoggedOut('Your session ended. Please log in again.');
        throw err;
    }
}

const authSection = document.getElementById('auth');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('login-form');
const firstTimeForm = document.getElementById('setup-form');

// ---------- logged out ----------

function showTab(name) {
    document.querySelectorAll('.portal-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
    loginForm.classList.toggle('hidden', name !== 'login');
    firstTimeForm.classList.toggle('hidden', name !== 'setup');
}
document.querySelectorAll('.portal-tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

function showLoggedOut(notice) {
    saveMemberToken(null);
    dashboard.classList.add('hidden');
    authSection.classList.remove('hidden');
    showTab('login');
    if (notice) showMessage(loginForm.querySelector('.form-message'), 'error', notice);
}

// Sends one of the two forms; on success the server gives back a login token.
function setupAuthForm(form, path, check) {
    const message = form.querySelector('.form-message');
    const button = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        const problem = check(data);
        if (problem) return showMessage(message, 'error', problem);
        delete data.confirm;
        button.disabled = true;
        try {
            const { token } = await api(path, { method: 'POST', body: JSON.stringify(data) });
            saveMemberToken(token);
            form.reset();
            message.classList.add('hidden');
            loadDashboard();
        } catch (err) {
            showMessage(message, 'error', err.message);
        } finally {
            button.disabled = false;
        }
    });
}

setupAuthForm(loginForm, '/portal/login', d => (!d.club_id.trim() || !d.password ? 'Please enter your club ID and password.' : null));
setupAuthForm(firstTimeForm, '/portal/setup', d => {
    if (!d.club_id.trim() || !d.student_id.trim() || !d.email.trim()) return 'Please fill in your club ID, student ID and email.';
    if (d.password.length < 8) return 'Your password must be at least 8 characters.';
    if (d.password !== d.confirm) return "The two passwords don't match.";
    return null;
});

// ---------- logged in ----------

let qrUrl;

async function loadDashboard() {
    authSection.classList.add('hidden');
    dashboard.classList.remove('hidden');
    try {
        const data = await memberApi('/portal/me');
        renderProfile(data.member);
        renderCard(data.member, data.card);
        renderEvents(data.events);
        renderAttended(data.attended);
        document.getElementById('page-sub').textContent = `Welcome back, ${data.member.name.split(' ')[0]}!`;
    } catch (err) {
        if (memberToken()) document.getElementById('events').innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

function renderProfile(m) {
    const rows = [
        ['Club ID', m.club_id],
        ['Student ID', m.student_id],
        ['Department', [m.department, m.batch && `Batch ${m.batch}`].filter(Boolean).join(' · ')],
        ['Email', m.email],
        ['Phone', m.phone],
        ['Member since', formatDate(m.created_at, { isUtc: true, withTime: false })],
    ].filter(([, value]) => value);
    document.getElementById('profile').innerHTML = `
        ${m.photo_path
            ? `<img class="avatar" src="${escapeHtml(photoUrl(m.photo_path))}" alt="">`
            : `<div class="avatar" aria-hidden="true">${escapeHtml(initials(m.name))}</div>`}
        <h2>${escapeHtml(m.name)}</h2>
        ${m.position ? `<p class="meta">${escapeHtml(m.position)}</p>` : ''}
        <ul class="info-list">
            ${rows.map(([label, value]) => `<li><span class="meta">${label}</span><br>${escapeHtml(value)}</li>`).join('')}
        </ul>
        <p class="hint">Something wrong? Ask a committee member to fix it.</p>`;
}

async function renderCard(m, card) {
    const box = document.getElementById('member-card');
    const status = card.active
        ? '<span class="tag tag-upcoming">✅ Active</span>'
        : card.expired ? '<span class="tag">⏰ Card expired</span>' : '<span class="tag">⚠️ Fee not recorded yet</span>';
    box.innerHTML = `
        <h3>Membership card</h3>
        <p>${status}</p>
        ${card.valid_until ? `<p class="meta">Valid until ${formatDate(card.valid_until, { withTime: false })}</p>` : ''}
        <div class="portal-qr"><div class="loading">Loading QR code…</div></div>
        <p class="hint">Show this QR code at event check-in, or let someone scan it to check your membership.</p>`;
    if (!m.club_id) {
        box.querySelector('.portal-qr').innerHTML = '<div class="empty">You don\'t have a club ID yet.</div>';
        return;
    }
    // the QR image needs the login token, so it's fetched and shown from memory
    try {
        const res = await fetch('/portal/qr', { headers: { Authorization: `Bearer ${memberToken()}` } });
        if (!res.ok) throw new Error();
        if (qrUrl) URL.revokeObjectURL(qrUrl);
        qrUrl = URL.createObjectURL(await res.blob());
        box.querySelector('.portal-qr').innerHTML = `<img src="${qrUrl}" alt="QR code for club ID ${escapeHtml(m.club_id)}">`;
    } catch {
        box.querySelector('.portal-qr').innerHTML = '<div class="empty">Could not load the QR code.</div>';
    }
}

function renderEvents(events) {
    const box = document.getElementById('events');
    if (!events.length) {
        box.innerHTML = '<div class="empty">No events are open for registration right now. Check the <a href="events.html">events page</a> for news.</div>';
        return;
    }
    box.innerHTML = events.map(e => {
        const seats = e.seats_left === null ? '' : ` · ${e.seats_left} seat${e.seats_left === 1 ? '' : 's'} left`;
        let action;
        if (e.registered) action = `<span class="tag tag-upcoming">✅ Registered</span> <button class="btn btn-outline btn-small" data-cancel="${e.id}">Cancel</button>`;
        else if (!e.registration_open) action = '<span class="tag">Registration closed</span>';
        else if (e.seats_left === 0) action = '<span class="tag">Full</span>';
        else action = `<button class="btn btn-small" data-register="${e.id}">Register</button>`;
        return `<div class="card portal-event">
            ${dateBadge(e.date)}
            <div class="portal-event-body">
                <h3><a href="event.html?id=${encodeURIComponent(e.id)}">${escapeHtml(e.title)}</a></h3>
                <p class="meta">${formatDate(e.date)}${e.venue ? ` · 📍 ${escapeHtml(e.venue)}` : ''}${e.registration_open ? seats : ''}</p>
                <div class="portal-actions">${action}</div>
            </div>
        </div>`;
    }).join('');
}

document.getElementById('events').addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-register], button[data-cancel]');
    if (!button) return;
    const cancel = 'cancel' in button.dataset;
    button.disabled = true;
    try {
        await memberApi(`/portal/events/${cancel ? button.dataset.cancel : button.dataset.register}/${cancel ? 'unregister' : 'register'}`, { method: 'POST' });
        loadDashboard();
    } catch (err) {
        button.disabled = false;
        alert(err.message);
    }
});

function renderAttended(events) {
    const box = document.getElementById('attended');
    if (!events.length) {
        box.innerHTML = '<div class="empty">No attended events yet. Your certificates will appear here after you attend an event.</div>';
        return;
    }
    box.innerHTML = events.map(e => `
        <div class="card portal-event">
            ${dateBadge(e.date)}
            <div class="portal-event-body">
                <h3><a href="event.html?id=${encodeURIComponent(e.id)}">${escapeHtml(e.title)}</a></h3>
                <p class="meta">${formatDate(e.date)}${e.category ? ` · ${escapeHtml(e.category)}` : ''}${e.status === 'late' ? ' · arrived late' : ''}</p>
                ${e.certificate ? `<div class="portal-actions"><a class="btn btn-outline btn-small" href="certificate.html?code=${encodeURIComponent(e.certificate)}">🎓 View certificate</a></div>` : ''}
            </div>
        </div>`).join('');
}

// ---------- account ----------

const passwordForm = document.getElementById('password-form');
passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = passwordForm.querySelector('.form-message');
    const data = Object.fromEntries(new FormData(passwordForm));
    if (!data.oldPassword || (data.newPassword || '').length < 8) {
        return showMessage(message, 'error', 'Enter your current password and a new one of at least 8 characters.');
    }
    const button = passwordForm.querySelector('button');
    button.disabled = true;
    try {
        const { token } = await memberApi('/portal/password', { method: 'PUT', body: JSON.stringify(data) });
        saveMemberToken(token);
        passwordForm.reset();
        showMessage(message, 'success', 'Password changed. Other devices have been logged out.');
    } catch (err) {
        showMessage(message, 'error', err.message);
    } finally {
        button.disabled = false;
    }
});

document.getElementById('logout-btn').addEventListener('click', () => showLoggedOut());
document.getElementById('logout-all-btn').addEventListener('click', async () => {
    if (!confirm('Log out on every device, including this one?')) return;
    try {
        await memberApi('/portal/logout-all', { method: 'POST' });
    } finally {
        showLoggedOut();
    }
});

if (memberToken()) loadDashboard();
