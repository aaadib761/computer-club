// Home page hero: falling 0s and 1s (like the logo) and a typing tagline.
// Uses prefersReducedMotion from common.js, so load this after it.

function startBinaryRain(canvas) {
    const ctx = canvas.getContext('2d');
    const FONT_SIZE = 16;
    const TRAIL = 14;
    let columns = [];
    let running = true;

    function resize() {
        const ratio = window.devicePixelRatio || 1;
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        const count = Math.ceil(canvas.offsetWidth / FONT_SIZE);
        // only rebuild the columns when the width changes (not when the hero just gets taller)
        if (count === columns.length) return;
        // spread columns over the whole hero so the rain is already falling on page load
        columns = Array.from({ length: count }, () => ({
            y: Math.random() * (canvas.offsetHeight + TRAIL * FONT_SIZE),
            speed: 0.6 + Math.random() * 1.4,
            chars: Array.from({ length: TRAIL }, () => (Math.random() < 0.5 ? '0' : '1')),
        }));
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
        ctx.font = `${FONT_SIZE}px "Courier New", monospace`;
        columns.forEach((col, i) => {
            col.chars.forEach((char, j) => {
                const alpha = (1 - j / TRAIL) * 0.22;
                // the leading character is orange, the trail fades to gray
                ctx.fillStyle = j === 0 ? `rgba(232, 96, 28, ${alpha * 1.6})` : `rgba(77, 77, 77, ${alpha})`;
                ctx.fillText(char, i * FONT_SIZE, col.y - j * FONT_SIZE);
            });
            col.y += col.speed;
            if (Math.random() < 0.02) col.chars.unshift(col.chars.pop());
            if (col.y - TRAIL * FONT_SIZE > canvas.offsetHeight) {
                col.y = Math.random() * -100;
                col.speed = 0.6 + Math.random() * 1.4;
            }
        });
    }

    function loop() {
        if (running) draw();
        requestAnimationFrame(loop);
    }

    resize();
    // the hero grows when the countdown appears, so watch the canvas itself, not just the window
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize);

    if (prefersReducedMotion) {
        draw();
        return;
    }

    // stop drawing while the hero is scrolled out of view or the tab is hidden
    new IntersectionObserver(([entry]) => { running = entry.isIntersecting; }).observe(canvas);
    document.addEventListener('visibilitychange', () => { running = !document.hidden; });
    loop();
}

function startTyping(element, phrases) {
    if (prefersReducedMotion) {
        element.textContent = phrases[0];
        return;
    }
    let phrase = 0;
    let length = 0;
    let deleting = false;

    function tick() {
        const text = phrases[phrase];
        length += deleting ? -1 : 1;
        element.textContent = text.slice(0, length);

        let delay = deleting ? 40 : 85;
        if (!deleting && length === text.length) {
            deleting = true;
            delay = 1800;
        } else if (deleting && length === 0) {
            deleting = false;
            phrase = (phrase + 1) % phrases.length;
            delay = 350;
        }
        setTimeout(tick, delay);
    }
    tick();
}

const rainCanvas = document.getElementById('binary-rain');
if (rainCanvas) startBinaryRain(rainCanvas);

const typedText = document.getElementById('typed');
if (typedText) {
    startTyping(typedText, [
        'We code.',
        'We build.',
        'We compete.',
        'We learn together.',
        'git commit -m "join us"',
    ]);
}
