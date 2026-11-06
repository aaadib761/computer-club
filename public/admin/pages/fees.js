renderAdminLayout('fees.html');

const unpaidList = document.getElementById('unpaid');
const search = document.getElementById('search');
const batchFilter = document.getElementById('batch-filter');
const departmentFilter = document.getElementById('department-filter');
const payDialog = document.getElementById('pay-dialog');
const payForm = document.getElementById('pay-form');

let members = [];
let payingId = null;

// "200 BDT" or "Tk 200" in Settings -> { amount: 200, text: '200 BDT' }; anything without a number -> null
function parseFee(text) {
    const match = String(text || '').replace(/,/g, '').match(/\d+(\.\d+)?/);
    return match ? { amount: Number(match[0]), text: text.trim() } : null;
}

const isPaid = m => m.fee_paid === 1;
// "CSE-25"; a batch with no department saved is just "Batch 25"
const batchName = m => (m.department ? `${m.department}-${m.batch}` : `Batch ${m.batch}`);

async function load() {
    try {
        const [allMembers, settings] = await Promise.all([adminApi('/members'), api('/settings')]);
        members = allMembers;
        renderStats(parseFee(settings.membership_fee));
        // newest batch first, then by department within a batch
        const batchOf = new Map(members.map(m => [batchName(m), m.batch || '']));
        renderBreakdown('by-batch', 'batch', batchFilter, batchName, (a, b) =>
            batchOf.get(b).localeCompare(batchOf.get(a), undefined, { numeric: true }) || a.localeCompare(b));
        renderBreakdown('by-department', 'department', departmentFilter, m => m.department, (a, b) => a.localeCompare(b), DEPARTMENTS);
        renderMonths();
        renderUnpaid();
        renderRecent();
    } catch (err) {
        unpaidList.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

// ---------- totals ----------

function renderStats(fee) {
    const paid = members.filter(isPaid).length;
    document.getElementById('stat-paid').textContent = paid;
    document.getElementById('stat-unpaid').textContent = members.length - paid;
    document.getElementById('stat-percent').textContent = members.length ? `${Math.round((paid / members.length) * 100)}%` : '–';
    const collected = document.getElementById('stat-collected');
    const label = document.getElementById('stat-collected-label');
    if (fee) {
        // the unit is whatever follows or precedes the number in Settings ("200 BDT" -> "BDT")
        const unit = fee.text.replace(/[\d.,]+/, '').trim();
        collected.textContent = `${(paid * fee.amount).toLocaleString('en-US')}${unit ? ` ${unit}` : ''}`;
        label.textContent = `Collected (${paid} × ${fee.text})`;
    } else {
        collected.textContent = '–';
        label.innerHTML = 'Collected: set the fee in <a href="settings.html">Settings</a>';
    }
}

// ---------- by batch / department ----------

// known: values to list even with no members yet (the club's departments)
function renderBreakdown(boxId, field, select, keyOf, sort, known = []) {
    const groups = new Map(known.map(key => [key, { total: 0, paid: 0 }]));
    members.filter(m => m[field]).forEach(m => {
        const key = keyOf(m);
        const g = groups.get(key) || { total: 0, paid: 0 };
        g.total += 1;
        if (isPaid(m)) g.paid += 1;
        groups.set(key, g);
    });
    const keys = [...groups.keys()].sort(sort);

    // members with nothing saved can't be placed in a row, so say how many instead of hiding them
    const missing = members.filter(m => !m[field]).length;
    const missingNote = missing
        ? `<p class="meta fee-missing">${missing} member${missing === 1 ? ' has' : 's have'} no ${field} saved yet. <a href="members.html">Add it in Members</a>.</p>`
        : '';

    const box = document.getElementById(boxId);
    box.innerHTML = (keys.length ? keys.map(key => {
        const { total, paid } = groups.get(key);
        const percent = total ? Math.round((paid / total) * 100) : 0;
        return `<button type="button" class="fee-row" data-field="${field}" data-value="${escapeHtml(key)}"
                aria-label="${escapeHtml(key)}: ${paid} of ${total} paid. Show who hasn't paid.">
            <span class="fee-row-label">${escapeHtml(key)}</span>
            <span class="fee-meter" aria-hidden="true"><span style="width: ${percent}%"></span></span>
            <span class="fee-row-count">${paid}/${total} <small>${total ? `${percent}%` : '–'}</small></span>
        </button>`;
    }).join('') : `<div class="empty">No ${field === 'batch' ? 'batches' : 'departments'} saved yet.</div>`) + missingNote;

    // the matching filter above the unpaid list
    const current = select.value;
    select.innerHTML = `<option value="">All ${field === 'batch' ? 'batches' : 'departments'}</option>` +
        keys.map(key => `<option value="${escapeHtml(key)}">${escapeHtml(key)}</option>`).join('');
    select.value = keys.includes(current) ? current : '';
}

document.querySelector('.fee-grid').addEventListener('click', (e) => {
    const row = e.target.closest('.fee-row');
    if (!row) return;
    // only the clicked row's filter applies, so an earlier choice can't empty the list
    batchFilter.value = row.dataset.field === 'batch' ? row.dataset.value : '';
    departmentFilter.value = row.dataset.field === 'department' ? row.dataset.value : '';
    renderUnpaid();
    document.getElementById('unpaid').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// ---------- payments per month ----------

function renderMonths() {
    // the last 12 months, oldest first, each with how many fees were recorded in it
    const now = new Date();
    const months = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
        return { year: d.getFullYear(), month: d.getMonth(), count: 0 };
    });
    members.filter(isPaid).forEach(m => {
        const date = parseDate(m.fee_paid_at, true);
        const slot = date && months.find(s => s.year === date.getFullYear() && s.month === date.getMonth());
        if (slot) slot.count += 1;
    });
    const max = Math.max(...months.map(s => s.count));
    const name = (s, style) => new Date(s.year, s.month, 1).toLocaleString('en-GB', { month: style, year: style === 'long' ? 'numeric' : undefined });
    const box = document.getElementById('by-month');
    if (!max) {
        box.innerHTML = '<div class="empty">No fees recorded in the last 12 months.</div>';
        return;
    }
    // only the busiest month gets a number on the chart; every month's number is in its tooltip and the table
    box.innerHTML = `
        <div class="month-chart" role="img" aria-label="Fees recorded per month for the last 12 months. Busiest: ${name(months.find(s => s.count === max), 'long')} with ${max}.">
            ${months.map(s => `
                <div class="month-col" tabindex="0" data-tip="${name(s, 'long')}: ${s.count} paid">
                    ${s.count === max ? `<span class="month-value">${s.count}</span>` : ''}
                    <span class="month-bar" style="height: ${(s.count / max) * 100}%"></span>
                </div>`).join('')}
        </div>
        <div class="month-labels" aria-hidden="true">${months.map(s => `<span>${name(s, 'short')}</span>`).join('')}</div>
        <details class="month-table">
            <summary>Show as a table</summary>
            <table>
                <thead><tr><th>Month</th><th>Fees recorded</th></tr></thead>
                <tbody>${months.slice().reverse().map(s => `<tr><td>${name(s, 'long')}</td><td>${s.count}</td></tr>`).join('')}</tbody>
            </table>
        </details>`;
}

// ---------- who hasn't paid ----------

function shownUnpaid() {
    const q = search.value.trim().toLowerCase();
    const matches = (select, value) => !select.value || value === select.value;
    return members
        .filter(m => !isPaid(m))
        .filter(m => matches(batchFilter, m.batch && batchName(m)) && matches(departmentFilter, m.department))
        .filter(m => !q || [m.name, m.student_id, m.club_id].some(v => (v || '').toLowerCase().includes(q)))
        .sort((a, b) => (b.batch || '').localeCompare(a.batch || '', undefined, { numeric: true }) || a.name.localeCompare(b.name));
}

function renderUnpaid() {
    const shown = shownUnpaid();
    const totalUnpaid = members.filter(m => !isPaid(m)).length;
    document.getElementById('unpaid-count').textContent = shown.length === totalUnpaid ? `(${totalUnpaid})` : `(${shown.length} of ${totalUnpaid})`;
    document.getElementById('copy-emails-btn').disabled = !shown.length;
    if (!shown.length) {
        unpaidList.innerHTML = `<div class="empty">${totalUnpaid ? 'Nobody matches these filters.' : 'Everyone has paid. 🎉'}</div>`;
        return;
    }
    unpaidList.innerHTML = shown.map(m => `
        <div class="row">
            ${avatarHtml(m)}
            <div class="row-main">
                <h3>${escapeHtml(m.name)}</h3>
                <p class="meta">${[m.student_id && `ID ${escapeHtml(m.student_id)}`, m.club_id && `Club ${escapeHtml(m.club_id)}`,
                    escapeHtml(m.batch ? batchName(m) : m.department || '')].filter(Boolean).join(' · ')}</p>
                <p class="meta">${escapeHtml(m.email)}${m.phone ? ` · ${escapeHtml(m.phone)}` : ''} · member since ${formatDate(m.created_at, { isUtc: true, withTime: false })}</p>
            </div>
            <div class="btn-group">
                <button class="btn btn-sm" data-pay="${m.id}">Mark paid</button>
            </div>
        </div>`).join('');
}

[search, batchFilter, departmentFilter].forEach(el => el.addEventListener(el === search ? 'input' : 'change', renderUnpaid));

unpaidList.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-pay]');
    if (!button) return;
    const member = members.find(m => m.id === Number(button.dataset.pay));
    payingId = member.id;
    document.getElementById('pay-name').textContent = member.name;
    payForm.reset();
    openModal(payDialog);
});

payForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('pay-name').textContent;
    submitting(payForm, async () => {
        await adminApi(`/members/${payingId}/fee`, { method: 'PUT', body: { paid: true, fee_note: payForm.elements.fee_note.value.trim() || null } });
        payDialog.close();
        toast(`${name} marked as paid`);
        load();
    });
});

// comma-separated addresses paste straight into Gmail's "To" or "Bcc" box
document.getElementById('copy-emails-btn').addEventListener('click', async () => {
    const emails = [...new Set(shownUnpaid().map(m => m.email).filter(Boolean))];
    const text = emails.join(', ');
    try {
        await navigator.clipboard.writeText(text);
        toast(`Copied ${emails.length} email address${emails.length === 1 ? '' : 'es'}. Paste them into Bcc so members don't see each other's addresses.`);
    } catch {
        showCopyBox(text);
    }
});

// ---------- recently paid ----------

function renderRecent() {
    const recent = members.filter(isPaid)
        .sort((a, b) => (parseDate(b.fee_paid_at, true) || 0) - (parseDate(a.fee_paid_at, true) || 0))
        .slice(0, 8);
    document.getElementById('recent').innerHTML = recent.length ? recent.map(m => `
        <div class="row">
            ${avatarHtml(m)}
            <div class="row-main">
                <h3>${escapeHtml(m.name)} <span class="badge badge-approved">Paid</span></h3>
                <p class="meta">${m.fee_paid_at ? formatDate(m.fee_paid_at, { isUtc: true }) : 'date not recorded'}${m.fee_note ? ` · ${escapeHtml(m.fee_note)}` : ''}</p>
            </div>
        </div>`).join('') : '<div class="empty">No fees recorded yet.</div>';
}

load();
