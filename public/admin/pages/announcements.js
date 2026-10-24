renderAdminLayout('announcements.html');

let announcements = [];
let editingId = null;
const list = document.getElementById('list');
const dialog = document.getElementById('dialog');
const form = document.getElementById('form');

async function load() {
    try {
        announcements = await adminApi('/announcements');
        list.innerHTML = announcements.length
            ? announcements.map(a => `
                <div class="row">
                    <div class="row-main">
                        <h3>${escapeHtml(a.title)}</h3>
                        <p class="meta">Posted ${formatDate(a.posted_at, { isUtc: true })}</p>
                        <p class="row-text">${escapeHtml(a.body)}</p>
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-sm btn-ghost" data-action="edit" data-id="${a.id}">Edit</button>
                        <button class="btn btn-sm btn-danger" data-action="delete" data-id="${a.id}">Delete</button>
                    </div>
                </div>`).join('')
            : '<div class="empty">No announcements yet.</div>';
    } catch (err) {
        list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

document.getElementById('add-btn').addEventListener('click', () => {
    editingId = null;
    document.getElementById('dialog-title').textContent = 'New announcement';
    form.reset();
    openModal(dialog);
});

list.addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const item = announcements.find(a => a.id === Number(button.dataset.id));

    if (button.dataset.action === 'edit') {
        editingId = item.id;
        document.getElementById('dialog-title').textContent = 'Edit announcement';
        fillForm(form, item);
        openModal(dialog);
    }
    if (button.dataset.action === 'delete') {
        if (!(await confirmBox({ title: 'Delete announcement?', message: `"${item.title}" will be removed from the website.` }))) return;
        try {
            await adminApi(`/announcements/${item.id}`, { method: 'DELETE' });
            toast('Announcement deleted');
            load();
        } catch (err) {
            toast(err.message, 'error');
        }
    }
});

form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (form.querySelector(':invalid')) {
        return showMessage(form.querySelector('.form-message'), 'error', 'Please enter a title and a message.');
    }
    const { title, body } = readForm(form);
    submitting(form, async () => {
        if (editingId) {
            await adminApi(`/announcements/${editingId}`, { method: 'PUT', body: { title, body } });
            toast('Announcement updated');
        } else {
            await adminApi('/announcements', { method: 'POST', body: { title, body } });
            toast('Announcement published');
        }
        dialog.close();
        load();
    });
});

load();
