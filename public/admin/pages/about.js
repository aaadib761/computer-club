renderAdminLayout('about.html');

const aboutForm = document.getElementById('about-form');
const termForm = document.getElementById('term-form');
const archiveList = document.getElementById('archive');
const advisorsList = document.getElementById('advisors');
const advisorDialog = document.getElementById('advisor-dialog');
const advisorForm = document.getElementById('advisor-form');
const photoDialog = document.getElementById('advisor-photo-dialog');
const photoForm = document.getElementById('advisor-photo-form');

let advisors = [];
let editingId = null;
let photoAdvisorId = null;

// Shows "Please fill in X" / "Please check X" for the first invalid field. Returns true if all is fine.
function formIsValid(form) {
    const invalid = form.querySelector(':invalid');
    if (!invalid) return true;
    const label = invalid.labels[0].childNodes[0].textContent.trim();
    invalid.focus();
    showMessage(form.querySelector('.form-message'), 'error', invalid.value.trim()
        ? `Please check "${label}" — it doesn't look right.`
        : `Please fill in "${label}".`);
    return false;
}

// ---------- about text + committee term (both stored in settings) ----------

async function loadSettings() {
    try {
        const info = await api('/settings');
        fillForm(aboutForm, { about_text: info.about_text, objectives: info.objectives, founded_year: info.founded_year });
        fillForm(termForm, { committee_term: info.committee_term, committee_session: info.committee_session });
    } catch (err) {
        toast(err.message, 'error');
    }
}

aboutForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!formIsValid(aboutForm)) return;
    submitting(aboutForm, async () => {
        await adminApi('/settings', { method: 'PUT', body: readForm(aboutForm) });
        showMessage(aboutForm.querySelector('.form-message'), 'success', 'Saved. The About page is updated.');
    });
});

termForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(termForm, async () => {
        await adminApi('/settings', { method: 'PUT', body: readForm(termForm) });
        showMessage(termForm.querySelector('.form-message'), 'success', 'Saved. It now shows on the Committee page.');
    });
});

// ---------- executive committees ----------

const committeeDialog = document.getElementById('committee-dialog');
const committeeForm = document.getElementById('committee-form');
const panelRows = document.getElementById('panel-rows');
let committees = [];
let editingCommitteeId = null;

async function loadArchive() {
    try {
        committees = await api('/committee-archive');
        archiveList.innerHTML = committees.length
            ? committees.map(t => `
                <div class="row">
                    <div class="row-main">
                        <h3>${escapeHtml(t.term)}${t.session ? ` <span class="meta">(${escapeHtml(t.session)})</span>` : ''}</h3>
                        <p class="meta">${t.members.length} ${t.members.length === 1 ? 'person' : 'people'}</p>
                        <p class="row-text">${t.members.map(m => `${escapeHtml(m.name)} (${escapeHtml(m.position)})`).join(', ')}</p>
                    </div>
                    <div class="btn-group">
                        <span data-download-committee="${t.id}"></span>
                        <button class="btn btn-sm btn-ghost" data-edit-committee="${t.id}">Edit</button>
                        <button class="btn btn-sm btn-danger" data-archive="${t.id}">Delete</button>
                    </div>
                </div>`).join('')
            : '<div class="empty">No past committees yet. Archive the current one when its term ends, or add older ones with "+ Add past committee".</div>';
        archiveList.querySelectorAll('[data-download-committee]').forEach(slot => {
            const id = slot.dataset.downloadCommittee;
            slot.replaceWith(downloadMenu('committees', { label: '⬇️ Download', small: true, getParams: () => ({ committee: id }) }));
        });
    } catch (err) {
        archiveList.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

// every committee (the current one first)
document.getElementById('committees-download').replaceWith(downloadMenu('committees', { label: '⬇️ Download all', small: true }));

const PANEL_FIELDS = [
    { name: 'position', label: 'Position', max: 80, placeholder: 'e.g. President' },
    { name: 'name', label: 'Name', max: 100, placeholder: 'Full name' },
    { name: 'department', label: 'Department', max: 60, placeholder: 'e.g. CSE' },
    { name: 'batch', label: 'Batch', max: 30, placeholder: 'e.g. 18th' },
];

function addPanelRow(person = {}) {
    const row = document.createElement('div');
    row.className = 'panel-row';
    row.innerHTML = PANEL_FIELDS.map(f => `
        <input name="${f.name}" maxlength="${f.max}" placeholder="${escapeHtml(f.placeholder)}" aria-label="${f.label}" value="${escapeHtml(person[f.name] || '')}">`).join('')
        + '<button type="button" class="icon-btn" data-remove-row title="Remove this person" aria-label="Remove this person">✕</button>';
    panelRows.appendChild(row);
    return row;
}

function readPanelRows() {
    return [...panelRows.querySelectorAll('.panel-row')]
        .map(row => Object.fromEntries(PANEL_FIELDS.map(f => [f.name, row.querySelector(`[name="${f.name}"]`).value.trim()])))
        .filter(p => p.position || p.name || p.department || p.batch);
}

function openCommitteeDialog(committee) {
    editingCommitteeId = committee ? committee.id : null;
    document.getElementById('committee-dialog-title').textContent = committee ? `Edit ${committee.term}` : 'Add past committee';
    committeeForm.reset();
    committeeForm.elements.term.value = committee ? committee.term : '';
    committeeForm.elements.session.value = committee ? committee.session : '';
    panelRows.innerHTML = '';
    (committee ? committee.members : [{}, {}, {}]).forEach(person => addPanelRow(person));
    committeeForm.querySelector('.panel-paste').open = false;
    openModal(committeeDialog);
}

document.getElementById('add-committee-btn').addEventListener('click', () => openCommitteeDialog(null));
document.getElementById('add-row-btn').addEventListener('click', () => addPanelRow().querySelector('input').focus());

panelRows.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-remove-row]');
    if (remove) remove.closest('.panel-row').remove();
});

