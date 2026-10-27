const me = renderAdminLayout('settings.html');

// ---------- club info ----------

const clubForm = document.getElementById('club-form');
const cardForm = document.getElementById('card-form');

async function loadClubInfo() {
    try {
        const settings = await api('/settings');
        fillForm(clubForm, settings);
        fillForm(cardForm, settings);
    } catch (err) {
        showMessage(clubForm.querySelector('.form-message'), 'error', err.message);
    }
}

// ---------- membership card ----------

cardForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(cardForm, async () => {
        await adminApi('/settings', { method: 'PUT', body: readForm(cardForm) });
        showMessage(cardForm.querySelector('.form-message'), 'success', 'Card settings saved. New prints and card checks use them.');
    });
});

clubForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = clubForm.querySelector('.form-message');
    const invalid = clubForm.querySelector(':invalid');
    if (invalid) {
        invalid.focus();
        return showMessage(message, 'error', `Please check "${invalid.labels[0].textContent}". Links must start with https://`);
    }
    submitting(clubForm, async () => {
        await adminApi('/settings', { method: 'PUT', body: readForm(clubForm) });
        showMessage(message, 'success', 'Club info saved. It now shows on the website.');
    });
});

// ---------- account ----------

const usernameForm = document.getElementById('username-form');
const passwordForm = document.getElementById('password-form');

usernameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = usernameForm.querySelector('.form-message');
    const data = readForm(usernameForm);
    if (!data.newUsername || !data.currentPassword) return showMessage(message, 'error', 'Please fill in both fields.');
    submitting(usernameForm, async () => {
        await adminApi('/admin/username', { method: 'PUT', body: data });
        storageSet(NAME_KEY, data.newUsername);
        usernameForm.reset();
        showMessage(message, 'success', `Username changed to ${data.newUsername}.`);
        document.querySelector('.admin-user b').textContent = data.newUsername;
        loadAdmins();
    });
});

passwordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = passwordForm.querySelector('.form-message');
    const data = readForm(passwordForm);
    if (!data.oldPassword || !data.newPassword) return showMessage(message, 'error', 'Please fill in all fields.');
    if (data.newPassword.length < 8) return showMessage(message, 'error', 'The new password must be at least 8 characters.');
    if (data.newPassword !== data.confirmPassword) return showMessage(message, 'error', "The new passwords don't match.");
    submitting(passwordForm, async () => {
        const result = await adminApi('/admin/password', {
            method: 'PUT',
            body: { oldPassword: data.oldPassword, newPassword: data.newPassword },
        });
        // the old token stopped working; keep this browser logged in with the new one
        storageSet(TOKEN_KEY, result.token);
        passwordForm.reset();
        showMessage(message, 'success', 'Password changed. Other devices have been logged out.');
        loadAdmins();
    });
});

// ---------- 2-step login ----------

const twofaText = document.getElementById('twofa-text');
const twofaBadge = document.getElementById('twofa-badge');
const twofaActions = document.getElementById('twofa-actions');
const twofaSetupDialog = document.getElementById('twofa-setup-dialog');
const twofaSetupForm = document.getElementById('twofa-setup-form');
const recoveryDialog = document.getElementById('recovery-dialog');
const confirmDialog = document.getElementById('twofa-confirm-dialog');
const confirmForm = document.getElementById('twofa-confirm-form');
let confirmMode = 'disable';   // or 'codes' (make new recovery codes)
let shownCodes = [];

async function loadTwoFactor() {
    try {
        const status = await adminApi('/admin/2fa');
        twofaBadge.innerHTML = status.enabled ? '<span class="badge badge-approved">On</span>' : '<span class="badge badge-pending">Off</span>';
        if (status.enabled) {
            const left = status.recovery_codes_left;
            twofaText.textContent = `Logging in needs your password and a code from your phone. ${left} recovery code${left === 1 ? '' : 's'} left${left <= 3 ? ', so consider making new ones' : ''}.`;
            twofaActions.innerHTML = `
                <button type="button" class="btn btn-sm btn-ghost" data-twofa="codes">New recovery codes</button>
                <button type="button" class="btn btn-sm btn-danger" data-twofa="disable">Turn off</button>`;
        } else {
            twofaText.textContent = 'Protects your account even if someone learns your password: logging in also needs a code from an app on your phone.';
            twofaActions.innerHTML = '<button type="button" class="btn btn-sm" data-twofa="setup">Turn on</button>';
        }
    } catch (err) {
        twofaText.textContent = err.message;
    }
}

