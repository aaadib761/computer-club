renderAdminLayout('members.html');

let members = null;   // null until loaded
let editingId = null;
let photoMemberId = null;

const list = document.getElementById('list');
const search = document.getElementById('search');
const memberDialog = document.getElementById('member-dialog');
const memberForm = document.getElementById('member-form');
const photoDialog = document.getElementById('photo-dialog');
const photoForm = document.getElementById('photo-form');

async function load() {
    try {
        members = await adminApi('/members');
        render();
    } catch (err) {
        list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

function render() {
    if (!members) return;
    const q = search.value.trim().toLowerCase();
    const shown = members.filter(m =>
        [m.name, m.email, m.phone, m.position].some(v => (v || '').toLowerCase().includes(q)));

    list.className = view === 'grid' ? 'member-grid' : 'list';
    if (!shown.length) {
        list.innerHTML = `<div class="empty" style="grid-column: 1 / -1;">${members.length ? 'No members match your search.' : 'No members yet. Add the first one!'}</div>`;
        return;
    }
    if (view === 'grid') {
        list.innerHTML = shown.map(m => `
            <div class="tile">
                ${m.photo_path
                    ? `<img class="tile-photo" src="${escapeHtml(photoUrl(m.photo_path))}" alt="" loading="lazy">`
                    : `<div class="tile-photo" aria-hidden="true">${escapeHtml(initials(m.name))}</div>`}
                <div class="tile-body">
                    <h3>${escapeHtml(m.name)}</h3>
                    ${m.position ? `<span class="badge badge-role">${escapeHtml(m.position)}${m.position_rank ? ` · #${m.position_rank}` : ''}</span>` : ''}
                    <p class="meta">${escapeHtml(m.email)}</p>
                    ${m.phone ? `<p class="meta">${escapeHtml(m.phone)}</p>` : ''}
                </div>
                <div class="tile-actions">
                    <button class="btn btn-sm btn-ghost" data-action="edit" data-id="${m.id}">Edit</button>
                    <button class="btn btn-sm btn-ghost" data-action="photo" data-id="${m.id}">Photo</button>
                    <button class="btn btn-sm btn-danger" data-action="delete" data-id="${m.id}" aria-label="Delete ${escapeHtml(m.name)}">🗑</button>
                </div>
            </div>`).join('');
        return;
    }
    list.innerHTML = shown.map(m => `
        <div class="row">
            ${avatarHtml(m)}
            <div class="row-main">
                <h3>${escapeHtml(m.name)}
                    ${m.position ? `<span class="badge badge-role">${escapeHtml(m.position)}${m.position_rank ? ` · #${m.position_rank}` : ''}</span>` : ''}
                </h3>
                <p class="meta">${escapeHtml(m.email)}${m.phone ? ` · ${escapeHtml(m.phone)}` : ''}</p>
            </div>
            <div class="btn-group">
                <button class="btn btn-sm btn-ghost" data-action="edit" data-id="${m.id}">Edit</button>
                <button class="btn btn-sm btn-ghost" data-action="photo" data-id="${m.id}">Photo</button>
                <button class="btn btn-sm btn-danger" data-action="delete" data-id="${m.id}">Delete</button>
            </div>
        </div>`).join('');
}

search.addEventListener('input', render);

// list or grid, remembered in this browser
const VIEW_KEY = 'ndubcc_members_view';
let view = storageGet(VIEW_KEY) === 'grid' ? 'grid' : 'list';
const viewButtons = document.querySelectorAll('[data-view]');
function setView(next) {
    view = next;
    storageSet(VIEW_KEY, view);
    viewButtons.forEach(b => {
        b.classList.toggle('active', b.dataset.view === view);
        b.setAttribute('aria-pressed', b.dataset.view === view);
    });
    render();
}
viewButtons.forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
setView(view);

document.getElementById('add-btn').addEventListener('click', () => {
    editingId = null;
    document.getElementById('member-dialog-title').textContent = 'Add member';
    memberForm.reset();
    openModal(memberDialog);
});

list.addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const member = members.find(m => m.id === Number(button.dataset.id));

    if (button.dataset.action === 'edit') {
        editingId = member.id;
        document.getElementById('member-dialog-title').textContent = 'Edit member';
        fillForm(memberForm, member);
        openModal(memberDialog);
    }

    if (button.dataset.action === 'photo') {
        photoMemberId = member.id;
        document.getElementById('photo-name').textContent = member.name;
        document.getElementById('photo-current').innerHTML = member.photo_path
            ? `<img src="${escapeHtml(photoUrl(member.photo_path))}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:50%;">`
            : '<p class="meta">No photo yet.</p>';
        document.getElementById('photo-remove').classList.toggle('hidden', !member.photo_path);
        photoForm.reset();
        openModal(photoDialog);
    }

    if (button.dataset.action === 'delete') {
        if (!confirm(`Delete ${member.name}? Their attendance records and photo will be deleted too.`)) return;
        try {
            await adminApi(`/members/${member.id}`, { method: 'DELETE' });
            toast('Member deleted');
            load();
        } catch (err) {
            toast(err.message, 'error');
        }
    }
});

memberForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = memberForm.querySelector('.form-message');
    if (memberForm.querySelector(':invalid')) {
        return showMessage(message, 'error', 'Please enter a name and a valid email.');
    }
    const data = readForm(memberForm);
    const body = {
        name: data.name,
        email: data.email,
        phone: data.phone || null,
        position: data.position || null,
        position_rank: data.position_rank ? Number(data.position_rank) : null,
    };
    submitting(memberForm, async () => {
        if (editingId) {
            await adminApi(`/members/${editingId}`, { method: 'PUT', body });
            toast('Member updated');
        } else {
            await adminApi('/members', { method: 'POST', body });
            toast('Member added');
        }
        memberDialog.close();
        load();
    });
});

photoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const file = photoForm.elements.photo.files[0];
    if (!file) return showMessage(photoForm.querySelector('.form-message'), 'error', 'Please choose a photo first.');
    const body = new FormData();
    body.append('photo', file);
    submitting(photoForm, async () => {
        await adminApi(`/members/${photoMemberId}/photo`, { method: 'POST', body });
        toast('Photo uploaded');
        photoDialog.close();
        load();
    });
});

document.getElementById('photo-remove').addEventListener('click', async () => {
    if (!confirm('Remove this photo?')) return;
    try {
        await adminApi(`/members/${photoMemberId}/photo`, { method: 'DELETE' });
        toast('Photo removed');
        photoDialog.close();
        load();
    } catch (err) {
        toast(err.message, 'error');
    }
});

load();
