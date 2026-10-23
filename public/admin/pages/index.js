const admin = renderAdminLayout('index.html');
if (admin) document.getElementById('greeting').textContent = `Hello, ${admin.username} 👋`;

async function loadDashboard() {
    try {
        const [members, events, requests, messages] = await Promise.all([
            adminApi('/members'), adminApi('/events'), adminApi('/join-requests'), adminApi('/contact'),
        ]);
        const pending = requests.filter(r => r.status === 'pending');
        const upcoming = events.filter(e => isUpcoming(e.date)).sort((a, b) => parseDate(a.date) - parseDate(b.date));

        document.getElementById('stat-members').textContent = members.length;
        document.getElementById('stat-upcoming').textContent = upcoming.length;
        document.getElementById('stat-requests').textContent = pending.length;
        document.getElementById('stat-messages').textContent = messages.length;

        document.getElementById('pending').innerHTML = pending.length
            ? pending.slice(0, 5).map(r => `
                <div class="row">
                    <div class="row-main">
                        <h3>${escapeHtml(r.name)}</h3>
                        <p class="meta">${escapeHtml(r.email)} · ${formatDate(r.created_at, { isUtc: true, withTime: false })}</p>
                    </div>
                    <a class="btn btn-sm" href="requests.html">Review</a>
                </div>`).join('')
            : '<div class="empty">No pending requests. 🎉</div>';

        document.getElementById('next-events').innerHTML = upcoming.length
            ? upcoming.slice(0, 3).map(e => `
                <div class="row">
                    ${dateBadge(e.date)}
                    <div class="row-main">
                        <h3>${escapeHtml(e.title)}</h3>
                        <p class="meta">${formatDate(e.date)}</p>
                    </div>
                    <a class="btn btn-sm btn-ghost" href="event.html?id=${encodeURIComponent(e.id)}">Attendance &amp; photos</a>
                </div>`).join('')
            : '<div class="empty">No upcoming events. <a href="events.html">Add one</a></div>';
    } catch (err) {
        toast(err.message, 'error');
    }
}

loadDashboard();
