const me = renderAdminLayout('activity.html');

const list = document.getElementById('list');
const search = document.getElementById('search');
const areaFilter = document.getElementById('area-filter');
const adminFilter = document.getElementById('admin-filter');
const moreBtn = document.getElementById('more-btn');

const AREA_ICONS = {
    members: '👥', events: '📅', attendance: '✅', requests: '✋', messages: '✉️',
    content: '📢', settings: '⚙️', admins: '🛡️', account: '🔑', data: '💾',
};

let entries = [];
let loadToken = 0;  // ignores answers from an older search when the filters changed meanwhile

function queryString(before) {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    if (areaFilter.value) params.set('area', areaFilter.value);
    if (adminFilter.value) params.set('admin', adminFilter.value);
    if (search.value.trim()) params.set('q', search.value.trim());
    return params.toString();
}

async function load({ older = false } = {}) {
    const token = ++loadToken;
    if (!older) list.innerHTML = '<div class="loading">Loading…</div>';
    moreBtn.disabled = true;
    try {
        const before = older && entries.length ? entries[entries.length - 1].id : null;
        const result = await adminApi(`/activity?${queryString(before)}`);
        if (token !== loadToken) return;
        entries = older ? entries.concat(result.entries) : result.entries;
        render();
        moreBtn.classList.toggle('hidden', !result.more);
    } catch (err) {
        list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    } finally {
        moreBtn.disabled = false;
    }
}

function render() {
    if (!entries.length) {
        const filtered = search.value.trim() || areaFilter.value || adminFilter.value;
        list.innerHTML = `<div class="empty">${filtered ? 'Nothing matches these filters.' : 'Nothing recorded yet. Changes made in the admin panel will show up here.'}</div>`;
        return;
    }
    // a small date heading whenever the day changes
    let lastDay = '';
    list.innerHTML = entries.map(e => {
        const day = formatDate(e.created_at, { isUtc: true, withTime: false });
        const heading = day !== lastDay ? `<h3 class="activity-day">${day}</h3>` : '';
        lastDay = day;
        const time = parseDate(e.created_at, true)?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) || '';
        const failed = e.action === 'Failed login';
        return `${heading}
            <div class="row activity-row ${failed ? 'activity-warning' : ''}">
                <div class="activity-icon" aria-hidden="true">${AREA_ICONS[e.area] || '•'}</div>
                <div class="row-main">
                    <p><b>${escapeHtml(e.admin_username || 'unknown')}</b> ${escapeHtml(e.action.charAt(0).toLowerCase() + e.action.slice(1))}
                        ${e.details ? `<span class="activity-details">${escapeHtml(e.details)}</span>` : ''}</p>
                </div>
                <span class="meta activity-time">${time}</span>
            </div>`;
    }).join('');
}

// the admin filter lists everyone who is an admin now (removed admins can still be found by searching)
async function loadAdminNames() {
    try {
        const admins = await adminApi('/admins');
        adminFilter.innerHTML = '<option value="">All admins</option>' +
            admins.map(a => `<option value="${escapeHtml(a.username)}">${escapeHtml(a.username)}</option>`).join('');
    } catch { /* the filter is optional */ }
}

let searchTimer;
search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => load(), 300);
});
areaFilter.addEventListener('change', () => load());
adminFilter.addEventListener('change', () => load());
moreBtn.addEventListener('click', () => load({ older: true }));

if (me) {
    loadAdminNames();
    load();
}