// "President, Rahim Ahmed, CSE, 18th" per line; tabs (copied from Excel) work too
document.getElementById('paste-btn').addEventListener('click', () => {
    const box = document.getElementById('panel-paste');
    const people = box.value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
        const parts = (line.includes('\t') ? line.split('\t') : line.split(',')).map(p => p.trim());
        return { position: parts[0], name: parts[1], department: parts[2], batch: parts.slice(3).join(', ') };
    });
    if (!people.length) return box.focus();
    // replace the empty starter rows instead of adding after them
    panelRows.querySelectorAll('.panel-row').forEach(row => {
        if ([...row.querySelectorAll('input')].every(input => !input.value.trim())) row.remove();
    });
    people.forEach(person => addPanelRow(person));
    box.value = '';
    committeeForm.querySelector('.panel-paste').open = false;
    toast(`Added ${people.length} ${people.length === 1 ? 'person' : 'people'}. Check them, then Save.`);
});

committeeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = committeeForm.querySelector('.form-message');
    const term = committeeForm.elements.term.value.trim();
    if (!term) {
        committeeForm.elements.term.focus();
        return showMessage(message, 'error', 'Please fill in "Committee name".');
    }
    const members = readPanelRows();
    if (!members.length) return showMessage(message, 'error', 'Add at least one person (position and name).');
    const incomplete = members.findIndex(p => !p.position || !p.name);
    if (incomplete !== -1) return showMessage(message, 'error', `Person ${incomplete + 1} needs both a position and a name.`);

    submitting(committeeForm, async () => {
        const body = { term, session: committeeForm.elements.session.value.trim(), members };
        if (editingCommitteeId) await adminApi(`/committee-archive/${editingCommitteeId}`, { method: 'PUT', body });
        else await adminApi('/committee-archive', { method: 'POST', body });
        committeeDialog.close();
        toast(`${term} saved`);
        loadArchive();
    });
});

document.getElementById('archive-btn').addEventListener('click', async () => {
    const term = termForm.elements.committee_term.value.trim();
    const message = termForm.querySelector('.form-message');
    if (!term) {
        termForm.elements.committee_term.focus();
        return showMessage(message, 'error', 'Type the term name first (e.g. "13th Executive Committee").');
    }
    const ok = await confirmBox({
        title: `Archive "${term}"?`,
        message: 'A copy of everyone who currently has a committee position is saved under "All committees". Members and positions themselves are not changed.',
        confirmText: 'Archive',
        danger: false,
    });
    if (!ok) return;
    try {
        const result = await adminApi('/committee-archive', { method: 'POST', body: { term, session: termForm.elements.committee_session.value.trim() } });
        showMessage(message, 'success', `Archived ${result.members} people. You can now update positions for the new committee.`);
        loadArchive();
    } catch (err) {
        showMessage(message, 'error', err.message);
    }
});

