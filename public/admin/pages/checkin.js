// Door check-in: scan a membership card's QR code (or type a club ID) to mark the member present.
// Uses eventId / loadAttendance from event.js and refreshEventExtras from event-extras.js.

const scanVideo = document.getElementById('scan-video');
const scanner = document.getElementById('scanner');
const scanResult = document.getElementById('scan-result');
const startButton = document.getElementById('scan-start');
const stopButton = document.getElementById('scan-stop');

let stream = null;
let scanning = false;
let decode = null;          // function(video) -> QR text or null
let audio = null;
let lastText = '';
let lastTime = 0;
const SAME_CARD_PAUSE_MS = 4000;   // ignore the same card for a few seconds after a scan

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject });
        document.head.appendChild(script);
    });
}

// The browser's own QR reader is fastest; otherwise use the jsQR library.
async function makeDecoder() {
    if ('BarcodeDetector' in window) {
        try {
            if ((await BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
                const detector = new BarcodeDetector({ formats: ['qr_code'] });
                return async (video) => (await detector.detect(video))[0]?.rawValue || null;
            }
        } catch { /* fall back to jsQR */ }
    }
    await loadScript('/vendor/jsQR.js');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return async (video) => {
        const scale = Math.min(1, 640 / video.videoWidth);   // smaller frames are much faster to read
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data || null;
    };
}

// A card's QR holds a link like .../verify.html?club_id=NDUBCC-001; a plain club ID works too.
function clubIdFrom(text) {
    try {
        const id = new URL(text).searchParams.get('club_id');
        if (id) return id;
    } catch { /* not a link */ }
    return /^[A-Za-z0-9-]{3,30}$/.test(text.trim()) ? text.trim() : null;
}

function beep(ok) {
    if (!audio) return;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (ok ? 0.12 : 0.35));
}

function showResult(type, html) {
    scanResult.className = `scan-result scan-${type}`;
    scanResult.innerHTML = html;
}

async function checkIn(clubId) {
    try {
        const { member, already } = await adminApi(`/events/${encodeURIComponent(eventId)}/checkin`, {
            method: 'POST',
            body: { club_id: clubId },
        });
        beep(true);
        showResult(already ? 'info' : 'ok', `
            ${avatarHtml(member)}
            <div>
                <b>${escapeHtml(member.name)}</b>
                <span>${already ? 'ℹ️ Already checked in' : '✅ Checked in'} · ${escapeHtml(member.club_id)}</span>
            </div>`);
        if (!already) {
            loadAttendance();
            refreshEventExtras();
        }
    } catch (err) {
        beep(false);
        showResult('error', `<div><b>❌ Not checked in</b><span>${escapeHtml(err.message)}</span></div>`);
    }
}

async function scanLoop() {
    if (!scanning) return;
    try {
        if (scanVideo.readyState >= 2) {
            const text = await decode(scanVideo);
            const now = Date.now();
            if (text && (text !== lastText || now - lastTime > SAME_CARD_PAUSE_MS)) {
                lastText = text;
                lastTime = now;
                const clubId = clubIdFrom(text);
                if (clubId) await checkIn(clubId);
                else showResult('error', '<div><b>❌ Not a membership card</b><span>This QR code isn\'t from an NDUBCC card.</span></div>');
            }
        }
    } catch { /* a frame that can't be read; try the next one */ }
    setTimeout(scanLoop, 200);
}

async function startScanning() {
    // browsers only allow the camera on https:// sites (and on localhost)
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        return showResult('error', `<div><b>Camera not available here</b><span>The camera only works when the site is opened over https:// (or on this computer as localhost). Type club IDs below instead.</span></div>`);
    }
    startButton.disabled = true;
    try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        decode = decode || await makeDecoder();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        scanVideo.srcObject = stream;
        await scanVideo.play();
        scanner.classList.remove('hidden');
        startButton.classList.add('hidden');
        stopButton.classList.remove('hidden');
        scanning = true;
        showResult('info', '<div><b>Scanning…</b><span>Hold a membership card\'s QR code in front of the camera.</span></div>');
        scanLoop();
    } catch (err) {
        const reason = err.name === 'NotAllowedError' ? 'Camera permission was refused. Allow it in the browser\'s address bar and try again.'
            : err.name === 'NotFoundError' ? 'No camera was found on this device.'
            : `The camera couldn't start (${err.message}).`;
        showResult('error', `<div><b>Camera problem</b><span>${escapeHtml(reason)}</span></div>`);
        stopScanning();
    } finally {
        startButton.disabled = false;
    }
}

function stopScanning() {
    scanning = false;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    scanVideo.srcObject = null;
    scanner.classList.add('hidden');
    startButton.classList.remove('hidden');
    stopButton.classList.add('hidden');
}

startButton.addEventListener('click', startScanning);
stopButton.addEventListener('click', stopScanning);
window.addEventListener('pagehide', stopScanning);

document.getElementById('manual-checkin').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.elements.club_id;
    const clubId = input.value.trim();
    if (!clubId) return input.focus();
    checkIn(clubId);
    input.value = '';
});