twofaActions.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-twofa]')?.dataset.twofa;
    if (action === 'setup') {
        try {
            const { qr, secret } = await adminApi('/admin/2fa/setup', { method: 'POST' });
            document.getElementById('twofa-qr').src = qr;
            document.getElementById('twofa-secret').textContent = secret;
            twofaSetupForm.reset();
            openModal(twofaSetupDialog);
            twofaSetupForm.elements.code.focus();
        } catch (err) {
            toast(err.message, 'error');
        }
    }
    if (action === 'disable' || action === 'codes') {
        confirmMode = action;
        const disabling = action === 'disable';
        document.getElementById('twofa-confirm-title').textContent = disabling ? 'Turn off 2-step login' : 'Make new recovery codes';
        document.getElementById('twofa-confirm-password-field').classList.toggle('hidden', !disabling);
        document.getElementById('twofa-confirm-code-label').textContent = disabling ? 'Code from your app (or a recovery code)' : 'Code from your app';
        document.getElementById('twofa-confirm-submit').textContent = disabling ? 'Turn off' : 'Make new codes';
        confirmForm.reset();
        openModal(confirmDialog);
    }
});

twofaSetupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = twofaSetupForm.elements.code.value.trim();
    if (!code) return showMessage(twofaSetupForm.querySelector('.form-message'), 'error', 'Type the 6-digit code from your app.');
    submitting(twofaSetupForm, async () => {
        const { recovery_codes } = await adminApi('/admin/2fa/enable', { method: 'POST', body: { code } });
        twofaSetupDialog.close();
        toast('2-step login is on');
        showRecoveryCodes(recovery_codes);
        loadTwoFactor();
    });
});

confirmForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const { password, code } = readForm(confirmForm);
    const message = confirmForm.querySelector('.form-message');
    if (!code || (confirmMode === 'disable' && !password)) return showMessage(message, 'error', 'Please fill in both fields.');
    submitting(confirmForm, async () => {
        if (confirmMode === 'disable') {
            await adminApi('/admin/2fa/disable', { method: 'POST', body: { password, code } });
            toast('2-step login is off');
        } else {
            const { recovery_codes } = await adminApi('/admin/2fa/recovery-codes', { method: 'POST', body: { code } });
            showRecoveryCodes(recovery_codes);
        }
        confirmDialog.close();
        loadTwoFactor();
    });
});

function showRecoveryCodes(codes) {
    shownCodes = codes;
    document.getElementById('recovery-codes').innerHTML = codes.map(c => `<li>${escapeHtml(c)}</li>`).join('');
    recoveryDialog.showModal();
}

const recoveryText = () => `NDUB Computer Club admin recovery codes for ${me.username}\n` +
    `Each code works once. Made ${new Date().toLocaleDateString('en-GB')}.\n\n${shownCodes.join('\n')}\n`;

document.getElementById('recovery-copy').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(recoveryText());
        toast('Recovery codes copied');
    } catch {
        showCopyBox(shownCodes.join('  '));
    }
});

document.getElementById('recovery-download').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([recoveryText()], { type: 'text/plain' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `ndubcc-recovery-codes-${me.username}.txt` });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ---------- appearance ----------

const darkToggle = document.getElementById('dark-toggle');
darkToggle.checked = document.body.classList.contains('dark');
darkToggle.addEventListener('change', () => setDarkMode(darkToggle.checked));

// ---------- export and backups ----------

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

document.querySelectorAll('[data-export]').forEach(button => {
    button.addEventListener('click', () => downloadFile(button, `/export/${button.dataset.export}`, 'export.csv'));
});

