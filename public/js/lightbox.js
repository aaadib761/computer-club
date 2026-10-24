// Full-screen photo viewer for galleries: arrows, keyboard and swipe.
// Usage: setupLightbox(galleryElement) — every photo link (<figure><a>) inside opens it;
// other links, like "Event details", work normally.

const PHOTO_LINKS = 'figure a';

function setupLightbox(gallery) {
    const box = document.createElement('div');
    box.className = 'lightbox hidden';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = `
        <button class="lb-close" aria-label="Close">&times;</button>
        <button class="lb-prev" aria-label="Previous photo">&#8249;</button>
        <figure>
            <img alt="">
            <figcaption></figcaption>
        </figure>
        <button class="lb-next" aria-label="Next photo">&#8250;</button>
        <span class="lb-count"></span>`;
    document.body.appendChild(box);

    const img = box.querySelector('img');
    const caption = box.querySelector('figcaption');
    const counter = box.querySelector('.lb-count');
    let items = [];
    let index = 0;
    let lastFocus = null;

    function show(i) {
        index = (i + items.length) % items.length;
        const item = items[index];
        img.src = item.src;
        img.alt = item.caption || 'Event photo';
        caption.textContent = item.caption || '';
        counter.textContent = `${index + 1} / ${items.length}`;
        box.classList.toggle('single', items.length < 2);
    }

    function open(i) {
        items = [...gallery.querySelectorAll(PHOTO_LINKS)].map(a => ({
            src: a.getAttribute('href'),
            caption: a.dataset.caption || '',
        }));
        lastFocus = document.activeElement;
        show(i);
        box.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        box.querySelector('.lb-close').focus();
    }

    function close() {
        box.classList.add('hidden');
        document.body.style.overflow = '';
        img.src = '';
        lastFocus?.focus();
    }

    gallery.addEventListener('click', (e) => {
        const link = e.target.closest(PHOTO_LINKS);
        if (!link) return;
        e.preventDefault();
        open([...gallery.querySelectorAll(PHOTO_LINKS)].indexOf(link));
    });

    box.querySelector('.lb-close').addEventListener('click', close);
    box.querySelector('.lb-prev').addEventListener('click', () => show(index - 1));
    box.querySelector('.lb-next').addEventListener('click', () => show(index + 1));
    // clicking the dark background (not the photo) closes it
    box.addEventListener('click', (e) => { if (e.target === box) close(); });

    document.addEventListener('keydown', (e) => {
        if (box.classList.contains('hidden')) return;
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowLeft') show(index - 1);
        if (e.key === 'ArrowRight') show(index + 1);
    });

    let touchStartX = null;
    box.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', (e) => {
        if (touchStartX === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
        touchStartX = null;
    });
}
