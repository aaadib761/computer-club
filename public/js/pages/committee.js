// The current committee as photo cards, then the panel list of every committee (current one first).

function committeeCards(members) {
    const box = document.getElementById('committee');
    if (members.length === 0) {
        box.innerHTML = '<div class="empty">The committee will be announced soon.</div>';
        return;
    }
    box.innerHTML = members.map(m => `
        <article class="card member-card">
            ${m.photo_path
                ? `<img class="avatar" src="${escapeHtml(photoUrl(m.photo_path))}" alt="${escapeHtml(m.name)}" loading="lazy">`
                : `<div class="avatar" aria-hidden="true">${escapeHtml(initials(m.name))}</div>`}
            <h3>${escapeHtml(m.name)}</h3>
            <p class="role">${escapeHtml(m.position || 'Member')}</p>
        </article>`).join('');
}

// e.g. "13th Executive Committee" and "2025-2026", set in Admin > About & Advisors
function showTerm(info) {
    if (!info.committee_term) return;
    const label = document.getElementById('term-label');
    label.textContent = [info.committee_term, info.committee_session].filter(Boolean).join(' · ');
    label.classList.remove('hidden');
}

const PANEL_COLUMNS = [['position', 'Position'], ['name', 'Name'], ['department', 'Department'], ['batch', 'Batch']];

function panelHtml(panel, open) {
    // department and batch are optional; leave the column out when nobody has one
    const columns = PANEL_COLUMNS.filter(([key]) => panel.members.some(m => m[key]));
    return `
        <details class="past-term"${open ? ' open' : ''}>
            <summary>
                <span>${escapeHtml(panel.term)}${panel.current ? ' <span class="badge-current">Current</span>' : ''}</span>
                <small>${[panel.session, `${panel.members.length} ${panel.members.length === 1 ? 'member' : 'members'}`].filter(Boolean).map(escapeHtml).join(' · ')}</small>
            </summary>
            <div class="panel-table-wrap">
                <table class="panel-table">
                    <thead><tr>${columns.map(([, label]) => `<th>${label}</th>`).join('')}</tr></thead>
                    <tbody>${panel.members.map(m => `
                        <tr>${columns.map(([key]) => `<td>${escapeHtml(m[key] || '')}</td>`).join('')}</tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </details>`;
}

function committeePanels(current, info, past) {
    const panels = [...past];
    if (current.length) {
        panels.unshift({
            term: info.committee_term || 'Current committee',
            session: info.committee_session || '',
            current: true,
            members: current.map(m => ({ position: m.position, name: m.name })),
        });
    }
    // only worth a section when there's history to show
    if (!past.length) return;
    document.getElementById('past-committees').innerHTML = panels.map((p, i) => panelHtml(p, i === 0)).join('');
    document.getElementById('past-section').classList.remove('hidden');
}

async function loadCommittee() {
    const [current, info, past] = await Promise.allSettled([api('/members/executive'), clubInfo(), api('/committee-archive')]);
    if (current.status === 'fulfilled') {
        committeeCards(current.value);
    } else {
        document.getElementById('committee').innerHTML =
            `<div class="empty">Couldn't load the committee. ${escapeHtml(current.reason.message)}</div>`;
    }
    const settings = info.status === 'fulfilled' ? info.value : {};
    showTerm(settings);
    // past committees are optional, so a failure there just hides the section
    if (past.status === 'fulfilled') committeePanels(current.status === 'fulfilled' ? current.value : [], settings, past.value);
}

loadCommittee();
