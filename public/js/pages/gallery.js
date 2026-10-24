// All event photos, grouped into one album per event.
const albumsBox = document.getElementById('albums');
setupLightbox(albumsBox);

let photos = [];
let category = '';   // '' = all categories

function renderAlbums() {
    const shown = category ? photos.filter(p => p.category === category) : photos;
    if (!shown.length) {
        albumsBox.innerHTML = `<div class="empty">${photos.length ? 'No photos in this category yet.' : 'No photos yet. Check back after our next event!'}</div>`;
        return;
    }

    // photos arrive sorted by event date, so grouping keeps that order
    const albums = [];
    shown.forEach(p => {
        let album = albums.find(a => a.event_id === p.event_id);
        if (!album) albums.push(album = { event_id: p.event_id, title: p.event_title, date: p.event_date, photos: [] });
        album.photos.push(p);
    });

    albumsBox.innerHTML = albums.map(a => `
        <section class="album">
            <div class="section-title">
                <h2 style="font-size: 1.2rem;">${escapeHtml(a.title)}</h2>
                <a href="event.html?id=${encodeURIComponent(a.event_id)}">${formatDate(a.date, { withTime: false })} · Event details &rarr;</a>
            </div>
            <div class="gallery">
                ${a.photos.map(p => `
                    <figure>
                        <a href="${escapeHtml(photoUrl(p.photo_path))}" data-caption="${escapeHtml(p.caption || a.title)}">
                            <img src="${escapeHtml(photoUrl(p.photo_path))}" alt="${escapeHtml(p.caption || a.title)}" loading="lazy">
                        </a>
                        ${p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ''}
                    </figure>`).join('')}
            </div>
        </section>`).join('');
}

function renderChips() {
    const box = document.getElementById('category-chips');
    const used = [...new Set(photos.map(p => p.category).filter(Boolean))].sort();
    if (used.length < 2) {
        box.classList.add('hidden');
        return;
    }
    box.innerHTML = ['', ...used].map(c => `
        <button type="button" class="chip ${c === category ? 'active' : ''}" data-category="${escapeHtml(c)}" aria-pressed="${c === category}">
            ${c ? escapeHtml(c) : 'All'}
        </button>`).join('');
}

document.getElementById('category-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-category]');
    if (!chip) return;
    category = chip.dataset.category;
    renderChips();
    renderAlbums();
});

async function loadGallery() {
    try {
        photos = await api('/photos');
        renderChips();
        renderAlbums();
    } catch (err) {
        albumsBox.innerHTML = `<div class="empty">Couldn't load photos. ${escapeHtml(err.message)}</div>`;
    }
}

loadGallery();
