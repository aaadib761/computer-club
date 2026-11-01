// Shared code for every admin page. Load after ../js/common.js.

const TOKEN_KEY = 'ndubcc_admin_token';
const NAME_KEY = 'ndubcc_admin_name';
const THEME_KEY = 'ndubcc_admin_theme';

// ---------- dark mode (remembered in this browser) ----------

function applyTheme() {
    document.body.classList.toggle('dark', storageGet(THEME_KEY) === 'dark');
}
function setDarkMode(on) {
    storageSet(THEME_KEY, on ? 'dark' : 'light');
    applyTheme();
}

// ---------- login token ----------

function storageGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode: stays logged in until refresh */ }
}
function storageRemove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// The token's middle part holds { id, username, role, exp } (it's readable, just not forgeable).
function tokenPayload(token) {
    try {
        const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(base64));
    } catch {
        return null;
    }
}

function currentAdmin() {
    const token = storageGet(TOKEN_KEY);
    const payload = token && tokenPayload(token);
    if (!payload || payload.exp * 1000 < Date.now()) return null;
    // tokens from before roles existed have none; every admin back then was an owner
    return { id: payload.id, username: storageGet(NAME_KEY) || payload.username, role: payload.role || 'owner', token };
}

// Which parts of the panel to show. The server checks the role on every request too;
// this only hides what the admin couldn't use anyway.
const ROLE_LABELS = { owner: 'Owner', editor: 'Editor', checkin: 'Check-in' };
function hasRole(...roles) {
    const admin = currentAdmin();
    return !!admin && roles.includes(admin.role);
}

let loggingOut = false;
function logout(reason) {
    // pages call the API right after loading, so only the first redirect counts
    if (loggingOut) return;
    loggingOut = true;
    storageRemove(TOKEN_KEY);
    storageRemove(NAME_KEY);
    location.href = 'login.html' + (reason ? `?reason=${reason}` : '');
}

function requireLogin() {
    const admin = currentAdmin();
    if (!admin) logout(storageGet(TOKEN_KEY) ? 'expired' : '');
    return admin;
}

// ---------- API with the admin token ----------

// body: a plain object (sent as JSON) or FormData (for photo uploads)
async function adminApi(path, { method = 'GET', body } = {}) {
    const admin = currentAdmin();
    if (!admin) return logout('expired');

    const headers = { Authorization: `Bearer ${admin.token}` };
    let payload;
    if (body instanceof FormData) {
        payload = body;
    } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }

    const res = await fetch(path, { method, headers, body: payload });
    const data = await res.json().catch(() => ({}));

    // only the login check itself means "log in again"; other 401s (like a wrong
    // current password in Settings) are normal errors shown to the user
    const SESSION_ERRORS = ['Authorization header missing', 'Token missing', 'Invalid token',
        'Admin account no longer exists', 'Session ended. Please log in again.'];
    if ((res.status === 401 || res.status === 403) && SESSION_ERRORS.includes(data.error)) {
        logout('expired');
        throw new Error('Please log in again.');
    }
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
}

// ---------- layout ----------

// check-in volunteers only get Events (for the door check-in) and Settings (for their own password);
// owner: true pages are only for owners
const ADMIN_PAGES = [
    { href: 'index.html', label: 'Dashboard', icon: '🏠' },
    { href: 'members.html', label: 'Members', icon: '👥' },
    { href: 'fees.html', label: 'Fees', icon: '💰' },
    { href: 'events.html', label: 'Events', icon: '📅', checkin: true },
    { href: 'announcements.html', label: 'Announcements', icon: '📢' },
    { href: 'about.html', label: 'About & Advisors', icon: '🏫' },
    { href: 'requests.html', label: 'Join Requests', icon: '✋', count: 'requests' },
    { href: 'messages.html', label: 'Messages', icon: '✉️', count: 'messages' },
    { href: 'activity.html', label: 'Activity', icon: '🕘', owner: true },
    { href: 'settings.html', label: 'Settings', icon: '⚙️', checkin: true },
];

