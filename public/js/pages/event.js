setupLightbox(document.getElementById('gallery'));

const eventId = new URLSearchParams(location.search).get('id');

async function loadEvent() {
    const title = document.getElementById('event-title');
    const date = document.getElementById('event-date');
    const body = document.getElementById('event-body');
    const gallery = document.getElementById('gallery');

    if (!eventId) {
        title.textContent = 'Event not found';
        gallery.innerHTML = '';
        return;
    }

    try {
        const [event, photos] = await Promise.all([
            api(`/events/${encodeURIComponent(eventId)}`),
            api(`/events/${encodeURIComponent(eventId)}/photos`),
        ]);

        document.title = `${event.title} | NDUB Computer Club`;
        title.textContent = event.title;
        date.innerHTML = `${formatDate(event.date)} ${isUpcoming(event.date) ? '&middot; <b style="color: var(--orange-dark);">Upcoming</b>' : ''}`;
        body.innerHTML = event.description
            ? `<div class="card"><p class="text-pre" style="margin:0;">${escapeHtml(event.description)}</p></div>`
            : '';

        gallery.innerHTML = photos.length
            ? photos.map(p => `
                <figure>
                    <a href="${escapeHtml(photoUrl(p.photo_path))}" data-caption="${escapeHtml(p.caption || '')}">
                        <img src="${escapeHtml(photoUrl(p.photo_path))}" alt="${escapeHtml(p.caption || event.title)}" loading="lazy">
                    </a>
                    ${p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ''}
                </figure>`).join('')
            : '<div class="empty" style="grid-column: 1 / -1;">No photos for this event yet.</div>';
    } catch (err) {
        title.textContent = 'Event not found';
        date.textContent = "This event doesn't exist or may have been removed.";
        gallery.innerHTML = '';
        document.querySelector('#gallery').previousElementSibling.classList.add('hidden');
    }
}

loadEvent();
