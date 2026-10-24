renderAdminLayout('requests.html');

let requests = [];
const list = document.getElementById('list');
const filter = document.getElementById('filter');

async function load() {
    try {
        requests = await adminApi('/join-requests');
        render();
        refreshNavCounts();
    } catch (err) {
        list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

function render() {
    const shown = filter.value === 'all' ? requests : requests.filter(r => r.status === filter.value);
    if (!shown.length) {
        list.innerHTML = `<div class="empty">No ${filter.value === 'all' ? '' : filter.value + ' '}requests.</div>`;
        return;
    }
    list.innerHTML = shown.map(r => `
        <div class="row">
            ${r.photo_path
                ? `<a href="${escapeHtml(photoUrl(r.photo_path))}" target="_blank" rel="noopener" title="Open photo">${avatarHtml(r)}</a>`
                : avatarHtml(r)}
            <div class="row-main">
                <h3>${escapeHtml(r.name)} ${statusBadge(r.status)}</h3>
                <p class="meta">
                    ${r.student_id ? `ID ${escapeHtml(r.student_id)}` : '<span class="badge badge-pending">No student ID</span>'}
                    ${r.department ? ` · ${escapeHtml(r.department)}` : ''}
                    ${r.batch ? ` · Batch ${escapeHtml(r.batch)}` : ''}
                </p>
                <p class="meta">
                    ${escapeHtml(r.email)}
                    ${r.phone ? ` · ${escapeHtml(r.phone)}` : ''}
                    · ${formatDate(r.created_at, { isUtc: true })}
                </p>
                ${r.reason ? `<p class="row-text">“${escapeHtml(r.reason)}”</p>` : ''}
            </div>
            <div class="btn-group">
                <button class="btn btn-sm btn-ghost" data-copy="${escapeHtml(r.email)}">Copy email</button>
                ${r.status !== 'approved' ? `<button class="btn btn-sm" data-action="approved" data-id="${r.id}">Approve</button>` : ''}
                ${r.status !== 'rejected' ? `<button class="btn btn-sm btn-ghost" data-action="rejected" data-id="${r.id}">Reject</button>` : ''}
                <button class="btn btn-sm btn-danger" data-action="delete" data-id="${r.id}">Delete</button>
            </div>
        </div>`).join('');
}

filter.addEventListener('change', render);

list.addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const request = requests.find(r => r.id === Number(button.dataset.id));
    const action = button.dataset.action;

    try {
        if (action === 'delete') {
            if (!(await confirmBox({ title: 'Delete this request?', message: `The join request from ${request.name} will be deleted.` }))) return;
            await adminApi(`/join-requests/${request.id}`, { method: 'DELETE' });
            toast('Request deleted');
        } else {
            const result = await adminApi(`/join-requests/${request.id}`, { method: 'PUT', body: { status: action } });
            toast(action === 'approved'
                ? (result.member_id ? `${request.name} approved and added to Members` : `${request.name} approved`)
                : `${request.name} rejected`);
        }
        load();
    } catch (err) {
        toast(err.message, 'error');
    }
});

load();
