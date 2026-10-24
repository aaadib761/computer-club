const me = renderAdminLayout('settings.html');

// ---------- club info ----------

const clubForm = document.getElementById('club-form');

async function loadClubInfo() {
    try {
        fillForm(clubForm, await api('/settings'));
    } catch (err) {
        showMessage(clubForm.querySelector('.form-message'), 'error', err.message);
    }
}

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

// ---------- appearance ----------

const darkToggle = document.getElementById('dark-toggle');
darkToggle.checked = document.body.classList.contains('dark');
darkToggle.addEventListener('change', () => setDarkMode(darkToggle.checked));

// ---------- export ----------

document.querySelectorAll('[data-export]').forEach(button => {
    button.addEventListener('click', async () => {
        const label = button.textContent;
        button.disabled = true;
        button.textContent = 'Preparing…';
        try {
            const admin = currentAdmin();
            if (!admin) return logout('expired');
            const res = await fetch(`/export/${button.dataset.export}`, {
                headers: { Authorization: `Bearer ${admin.token}` },
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed');
            const name = (res.headers.get('Content-Disposition') || '').match(/filename="(.+)"/)?.[1] || 'export.csv';
            const url = URL.createObjectURL(await res.blob());
            const link = Object.assign(document.createElement('a'), { href: url, download: name });
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast(`Downloaded ${name}`);
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            button.disabled = false;
            button.textContent = label;
        }
    });
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
        adminsList.innerHTML = admins.map(a => `
            <div class="row">
                <div class="avatar" aria-hidden="true">${escapeHtml(initials(a.username))}</div>
                <div class="row-main">
                    <h3>${escapeHtml(a.username)} ${a.id === me.id ? '<span class="badge badge-role">you</span>' : ''}</h3>
                    <p class="meta">
                        Admin since ${formatDate(a.created_at, { isUtc: true, withTime: false })}
                        · Last login: ${when(a.last_login_at)}
                        · Password changed: ${when(a.password_changed_at)}
                    </p>
                </div>
                ${a.id === me.id ? '' : `<button class="btn btn-sm btn-danger" data-username="${escapeHtml(a.username)}">Remove</button>`}
            </div>`).join('');
    } catch (err) {
        adminsList.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

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

if (me) {
    loadClubInfo();
    loadAdmins();
}