function renderAdminLayout(activeHref) {
    const admin = requireLogin();
    if (!admin) return null;

    const pages = ADMIN_PAGES.filter(p => (p.owner ? admin.role === 'owner' : admin.role !== 'checkin' || p.checkin));
    // a page this role can't use (e.g. after logging in, which opens the Dashboard): go to the first one it can
    if (!pages.some(p => p.href === activeHref)) {
        location.replace(pages[0].href);
        return null;
    }

    const main = document.querySelector('.admin-main');
    const shell = document.createElement('div');
    shell.className = 'admin-shell';

    const links = pages.map(p => `
        <a href="${p.href}" class="${p.href === activeHref ? 'active' : ''}">
            <span class="nav-icon">${p.icon}</span>${p.label}
            ${p.count ? `<span class="nav-count hidden" data-count="${p.count}"></span>` : ''}
        </a>`).join('');

    shell.innerHTML = `
        <aside class="admin-side">
            <div class="admin-top">
                <a class="brand" href="index.html">
                    <img src="../images/logo.png" alt="">
                    <span><b>NDUB</b> Admin</span>
                </a>
                <button class="nav-toggle" aria-label="Open menu" aria-expanded="false">&#9776;</button>
            </div>
            <nav class="admin-nav">
                ${links}
                <hr>
                <a href="../index.html" target="_blank" rel="noopener"><span class="nav-icon">🌐</span>View website</a>
                <button type="button" id="logout-btn"><span class="nav-icon">🚪</span>Log out</button>
                <div class="admin-user">Logged in as <b>${escapeHtml(admin.username)}</b> · ${ROLE_LABELS[admin.role] || escapeHtml(admin.role)}</div>
            </nav>
        </aside>`;
    main.replaceWith(shell);
    shell.appendChild(main);

    const toggle = shell.querySelector('.nav-toggle');
    const nav = shell.querySelector('.admin-nav');
    toggle.addEventListener('click', () => {
        const open = nav.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open);
    });
    shell.querySelector('#logout-btn').addEventListener('click', () => logout());

    // anything marked data-roles="owner editor" is only shown to those roles
    document.querySelectorAll('[data-roles]').forEach(el => {
        el.classList.toggle('hidden', !el.dataset.roles.split(' ').includes(admin.role));
    });

    if (admin.role !== 'checkin') refreshNavCounts();
    return admin;
}

// Little orange numbers next to Join Requests (pending) and Messages (total).
async function refreshNavCounts() {
    try {
        const [requests, messages] = await Promise.all([adminApi('/join-requests'), adminApi('/contact')]);
        setNavCount('requests', requests.filter(r => r.status === 'pending').length);
        setNavCount('messages', messages.length);
    } catch { /* counts are optional */ }
}

function setNavCount(name, value) {
    const el = document.querySelector(`[data-count="${name}"]`);
    if (!el) return;
    el.textContent = value;
    el.classList.toggle('hidden', !value);
}

// ---------- small UI helpers ----------

let toastTimer;
function toast(message, type = 'success') {
    let el = document.querySelector('.toast');
    if (!el) {
        el = document.createElement('div');
        el.className = 'toast';
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle('error', type === 'error');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// Opens a <dialog class="modal">; any [data-close] button inside closes it.
function openModal(dialog) {
    dialog.querySelectorAll('[data-close]').forEach(btn => { btn.onclick = () => dialog.close(); });
    const message = dialog.querySelector('.form-message');
    if (message) message.className = 'form-message hidden';
    dialog.showModal();
}

function fillForm(form, data) {
    form.reset();
    Object.entries(data).forEach(([key, value]) => {
        const field = form.elements[key];
        if (field && field.type !== 'file') field.value = value ?? '';
    });
}

// Form fields as an object, with text trimmed.
function readForm(form) {
    const data = {};
    new FormData(form).forEach((value, key) => {
        data[key] = typeof value === 'string' ? value.trim() : value;
    });
    return data;
}

// Disables the submit button while saving, shows errors inside the form.
async function submitting(form, work) {
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector('.form-message');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
        await work();
    } catch (err) {
        if (message) showMessage(message, 'error', err.message);
        else toast(err.message, 'error');
    } finally {
        button.disabled = false;
        button.textContent = label;
    }
}

// Our own confirmation box, styled like the rest of the panel (instead of the browser's confirm()).
// Usage: if (!(await confirmBox({ title: 'Delete photo?', message: '...' }))) return;
let confirmDialogEl = null;
function confirmBox({ title, message = '', confirmText = 'Delete', danger = true }) {
    if (!confirmDialogEl) {
        confirmDialogEl = document.createElement('dialog');
        confirmDialogEl.className = 'modal confirm-modal';
        confirmDialogEl.innerHTML = `
            <form method="dialog">
                <div class="confirm-icon" aria-hidden="true">⚠️</div>
                <h2></h2>
                <p class="confirm-message"></p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" value="cancel">Cancel</button>
                    <button type="button" class="btn confirm-ok" value="ok"></button>
                </div>
            </form>`;
        document.body.appendChild(confirmDialogEl);
    }
    const dialog = confirmDialogEl;
    // textContent keeps names like "<b>Rahim</b>" as plain text
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('.confirm-message').textContent = message;
    dialog.querySelector('.confirm-message').classList.toggle('hidden', !message);
    const ok = dialog.querySelector('.confirm-ok');
    ok.textContent = confirmText;
    ok.className = `btn confirm-ok ${danger ? 'btn-danger-solid' : ''}`;
    dialog.querySelector('.confirm-icon').classList.toggle('hidden', !danger);

    return new Promise(resolve => {
        const finish = (answer) => {
            dialog.removeEventListener('close', onClose);
            dialog.removeEventListener('click', onClick);
            if (dialog.open) dialog.close();
            resolve(answer);
        };
        const onClose = () => finish(false);  // Escape key
        const onClick = (e) => {
            if (e.target === dialog) return finish(false);  // clicked the dark background
            const button = e.target.closest('button[value]');
            if (button) finish(button.value === 'ok');
        };
        dialog.addEventListener('close', onClose);
        dialog.addEventListener('click', onClick);
        dialog.showModal();
        dialog.querySelector('.btn-ghost').focus();  // safe default: Enter cancels
    });
}

// Fallback when the browser blocks copying: show the address selected, ready for Ctrl+C.
function showCopyBox(text) {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal confirm-modal';
    dialog.innerHTML = `
        <form method="dialog">
            <h2>Copy this email address</h2>
            <p class="confirm-message">Press Ctrl + C (or long-press on a phone) to copy it.</p>
            <div class="field"><input readonly aria-label="Email address"></div>
            <div class="modal-actions"><button class="btn">Done</button></div>
        </form>`;
    document.body.appendChild(dialog);
    const input = dialog.querySelector('input');
    input.value = text;
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
    input.select();
}

// "Copy email" works with any email service (Gmail, Outlook…), unlike mailto: links,
// which need an email app installed. Buttons look like: <button data-copy="a@b.com">
document.addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-copy]');
    if (!button) return;
    try {
        await navigator.clipboard.writeText(button.dataset.copy);
        toast(`Copied ${button.dataset.copy}`);
    } catch {
        // clipboard can be blocked (e.g. not on localhost/https); let them copy by hand
        showCopyBox(button.dataset.copy);
    }
});