archiveList.addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit-committee]');
    if (edit) return openCommitteeDialog(committees.find(c => String(c.id) === edit.dataset.editCommittee));
    const button = e.target.closest('[data-archive]');
    if (!button) return;
    if (!(await confirmBox({ title: 'Delete this past committee?', message: 'Its panel list will be removed from the Committee page.' }))) return;
    try {
        await adminApi(`/committee-archive/${button.dataset.archive}`, { method: 'DELETE' });
        toast('Past committee deleted');
        loadArchive();
    } catch (err) {
        toast(err.message, 'error');
    }
});

// ---------- advisors ----------

async function loadAdvisors() {
    try {
        advisors = await api('/advisors');
        advisorsList.innerHTML = advisors.length
            ? advisors.map(a => `
                <div class="row">
                    ${avatarHtml(a)}
                    <div class="row-main">
                        <h3>${escapeHtml(a.name)} <span class="badge badge-role">${escapeHtml(a.role)}</span></h3>
                        ${a.designation ? `<p class="meta">${escapeHtml(a.designation)}</p>` : ''}
                        ${a.message ? `<p class="row-text">“${escapeHtml(truncate(a.message, 160))}”</p>` : ''}
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-sm btn-ghost" data-action="edit" data-id="${a.id}">Edit</button>
                        <button class="btn btn-sm btn-ghost" data-action="photo" data-id="${a.id}">Photo</button>
                        <button class="btn btn-sm btn-danger" data-action="delete" data-id="${a.id}">Delete</button>
                    </div>
                </div>`).join('')
            : '<div class="empty">No advisors added yet.</div>';
    } catch (err) {
        advisorsList.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

document.getElementById('add-advisor-btn').addEventListener('click', () => {
    editingId = null;
    document.getElementById('advisor-dialog-title').textContent = 'Add person';
    advisorForm.reset();
    openModal(advisorDialog);
});

advisorsList.addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const advisor = advisors.find(a => a.id === Number(button.dataset.id));

    if (button.dataset.action === 'edit') {
        editingId = advisor.id;
        document.getElementById('advisor-dialog-title').textContent = 'Edit person';
        fillForm(advisorForm, advisor);
        openModal(advisorDialog);
    }

    if (button.dataset.action === 'photo') {
        photoAdvisorId = advisor.id;
        document.getElementById('ap-name').textContent = advisor.name;
        document.getElementById('ap-current').innerHTML = advisor.photo_path
            ? `<img src="${escapeHtml(photoUrl(advisor.photo_path))}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:50%;">`
            : '<p class="meta">No photo yet.</p>';
        document.getElementById('ap-remove').classList.toggle('hidden', !advisor.photo_path);
        photoForm.reset();
        openModal(photoDialog);
    }

    if (button.dataset.action === 'delete') {
        if (!(await confirmBox({ title: `Delete ${advisor.name}?`, message: 'They will be removed from the About page.' }))) return;
        try {
            await adminApi(`/advisors/${advisor.id}`, { method: 'DELETE' });
            toast('Deleted');
            loadAdvisors();
        } catch (err) {
            toast(err.message, 'error');
        }
    }
});

advisorForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!formIsValid(advisorForm)) return;
    const data = readForm(advisorForm);
    const body = {
        name: data.name,
        role: data.role,
        designation: data.designation || null,
        message: data.message || null,
        profile_url: data.profile_url || null,
        sort_order: data.sort_order ? Number(data.sort_order) : null,
    };
    submitting(advisorForm, async () => {
        if (editingId) {
            await adminApi(`/advisors/${editingId}`, { method: 'PUT', body });
            toast('Saved');
        } else {
            await adminApi('/advisors', { method: 'POST', body });
            toast('Added');
        }
        advisorDialog.close();
        loadAdvisors();
    });
});

photoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const file = photoForm.elements.photo.files[0];
    if (!file) return showMessage(photoForm.querySelector('.form-message'), 'error', 'Please choose a photo first.');
    const body = new FormData();
    body.append('photo', file);
    submitting(photoForm, async () => {
        await adminApi(`/advisors/${photoAdvisorId}/photo`, { method: 'POST', body });
        toast('Photo uploaded');
        photoDialog.close();
        loadAdvisors();
    });
});

document.getElementById('ap-remove').addEventListener('click', async () => {
    if (!(await confirmBox({ title: 'Remove this photo?', confirmText: 'Remove' }))) return;
    try {
        await adminApi(`/advisors/${photoAdvisorId}/photo`, { method: 'DELETE' });
        toast('Photo removed');
        photoDialog.close();
        loadAdvisors();
    } catch (err) {
        toast(err.message, 'error');
    }
});

loadSettings();
loadArchive();
loadAdvisors();
