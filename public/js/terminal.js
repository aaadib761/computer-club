// Hidden terminal easter egg. Press ` (backtick) or click >_ in the footer.

(function () {
    const box = document.createElement('div');
    box.className = 'terminal hidden';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Club terminal');
    box.innerHTML = `
        <div class="term-bar">
            <span class="term-dots"><i></i><i></i><i></i></span>
            <span>guest@ndubcc: ~</span>
            <button class="term-close" aria-label="Close terminal">&times;</button>
        </div>
        <div class="term-output" aria-live="polite"></div>
        <form class="term-input-row">
            <span class="term-prompt">guest@ndubcc:~$</span>
            <input class="term-input" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Terminal command">
        </form>`;
    document.body.appendChild(box);

    const output = box.querySelector('.term-output');
    const input = box.querySelector('.term-input');
    const history = [];
    let historyIndex = 0;
    let greeted = false;

    const PAGES = {
        home: 'index.html',
        events: 'events.html',
        committee: 'committee.html',
        join: 'join.html',
        contact: 'contact.html',
    };

    // All output goes through textContent, so nothing from the API can run as HTML.
    function print(text = '', type = '') {
        const line = document.createElement('div');
        if (type) line.className = `term-${type}`;
        line.textContent = text;
        output.appendChild(line);
        output.scrollTop = output.scrollHeight;
    }

    function go(page) {
        print(`Opening ${page}...`, 'muted');
        setTimeout(() => { location.href = PAGES[page]; }, 400);
    }

    const COMMANDS = {
        help() {
            print('Available commands:', 'accent');
            [
                ['about', 'what is this club?'],
                ['events', 'upcoming events'],
                ['committee', 'who runs the club'],
                ['news', 'latest announcements'],
                ['stats', 'club numbers'],
                ['ls', 'list pages'],
                ['cd <page>', 'go to a page (e.g. cd join)'],
                ['join', 'become a member'],
                ['whoami, date, echo, clear, exit', ''],
            ].forEach(([cmd, desc]) => print(`  ${cmd.padEnd(32)}${desc}`));
            print('Psst... there might be a few hidden ones too.', 'muted');
        },
        about() {
            print('NDUB Computer Club', 'accent');
            print("Notre Dame University Bangladesh's community for coding,");
            print('workshops, programming contests and everything tech.');
            print("Everyone's welcome, from first line of code to ICPC finalist.");
        },
        async events() {
            print('Fetching events...', 'muted');
            const events = await api('/events');
            const upcoming = events.filter(e => isUpcoming(e.date)).sort((a, b) => parseDate(a.date) - parseDate(b.date));
            if (!upcoming.length) return print('No upcoming events right now. Stay tuned!');
            upcoming.forEach(e => print(`  ${formatDate(e.date)}  —  ${e.title}`));
            print("Type 'cd events' to see them all.", 'muted');
        },
        async committee() {
            print('Fetching committee...', 'muted');
            const members = await api('/members/executive');
            if (!members.length) return print('The committee will be announced soon.');
            members.forEach(m => print(`  ${(m.position || 'Member').padEnd(22)}${m.name}`));
        },
        async news() {
            print('Fetching announcements...', 'muted');
            const list = await api('/announcements');
            if (!list.length) return print('No announcements yet.');
            list.slice(0, 3).forEach(a => print(`  * ${a.title}`));
        },
        async stats() {
            const s = await api('/stats');
            print(`  members: ${s.members}   events: ${s.events}   photos: ${s.photos}`);
        },
        ls() {
            print(Object.keys(PAGES).map(p => `${p}/`).join('   '));
        },
        cd(args) {
            const page = (args[0] || '').replace(/\/$/, '').replace(/\.html$/, '');
            if (!page || page === '~' || page === 'index') return go('home');
            if (!PAGES[page]) return print(`cd: no such page: ${page}  (try 'ls')`, 'error');
            go(page);
        },
        join() { go('join'); },
        contact() { go('contact'); },
        whoami() { print('guest — but you could be a member. Try: join'); },
        date() { print(new Date().toString()); },
        echo(args) { print(args.join(' ')); },
        clear() { output.innerHTML = ''; },
        exit() { close(); },

        // hidden ones
        sudo() { print('Nice try. This incident will be reported to the club president.', 'error'); },
        hello() { print('Hello, world! 👋'); },
        hi() { print('Hi there! Type help to get started.'); },
        coffee() { print('☕ Brewing... Error 418: I\'m a teapot.'); },
        matrix() {
            print('Wake up, Neo...', 'accent');
            setTimeout(() => print('The Matrix has you...', 'accent'), 900);
            setTimeout(() => print('Follow the orange rabbit. 🐇', 'accent'), 1800);
        },
        'rm'(args) {
            if (args.join(' ').includes('-rf')) print("Whoa! Let's not delete the club. 😅", 'error');
            else print('rm: permission denied', 'error');
        },
        git(args) {
            if (args[0] === 'commit') print('[main 1a2b3c4] you are now officially awesome');
            else if (args[0] === 'push') print('Pushing motivation... done ✔');
            else print('usage: git commit | git push');
        },
    };

    async function run(raw) {
        const text = raw.trim();
        print(`guest@ndubcc:~$ ${text}`, 'cmd');
        if (!text) return;
        history.push(text);
        historyIndex = history.length;

        const [name, ...args] = text.split(/\s+/);
        const command = COMMANDS[name.toLowerCase()];
        if (!command) return print(`command not found: ${name}. Type 'help' for a list.`, 'error');
        try {
            await command(args);
        } catch (err) {
            print(`error: ${err.message}`, 'error');
        }
    }

    function open() {
        box.classList.remove('hidden');
        if (!greeted) {
            greeted = true;
            print('NDUB Computer Club terminal v1.0', 'accent');
            print("You found the secret terminal! Type 'help' to begin.", 'muted');
        }
        input.focus();
    }

    function close() {
        box.classList.add('hidden');
    }

    box.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const value = input.value;
        input.value = '';
        run(value);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' && historyIndex > 0) {
            input.value = history[--historyIndex];
            e.preventDefault();
        } else if (e.key === 'ArrowDown') {
            historyIndex = Math.min(historyIndex + 1, history.length);
            input.value = history[historyIndex] || '';
            e.preventDefault();
        } else if (e.key === 'Escape') {
            close();
        }
    });

    box.querySelector('.term-close').addEventListener('click', close);
    box.addEventListener('click', (e) => { if (e.target.closest('.term-output')) input.focus(); });

    // ` toggles the terminal, unless you're typing in a form field
    document.addEventListener('keydown', (e) => {
        if (e.key !== '`') return;
        const typing = e.target.matches('input, textarea, [contenteditable]') && e.target !== input;
        if (typing) return;
        e.preventDefault();
        box.classList.contains('hidden') ? open() : close();
    });

    const footerButton = document.querySelector('.term-open');
    if (footerButton) footerButton.addEventListener('click', open);
})();
