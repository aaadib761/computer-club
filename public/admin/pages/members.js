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
// filter dropdowns + form suggestions, built from the values members already have
const FILTERS = [
    { field: 'department', select: document.getElementById('department-filter'), all: 'All departments', none: 'No department', suggestions: 'department-options' },
    { field: 'batch', select: document.getElementById('batch-filter'), all: 'All batches', none: 'No batch', suggestions: 'batch-options' },
];

async function load() {
    try {
        members = await adminApi('/members');
        refreshFilters();
        render();
    } catch (err) {
        list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

function refreshFilters() {
    FILTERS.forEach(({ field, select, all, none, suggestions }) => {
        const values = [...new Set(members.map(m => m[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const current = select.value;
        select.innerHTML = `<option value="">${all}</option>` +
            values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('') +
            (members.some(m => !m[field]) ? `<option value="__none__">${none}</option>` : '');
        select.value = [...select.options].some(o => o.value === current) ? current : '';
        const datalist = document.getElementById(suggestions);
        if (field === 'department') fillDepartmentOptions(datalist, values);  // standard list + any others in use
        else datalist.innerHTML = values.map(v => `<option value="${escapeHtml(v)}">`).join('');
    });
}

// club IDs are given by the club after approval; this finds who's still waiting for one
const clubIdFilter = document.getElementById('clubid-filter');

function matchesFilters(m) {
    const clubIdOk = !clubIdFilter.value || (clubIdFilter.value === 'missing' ? !m.club_id : !!m.club_id);
    return clubIdOk && FILTERS.every(({ field, select }) =>
        !select.value || (select.value === '__none__' ? !m[field] : m[field] === select.value));
}

// "ID 123 · Club NDUBCC-01 · CSE · Batch 22", with warnings for anything required that's missing
function idsHtml(m) {
    const missing = label => `<span class="badge badge-pending">No ${label}</span>`;
    return [
        m.student_id ? `ID ${escapeHtml(m.student_id)}` : missing('student ID'),
        m.club_id ? `Club ${escapeHtml(m.club_id)}` : '',
        m.department ? escapeHtml(m.department) : missing('department'),
        m.batch ? `Batch ${escapeHtml(m.batch)}` : missing('batch'),
    ].filter(Boolean).join(' · ');
}

function render() {
    if (!members) return;
    const q = search.value.trim().toLowerCase();
    const shown = members.filter(m =>
        [m.name, m.email, m.phone, m.position, m.student_id, m.club_id, m.department, m.batch]
            .some(v => (v || '').toLowerCase().includes(q)) && matchesFilters(m));

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
                    ${m.position ? `<span class="badge badge-role">${escapeHtml(m.position)}</span>` : ''}
                    <p class="meta">${idsHtml(m)}</p>
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
                    ${m.position ? `<span class="badge badge-role">${escapeHtml(m.position)}</span>` : ''}
                </h3>
                <p class="meta">${idsHtml(m)}</p>
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
FILTERS.forEach(({ select }) => select.addEventListener('change', render));
clubIdFilter.addEventListener('change', render);

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

// the order number only matters for committee members, so it's locked until a position is typed
function syncRankField() {
    const hasPosition = memberForm.elements.position.value.trim() !== '';
    const rank = memberForm.elements.position_rank;
    rank.disabled = !hasPosition;
    if (!hasPosition) rank.value = '';
}
memberForm.elements.position.addEventListener('input', syncRankField);

document.getElementById('add-btn').addEventListener('click', () => {
    editingId = null;
    document.getElementById('member-dialog-title').textContent = 'Add member';
    memberForm.reset();
    syncRankField();
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
        syncRankField();
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
        if (!(await confirmBox({ title: `Delete ${member.name}?`, message: 'Their attendance records and photo will be deleted too.' }))) return;
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
    const invalid = memberForm.querySelector(':invalid');
    if (invalid) {
        const label = invalid.labels[0].childNodes[0].textContent.trim();
        invalid.focus();
        return showMessage(message, 'error', invalid.value.trim()
            ? `Please check "${label}" — it doesn't look right.`
            : `Please fill in "${label}".`);
    }
    const data = readForm(memberForm);
    const body = {
        name: data.name,
        email: data.email,
        phone: data.phone || null,
        student_id: data.student_id,
        club_id: data.club_id || null,
        department: data.department,
        batch: data.batch,
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
    if (!(await confirmBox({ title: 'Remove this photo?', message: 'Initials will show instead until a new photo is uploaded.', confirmText: 'Remove' }))) return;
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
