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

        const status = eventStatus(event);
        document.title = `${event.title} | NDUB Computer Club`;
        title.textContent = event.title;
        date.innerHTML = `
            <span class="event-tags" style="display:inline-flex; margin: 0 6px 0 0;">
                ${event.category ? `<span class="tag">${escapeHtml(event.category)}</span>` : ''}
                <span class="tag tag-${status.key}">${status.label}</span>
            </span>
            ${formatDate(event.date)}`;

        // only show the details that were filled in
        const detail = (label, value, sub) => value
            ? `<div class="detail"><small>${label}</small><b>${escapeHtml(value)}</b>${sub ? `<span>${escapeHtml(sub)}</span>` : ''}</div>`
            : '';
        const details = [
            detail('Resource person', event.speaker, event.speaker_title),
            detail('Venue', event.venue),
            detail('Duration', event.duration),
            status.key === 'completed' && event.attendees ? detail('Attended', `${event.attendees} members`) : '',
            detail('Event code', eventCode(event.id)),
        ].join('');

        // the server makes both, so the event's time zone and end time are worked out in one place
        const id = encodeURIComponent(event.id);
        const calendar = status.key === 'completed' ? '' : `
            <div class="calendar-actions">
                <a class="btn btn-outline btn-small" href="/events/${id}/google-calendar" target="_blank" rel="noopener">📅 Add to Google Calendar</a>
                <a class="btn btn-outline btn-small" href="/events/${id}/calendar.ics" download>⬇️ Apple / Outlook (.ics)</a>
            </div>`;

        body.innerHTML = `
            <div class="detail-grid">${details}</div>
            ${calendar}
            ${event.description ? `<div class="card"><p class="text-pre" style="margin:0;">${escapeHtml(event.description)}</p></div>` : ''}`;

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
