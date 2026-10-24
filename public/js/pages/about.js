// Shown until admins write the real text in Admin > About & Advisors.
const DEFAULT_ABOUT = 'NDUB Computer Club is the computing community of Notre Dame University Bangladesh. ' +
    'We organise seminars, workshops, programming contests and fests to help students learn, build and grow together.';

async function loadAbout() {
    const [info, stats] = await Promise.all([clubInfo(), api('/stats').catch(() => null)]);

    // the text keeps the admin's paragraphs (blank lines split them)
    const paragraphs = (info.about_text || DEFAULT_ABOUT).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    document.getElementById('about-text').innerHTML = paragraphs.map(p => `<p class="text-pre">${escapeHtml(p)}</p>`).join('');

    const objectives = (info.objectives || '').split('\n').map(o => o.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean);
    if (objectives.length) {
        document.getElementById('objectives').innerHTML = objectives.map(o => `<li>${escapeHtml(o)}</li>`).join('');
        document.getElementById('objectives-wrap').classList.remove('hidden');
    }

    if (info.founded_year) {
        const founded = document.getElementById('fact-founded');
        founded.innerHTML = `🎂 Founded in <b>${escapeHtml(info.founded_year)}</b>`;
        founded.classList.remove('hidden');
    }
    if (stats) {
        document.getElementById('fact-members').innerHTML = `👥 <b>${stats.members}</b> members`;
        document.getElementById('fact-events').innerHTML = `📅 <b>${stats.events}</b> events organised`;
    }
}

async function loadAdvisors() {
    const box = document.getElementById('advisors');
    try {
        const advisors = await api('/advisors');
        if (!advisors.length) {
            document.getElementById('advisors-section').classList.add('hidden');
            return;
        }
        box.innerHTML = advisors.map(a => `
            <article class="card advisor-card">
                ${a.photo_path
                    ? `<img class="avatar" src="${escapeHtml(photoUrl(a.photo_path))}" alt="${escapeHtml(a.name)}" loading="lazy">`
                    : `<div class="avatar" aria-hidden="true">${escapeHtml(initials(a.name))}</div>`}
                <h3>${escapeHtml(a.name)}</h3>
                <p class="role">${escapeHtml(a.role)}</p>
                ${a.designation ? `<p class="meta">${escapeHtml(a.designation)}</p>` : ''}
                ${a.message ? `<blockquote>“${escapeHtml(a.message)}”</blockquote>` : ''}
                ${a.profile_url ? `<a href="${escapeHtml(a.profile_url)}" target="_blank" rel="noopener">View profile &rarr;</a>` : ''}
            </article>`).join('');
    } catch (err) {
        box.innerHTML = `<div class="empty">Couldn't load advisors. ${escapeHtml(err.message)}</div>`;
    }
}

loadAbout();
loadAdvisors();
