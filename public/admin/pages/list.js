// Printable list (Download > PDF): fetches the same list as the Excel/CSV downloads and shows it as a table.
requireLogin();

const params = new URLSearchParams(location.search);
const type = params.get('type') || '';
params.delete('type');
params.set('format', 'json');

const message = document.getElementById('list-message');
const body = document.getElementById('list-body');

document.getElementById('back-link').addEventListener('click', (e) => {
    e.preventDefault();
    // opened in a new tab, so "back" closes it; opened directly, go to the dashboard
    if (window.opener) window.close();
    else location.href = 'index.html';
});

// short codes that read badly when split over two lines; long text like emails may wrap instead
const NO_WRAP = ['student_id', 'club_id', 'phone', 'batch', 'fee', 'fee_paid_at', 'joined', 'sent', 'event_date', 'registered', 'attendance', 'status'];

function table(columns, rows) {
    if (!rows.length) return '<p class="meta">No one in this list.</p>';
    const cell = c => (NO_WRAP.includes(c.key) ? ' class="nowrap"' : '');
    return `
        <table class="print-table">
            <thead><tr><th>#</th>${columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
            <tbody>${rows.map((r, i) => `
                <tr><td>${i + 1}</td>${columns.map(c => `<td${cell(c)}>${escapeHtml(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')}
            </tbody>
        </table>`;
}

async function loadList() {
    let list;
    try {
        list = await adminApi(`/export/${encodeURIComponent(type)}?${params}`);
    } catch (err) {
        message.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
        return;
    }

    // columns nobody has a value in (like Batch for old committees) only waste space on paper
    const columns = list.columns.filter(c => list.rows.some(r => r[c.key] !== null && r[c.key] !== undefined && r[c.key] !== ''));
    const generated = `Downloaded ${formatDate(list.generated_at, { isUtc: true, withTime: true })}`;

    document.getElementById('list-title').textContent = list.title;
    document.getElementById('list-subtitle').textContent = [list.subtitle, generated].filter(Boolean).join(' · ');
    document.title = `${list.title} | NDUB Admin`;

    if (columns.some(c => c.key === 'committee')) {
        // several committees: one heading and table each
        const inner = columns.filter(c => c.key !== 'committee' && c.key !== 'session');
        const groups = [];
        list.rows.forEach(r => {
            let group = groups.find(g => g.committee === r.committee && g.session === r.session);
            if (!group) groups.push(group = { committee: r.committee, session: r.session, rows: [] });
            group.rows.push(r);
        });
        body.innerHTML = groups.map(g => `
            <section class="print-group">
                <h2>${escapeHtml(g.committee)}${g.session ? ` <span class="meta">(${escapeHtml(g.session)})</span>` : ''}</h2>
                ${table(inner, g.rows)}
            </section>`).join('');
    } else {
        body.innerHTML = table(columns, list.rows);
    }

    // wide lists print sideways
    if (columns.length > 6) document.head.insertAdjacentHTML('beforeend', '<style>@media print { @page { size: A4 landscape; } }</style>');
    document.getElementById('list-count').textContent = `${list.rows.length} ${list.rows.length === 1 ? 'row' : 'rows'}`;
    document.getElementById('print-sheet').classList.remove('hidden');
    document.getElementById('print-btn').disabled = false;
}

document.getElementById('print-btn').addEventListener('click', () => window.print());

loadList();