// ---------- email ----------

const emailStatus = document.getElementById('email-status');
const emailTestForm = document.getElementById('email-test-form');

async function loadEmailStatus() {
    try {
        const status = await adminApi('/email/status');
        if (status.configured) {
            emailStatus.innerHTML = `✅ Email is on. Messages are sent from <b>${escapeHtml(status.from)}</b>.`;
            emailTestForm.classList.remove('hidden');
            emailTestForm.elements.to.value ||= status.from;
        } else {
            emailStatus.innerHTML = '⚠️ Email is off. To turn it on, add <b>GMAIL_USER</b> and <b>GMAIL_APP_PASSWORD</b> to the server\'s <b>.env</b> file (the steps are in <b>.env.example</b>), then restart the server.';
        }
    } catch (err) {
        emailStatus.textContent = err.message;
    }
}

emailTestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const to = emailTestForm.elements.to.value.trim();
    if (!to || !emailTestForm.elements.to.checkValidity()) return toast('Please enter a valid email address.', 'error');
    const button = emailTestForm.querySelector('button');
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
        const result = await adminApi('/email/test', { method: 'POST', body: { to } });
        toast(result.message);
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'Send test email';
    }
});

const backupsList = document.getElementById('backups');
const backupNowBtn = document.getElementById('backup-now-btn');

function formatSize(bytes) {
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function loadBackups() {
    try {
        const backups = await adminApi('/backups');
        backupsList.innerHTML = backups.length ? backups.map((b, i) => `
            <div class="row">
                <div class="avatar" aria-hidden="true">DB</div>
                <div class="row-main">
                    <h3>${formatDate(b.created_at, { isUtc: true })} ${i === 0 ? '<span class="badge badge-role">newest</span>' : ''}</h3>
                    <p class="meta">${escapeHtml(b.name)} · ${formatSize(b.size)}</p>
                </div>
                <button class="btn btn-sm btn-ghost" data-backup="${escapeHtml(b.name)}">Download</button>
            </div>`).join('')
            : '<div class="empty">No backups yet. The first one is made a few seconds after the server starts.</div>';
    } catch (err) {
        backupsList.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

backupsList.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-backup]');
    if (button) downloadFile(button, `/backups/${encodeURIComponent(button.dataset.backup)}`, button.dataset.backup);
});

backupNowBtn.addEventListener('click', async () => {
    backupNowBtn.disabled = true;
    try {
        await adminApi('/backups', { method: 'POST' });
        toast('Backup saved');
        loadBackups();
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        backupNowBtn.disabled = false;
    }
});

// ---------- security ----------

document.getElementById('logout-all-btn').addEventListener('click', async () => {
    if (!(await confirmBox({ title: 'Log out everywhere?', message: 'You will be logged out on every device, including this one.', confirmText: 'Log out everywhere' }))) return;
    try {
        await adminApi('/admin/logout-all', { method: 'POST' });
        logout();
    } catch (err) {
        toast(err.message, 'error');
    }
});

const adminDialog = document.getElementById('admin-dialog');
const adminForm = document.getElementById('admin-form');
const adminsList = document.getElementById('admins');