// Adds a Show/Hide button to every password field on the page.
function addPasswordToggles() {
    document.querySelectorAll('input[type="password"]').forEach(input => {
        const wrap = document.createElement('div');
        wrap.className = 'password-wrap';
        input.replaceWith(wrap);
        wrap.appendChild(input);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'password-toggle';
        wrap.appendChild(button);

        const setVisible = (visible) => {
            input.type = visible ? 'text' : 'password';
            button.textContent = visible ? '🙈 Hide' : '👁 Show';
            button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
            button.setAttribute('aria-pressed', visible);
        };
        setVisible(false);

        button.addEventListener('click', () => {
            setVisible(input.type === 'password');
            input.focus();
        });
        // clearing the form hides the password again
        input.form?.addEventListener('reset', () => setVisible(false));
    });
}
addPasswordToggles();
applyTheme();

// ---------- downloads ----------

// Downloads a file from an admin-only URL (a plain link can't send the login token).
async function downloadFile(button, url, fallbackName) {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparing…';
    try {
        const admin = currentAdmin();
        if (!admin) return logout('expired');
        const res = await fetch(url, { headers: { Authorization: `Bearer ${admin.token}` } });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed');
        const name = (res.headers.get('Content-Disposition') || '').match(/filename="(.+)"/)?.[1] || fallbackName;
        const blobUrl = URL.createObjectURL(await res.blob());
        const link = Object.assign(document.createElement('a'), { href: blobUrl, download: name });
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        toast(`Downloaded ${name}`);
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        button.disabled = false;
        button.textContent = label;
    }
}

const DOWNLOAD_FORMATS = [
    { format: 'xlsx', label: '📗 Excel (.xlsx)' },
    { format: 'csv', label: '📄 CSV' },
    { format: 'pdf', label: '📕 PDF / Print' },
];

// A "Download" button with a menu of formats for one of the /export lists.
// getParams() returns extra query values at the moment of download, e.g. { event: 7 } or { ids: '1,2,3' },
// or null to cancel (after telling the user why).
function downloadMenu(type, { label = '⬇️ Download', getParams = () => ({}), small = false } = {}) {
    const menu = document.createElement('details');
    menu.className = 'download-menu';
    menu.innerHTML = `
        <summary class="btn btn-ghost${small ? ' btn-sm' : ''}">${escapeHtml(label)}</summary>
        <div class="download-options">
            ${DOWNLOAD_FORMATS.map(f => `<button type="button" data-format="${f.format}">${f.label}</button>`).join('')}
        </div>`;
    menu.addEventListener('click', (e) => {
        const option = e.target.closest('[data-format]');
        if (!option) return;
        menu.open = false;
        const extra = getParams();
        if (extra === null) return;
        const params = new URLSearchParams(extra);
        if (option.dataset.format === 'pdf') {
            // the print page shows the list as a table; "Save as PDF" in the print window makes the PDF
            params.set('type', type);
            window.open(`list.html?${params}`, '_blank');
            return;
        }
        params.set('format', option.dataset.format);
        downloadFile(menu.querySelector('summary'), `/export/${type}?${params}`, `${type}.${option.dataset.format}`);
    });
    return menu;
}

// only one menu open at a time, and a click anywhere else closes it
document.addEventListener('click', (e) => {
    document.querySelectorAll('details.download-menu[open]').forEach(menu => {
        if (!menu.contains(e.target)) menu.open = false;
    });
});

function statusBadge(status) {
    return `<span class="badge badge-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function avatarHtml(member) {
    return member.photo_path
        ? `<img class="avatar" src="${escapeHtml(photoUrl(member.photo_path))}" alt="">`
        : `<div class="avatar" aria-hidden="true">${escapeHtml(initials(member.name))}</div>`;
}
