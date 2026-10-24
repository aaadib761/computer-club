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
        fillForm(termForm, { committee_term: info.committee_term });
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
        showMessage(termForm.querySelector('.form-message'), 'success', 'Term name saved. It now shows on the Committee page.');
    });
});

// ---------- committee archive ----------

async function loadArchive() {
    try {
        const terms = await api('/committee-archive');
        archiveList.innerHTML = terms.length
            ? terms.map(t => `
                <div class="row">
                    <div class="row-main">
                        <h3>${escapeHtml(t.term)}</h3>
                        <p class="meta">${t.members.length} people · archived ${formatDate(t.archived_at, { isUtc: true, withTime: false })}</p>
                        <p class="row-text">${t.members.map(m => `${escapeHtml(m.name)} (${escapeHtml(m.position)})`).join(', ')}</p>
                    </div>
                    <button class="btn btn-sm btn-danger" data-archive="${t.id}">Delete</button>
                </div>`).join('')
            : '<div class="empty">No past committees archived yet.</div>';
    } catch (err) {
        archiveList.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

document.getElementById('archive-btn').addEventListener('click', async () => {
    const term = termForm.elements.committee_term.value.trim();
    const message = termForm.querySelector('.form-message');
    if (!term) {
        termForm.elements.committee_term.focus();
        return showMessage(message, 'error', 'Type the term name first (e.g. "13th Executive Committee").');
    }
    const ok = await confirmBox({
        title: `Archive "${term}"?`,
        message: 'A copy of everyone who currently has a committee position is saved under "Past committees". Members and positions themselves are not changed.',
        confirmText: 'Archive',
        danger: false,
    });
    if (!ok) return;
    try {
        const result = await adminApi('/committee-archive', { method: 'POST', body: { term } });
        showMessage(message, 'success', `Archived ${result.members} people. You can now update positions for the new committee.`);
        loadArchive();
    } catch (err) {
        showMessage(message, 'error', err.message);
    }
});

archiveList.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-archive]');
    if (!button) return;
    if (!(await confirmBox({ title: 'Delete this past committee?', message: 'It will be removed from the Committee page history.' }))) return;
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