async function loadAdmins() {
    try {
        const admins = await adminApi('/admins');
        const when = value => (value ? formatDate(value, { isUtc: true }) : 'never');
        // your own role is shown but can't be changed here (another owner has to)
        const roleControl = a => a.id === me.id
            ? `<span class="badge badge-role">${ROLE_LABELS[a.role] || escapeHtml(a.role)}</span>`
            : `<select class="role-select" data-role-for="${escapeHtml(a.username)}" aria-label="Role for ${escapeHtml(a.username)}">
                ${Object.entries(ROLE_LABELS).map(([value, label]) => `<option value="${value}" ${a.role === value ? 'selected' : ''}>${label}</option>`).join('')}
               </select>`;
        adminsList.innerHTML = admins.map(a => `
            <div class="row">
                <div class="avatar" aria-hidden="true">${escapeHtml(initials(a.username))}</div>
                <div class="row-main">
                    <h3>${escapeHtml(a.username)} ${a.id === me.id ? '<span class="badge badge-role">you</span>' : ''}
                        ${a.two_factor ? '<span class="badge badge-approved" title="Uses 2-step login">2-step</span>' : ''}</h3>
                    <p class="meta">
                        Admin since ${formatDate(a.created_at, { isUtc: true, withTime: false })}
                        · Last login: ${when(a.last_login_at)}
                        · Password changed: ${when(a.password_changed_at)}
                    </p>
                </div>
                <div class="btn-group">
                    ${roleControl(a)}
                    ${a.two_factor && a.id !== me.id ? `<button class="btn btn-sm btn-ghost" data-reset-2fa="${escapeHtml(a.username)}">Reset 2-step</button>` : ''}
                    ${a.id === me.id ? '' : `<button class="btn btn-sm btn-danger" data-username="${escapeHtml(a.username)}">Remove</button>`}
                </div>
            </div>`).join('');
    } catch (err) {
        adminsList.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

// an admin lost their phone and recovery codes: turn their 2-step login off so they can set it up again
adminsList.addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-reset-2fa]');
    if (!button) return;
    const username = button.dataset.reset2fa;
    if (!(await confirmBox({
        title: `Reset ${username}'s 2-step login?`,
        message: 'Only do this if they lost their phone and their recovery codes, and you are sure it is really them asking. They will be logged out and can log in with just their password, then turn it on again.',
        confirmText: 'Reset 2-step',
    }))) return;
    try {
        await adminApi(`/admin/${encodeURIComponent(username)}/2fa`, { method: 'DELETE' });
        toast(`${username}'s 2-step login was reset`);
        loadAdmins();
    } catch (err) {
        toast(err.message, 'error');
    }
});

adminsList.addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-username]');
    if (!button) return;
    const username = button.dataset.username;
    if (!(await confirmBox({ title: `Remove admin "${username}"?`, message: 'They will lose access immediately.', confirmText: 'Remove' }))) return;
    try {
        await adminApi(`/admin/${encodeURIComponent(username)}`, { method: 'DELETE' });
        toast(`${username} removed`);
        loadAdmins();
    } catch (err) {
        toast(err.message, 'error');
    }
});

adminsList.addEventListener('change', async (e) => {
    const select = e.target.closest('select[data-role-for]');
    if (!select) return;
    const username = select.dataset.roleFor;
    const label = ROLE_LABELS[select.value];
    if (!(await confirmBox({
        title: `Make ${username} ${label === 'Owner' ? 'an' : 'a'} ${label}?`,
        message: 'They will be logged out and see the new menus the next time they log in.',
        confirmText: 'Change role',
        danger: false,
    }))) {
        return loadAdmins();  // puts the dropdown back to their current role
    }
    try {
        await adminApi(`/admin/${encodeURIComponent(username)}/role`, { method: 'PUT', body: { role: select.value } });
        toast(`${username} is now ${label === 'Owner' ? 'an' : 'a'} ${label}`);
    } catch (err) {
        toast(err.message, 'error');
    }
    loadAdmins();
});

document.getElementById('add-admin-btn').addEventListener('click', () => {
    adminForm.reset();
    openModal(adminDialog);
});

adminForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = adminForm.querySelector('.form-message');
    const data = readForm(adminForm);
    if (!data.username) return showMessage(message, 'error', 'Please enter a username.');
    if ((data.password || '').length < 8) return showMessage(message, 'error', 'The password must be at least 8 characters.');
    submitting(adminForm, async () => {
        await adminApi('/admin/register', { method: 'POST', body: data });
        toast(`${data.username} added as admin`);
        adminDialog.close();
        loadAdmins();
    });
});

if (me) loadTwoFactor();

// everything except your own account and appearance is for owners only
if (me && me.role === 'owner') {
    loadClubInfo();
    loadAdmins();
    loadBackups();
    loadEmailStatus();
}
