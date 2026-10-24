renderAdminLayout('messages.html');

let messages = [];
const list = document.getElementById('list');

async function load() {
    try {
        messages = await adminApi('/contact');
        refreshNavCounts();
        list.innerHTML = messages.length
            ? messages.map(m => `
                <div class="row">
                    <div class="row-main">
                        <h3>${escapeHtml(m.name)}</h3>
                        <p class="meta">${escapeHtml(m.email)} · ${formatDate(m.created_at, { isUtc: true })}</p>
                        <p class="row-text">${escapeHtml(m.message)}</p>
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-sm" data-copy="${escapeHtml(m.email)}">Copy email</button>
                        <a class="btn btn-sm btn-ghost" href="mailto:${escapeHtml(m.email)}?subject=${encodeURIComponent('Re: your message to NDUB Computer Club')}">Email app</a>
                        <button class="btn btn-sm btn-danger" data-id="${m.id}">Delete</button>
                    </div>
                </div>`).join('')
            : '<div class="empty">No messages. 📭</div>';
    } catch (err) {
        list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

list.addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-id]');
    if (!button) return;
    const message = messages.find(m => m.id === Number(button.dataset.id));
    if (!(await confirmBox({ title: 'Delete this message?', message: `The message from ${message.name} will be deleted.` }))) return;
    try {
        await adminApi(`/contact/${message.id}`, { method: 'DELETE' });
        toast('Message deleted');
        load();
    } catch (err) {
        toast(err.message, 'error');
    }
});

load();
