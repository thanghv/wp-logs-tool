// injected.js
// Injected into admin page context by WP plugin. Exposes window.wpLogsTool (with UI).
(function (window, document) {
    if (window.wpLogsTool) return;

    // ---------- helpers ----------
    function msToHMS(ms) {
        const s = Math.floor(ms / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    }

    // storage
    var STORAGE_INDEX = 'wpLogsTool:pages'; // JSON array of page keys (with metadata)
    var STORAGE_PREFIX = 'wpLogsTool:logs::'; // followed by pageKey
    var MAX_LOGS = 5000;
    var MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

    function getPageKey() {
        // include pathname + search to differentiate pages with query strings
        return location.pathname + location.search;
    }

    function loadIndex() {
        try {
            const raw = localStorage.getItem(STORAGE_INDEX);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function saveIndex(idx) {
        try {
            localStorage.setItem(STORAGE_INDEX, JSON.stringify(idx));
        } catch (e) { }
    }

    function addPageToIndex(pageKey) {
        try {
            const idx = loadIndex();
            if (!idx[pageKey]) {
                idx[pageKey] = { firstSeen: Date.now(), lastSeen: Date.now() };
            } else {
                idx[pageKey].lastSeen = Date.now();
            }
            saveIndex(idx);
        } catch (e) { }
    }

    function storageKeyFor(pageKey) {
        return STORAGE_PREFIX + pageKey;
    }

    function savePageLogs(pageKey, logs) {
        try {
            const cutoff = Date.now() - MAX_AGE_MS;
            logs = logs.filter(l => l.ts >= cutoff);
            if (logs.length > MAX_LOGS) logs = logs.slice(logs.length - MAX_LOGS);
            localStorage.setItem(storageKeyFor(pageKey), JSON.stringify(logs));
            addPageToIndex(pageKey);
        } catch (e) { }
    }

    function loadPageLogs(pageKey) {
        try {
            const raw = localStorage.getItem(storageKeyFor(pageKey));
            let logs = raw ? JSON.parse(raw) : [];
            const cutoff = Date.now() - MAX_AGE_MS;
            logs = logs.filter(l => l.ts >= cutoff);

            // migrate: ensure each entry has a datetime string
            let migrated = false;
            for (let i = 0; i < logs.length; i++) {
                const l = logs[i];
                if (!l.datetime) {
                    // if ts exists use it, otherwise generate now
                    const tsVal = (typeof l.ts === 'number' && isFinite(l.ts)) ? l.ts : Date.now();
                    l.datetime = formatDateTime(tsVal);
                    migrated = true;
                }
            }

            // if we migrated, save back deduped/trimmed logs
            if (migrated) {
                savePageLogs(pageKey, logs);
            }

            return logs;
        } catch (e) {
            return [];
        }
    }

    function loadAllPages() {
        const idx = loadIndex();
        return Object.keys(idx).sort((a, b) => idx[b].lastSeen - idx[a].lastSeen);
    }

    function clearPage(pageKey) {
        try {
            localStorage.removeItem(storageKeyFor(pageKey));
            const idx = loadIndex();
            delete idx[pageKey];
            saveIndex(idx);
        } catch (e) { }
    }

    function clearAll() {
        try {
            const pages = loadAllPages();
            pages.forEach(p => localStorage.removeItem(storageKeyFor(p)));
            saveIndex({});
        } catch (e) { }
    }

    function exportPageText(pageKey) {
        const logs = loadPageLogs(pageKey);
        return logs.map(l => {
            const dt = l && l.datetime ? ('[' + l.datetime + '] ') : '';
            const tm = '[' + (l && l.time ? l.time : '') + '] ';
            const txt = l && l.text ? l.text : '';
            return dt + tm + txt;
        }).join('\n');
    }

    function exportAllText() {
        const pages = loadAllPages();
        let out = [];
        pages.forEach(p => {
            out.push('--- PAGE: ' + p + ' ---');
            out.push(exportPageText(p));
        });
        return out.join('\n');
    }

    // Helper to decide log color
    function getLogColor(entry, isOld) {
        let color = '#4ade80'; // default live = green

        if (isOld) {
            color = '#60a5fa'; // saved = blue
        }
        if (entry && (!entry.text || entry.text === '')) {
            color = '#a3a3a3'; // timer tick = gray
        }
        if (entry && entry.text && entry.text.toLowerCase().includes('error')) {
            color = '#f87171'; // error = red
        }
        if (entry && entry.text && entry.text.toLowerCase().includes('manual')) {
            color = '#facc15'; // manual log = yellow
        }

        return color;
    }

    // format a Date into "YYYY-MM-DD HH:MM:SS"
    function formatDateTime(ts) {
        try {
            const d = ts ? new Date(ts) : new Date();
            const YYYY = d.getFullYear();
            const MM = String(d.getMonth() + 1).padStart(2, '0');
            const DD = String(d.getDate()).padStart(2, '0');
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            const ss = String(d.getSeconds()).padStart(2, '0');
            return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
        } catch (e) {
            return String(new Date());
        }
    }

    // ---------- single idempotent wplogstool:log handler + dedupe ----------
    (function () {
        // recent map to dedupe identical events for a short window (ms)
        if (!window._tc_recent) window._tc_recent = new Map();
        const RECENT_WINDOW = 3000; // ms - treat identical logs within 3s as duplicates

        function makeKey(entry, pageKey) {
            // key uses timestamp + text + pageKey — adjust if you have other unique id
            return (entry && entry.ts ? entry.ts : '') + '|' + (entry && entry.text ? entry.text : '') + '|' + (pageKey || '');
        }

        function pruneRecent() {
            const now = Date.now();
            for (const [k, t] of window._tc_recent) {
                if (now - t > RECENT_WINDOW) window._tc_recent.delete(k);
            }
        }

        function isDuplicate(entry, pageKey) {
            // prune old entries first
            pruneRecent();

            const isTick = (!entry.text || entry.text === '');
            if (isTick) {
                const thisTick = entry.time || '';
                if (window._tc_last_tick_time === thisTick) return true;
                window._tc_last_tick_time = thisTick;
            } else {
                const key = makeKey(entry, pageKey || getPageKey());
                if (window._tc_recent.has(key)) return true;
                // don't set here — let the caller set after handling (to avoid race)
            }
            return false;
        }


        // register a single handler only once
        if (!window._wpLogsToolLogHandlerAdded) {
            window._wpLogsToolLogHandlerAdded = true;

            document.addEventListener('wplogstool:log', function (ev) {
                try {
                    const detail = ev && ev.detail ? ev.detail : {};
                    const entry = detail.entry || detail; // support both shapes
                    const pKey = detail.pageKey || getPageKey();

                    // use the pageKey-aware duplicate check
                    if (isDuplicate(entry, pKey)) return;

                    // dedupe: record this event now
                    const key = makeKey(entry, pKey);
                    window._tc_recent.set(key, Date.now());

                    // ensure page index exists and selector updated
                    try { addPageToIndex(pKey); } catch (e) { /* ignore */ }
                    try { refreshPageSelector(); } catch (e) { /* ignore */ }

                    // append to UI (if flybox is visible / selector matches)
                    try { addLogToFlyBox(entry, false, pKey); } catch (e) { /* ignore */ }

                    try {
                        const isTick = (entry && (!entry.text || entry.text === ''));
                        const label = isTick ? '' : '';
                        // include datetime at the beginning if available
                        const dtPart = entry && entry.datetime ? ('[' + entry.datetime + '] ') : '';
                        const display = isTick
                            ? (dtPart + label + '[' + (entry && entry.time ? entry.time : '') + '] ....')
                            : (dtPart + '[' + (entry && entry.time ? entry.time : '') + '] ' + (entry && entry.text ? entry.text : ''));

                        // only this handler prints live console lines
                        console.log('%c' + display, 'color: green;');

                    } catch (e) { /* ignore console errors */ }

                } catch (err) {
                    // swallow to avoid breaking host page
                    try { console.warn('wplogstool handler error', err); } catch (e) { }
                }
            }, { passive: true });
        }
    })();


    // ---------- fly box UI ----------

    // ---------- UI state + position/size helpers ----------
    var STORAGE_UI_STATE = 'wpLogsTool:uiState';       // per-page state (object keyed by pageKey)
    var STORAGE_UI_GLOBAL = 'wpLogsTool:uiGlobal';     // global UI state (object)

    /* Per-page UI state helpers */
    function loadUIStateIndex() {
        try {
            const raw = localStorage.getItem(STORAGE_UI_STATE);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }
    function saveUIStateIndex(idx) {
        try { localStorage.setItem(STORAGE_UI_STATE, JSON.stringify(idx)); } catch (e) { }
    }
    function getUIStateFor(pageKey) {
        const idx = loadUIStateIndex();
        return idx[pageKey] || { collapsed: false };
    }
    function setUIStateFor(pageKey, state) {
        const idx = loadUIStateIndex();
        idx[pageKey] = state;
        saveUIStateIndex(idx);
    }

    /* Global UI state helpers */
    function loadGlobalUIState() {
        try {
            const raw = localStorage.getItem(STORAGE_UI_GLOBAL);
            return raw ? JSON.parse(raw) : { collapsed: false, mode: 'per-page', left: null, top: null, width: null, height: null };
        } catch (e) {
            return { collapsed: false, mode: 'per-page', left: null, top: null, width: null, height: null };
        }
    }
    function saveGlobalUIState(obj) {
        try { localStorage.setItem(STORAGE_UI_GLOBAL, JSON.stringify(obj)); } catch (e) { }
    }

    /* Helpers to compute and persist layout */
    function ensureNumeric(v, fallback) {
        return (typeof v === 'number' && isFinite(v)) ? v : fallback;
    }

    function getSavedLayout(pageKey) {
        // layout priority: global saved position/size (if set), else per-page stored in per-page ui object if extended
        const g = loadGlobalUIState();
        const out = {
            left: ensureNumeric(g.left, null),
            top: ensureNumeric(g.top, null),
            width: ensureNumeric(g.width, null),
            height: ensureNumeric(g.height, null)
        };
        // If global has no position/size, check per-page state for legacy keys
        if (out.left === null || out.top === null) {
            const p = getUIStateFor(pageKey);
            if (p && (typeof p.left === 'number' || typeof p.top === 'number')) {
                out.left = ensureNumeric(p.left, out.left);
                out.top = ensureNumeric(p.top, out.top);
            }
        }
        if (out.width === null || out.height === null) {
            const p = getUIStateFor(pageKey);
            if (p && (typeof p.width === 'number' || typeof p.height === 'number')) {
                out.width = ensureNumeric(p.width, out.width);
                out.height = ensureNumeric(p.height, out.height);
            }
        }
        return out;
    }

    function saveLayout(pageKey, layout, persistToGlobal) {
        // layout: { left, top, width, height } - numbers or null
        if (persistToGlobal) {
            const g = loadGlobalUIState();
            g.left = ensureNumeric(layout.left, g.left);
            g.top = ensureNumeric(layout.top, g.top);
            g.width = ensureNumeric(layout.width, g.width);
            g.height = ensureNumeric(layout.height, g.height);
            saveGlobalUIState(g);
        } else {
            // save into global as well as per-page so state persists reliably across loads
            const g = loadGlobalUIState();
            g.left = ensureNumeric(layout.left, g.left);
            g.top = ensureNumeric(layout.top, g.top);
            g.width = ensureNumeric(layout.width, g.width);
            g.height = ensureNumeric(layout.height, g.height);
            saveGlobalUIState(g);

            const p = getUIStateFor(pageKey);
            p.left = ensureNumeric(layout.left, p.left);
            p.top = ensureNumeric(layout.top, p.top);
            p.width = ensureNumeric(layout.width, p.width);
            p.height = ensureNumeric(layout.height, p.height);
            setUIStateFor(pageKey, p);
        }
    }


    // compute and apply an initial/desired height for the flybox
    function computeDesiredFlyboxHeight(pageKey) {
        try {
            // prefer explicit saved layout height if available
            const saved = getSavedLayout(pageKey);
            if (saved && typeof saved.height === 'number' && saved.height > 0) {
                return Math.max(120, saved.height); // respect saved height but have a minimum
            }

            // base on number of saved logs
            const logs = loadPageLogs(pageKey) || [];
            const approxLinePx = 20; // approx height per log line
            const headerAndPadding = 90; // allowance for header, selector, padding, etc.
            const desired = Math.min( // clamp to viewport and max
                Math.max(120, logs.length * approxLinePx + headerAndPadding),
                Math.min(window.innerHeight - 80, 800) // never bigger than viewport minus margin; hard cap 800px
            );
            return desired;
        } catch (e) {
            return 200; // fallback
        }
    }

    function applyDesiredFlyboxHeight(box, pageKey) {
        try {
            if (!box) return;
            const g = loadGlobalUIState();
            // respect collapsed states (global or per-page)
            const isCollapsed = (g && g.mode === 'global') ? !!g.collapsed : !!getUIStateFor(pageKey).collapsed;
            if (isCollapsed) {
                // collapsed height (keep as-is)
                box.style.height = (getUIStateFor(pageKey).collapsed ? '20px' : box.style.height || 'auto');
                return;
            }

            // if global saved absolute width/height exists and user explicitly set, prefer it
            const saved = getSavedLayout(pageKey);
            if (saved && typeof saved.height === 'number' && saved.height > 0) {
                box.style.height = Math.max(120, saved.height) + 'px';
                box.style.maxHeight = 'none';
                return;
            }

            const h = computeDesiredFlyboxHeight(pageKey);
            box.style.height = h + 'px';
            // allow scroll inside but keep a sensible maxHeight to avoid covering the whole screen
            box.style.maxHeight = Math.min(window.innerHeight - 80, 800) + 'px';
        } catch (e) { /* ignore */ }
    }



    // ---------- Fly box UI with minimize/max, draggable, resizable, global/per-page mode ----------


    // ---------- Fly box UI with minimize/max, draggable, resizable, global/per-page mode ----------
    // ---------- Fly box UI with minimize/max, draggable, resizable, global/per-page mode ----------
    function createFlyBox() {
        const pageKey = getPageKey();
        let box = document.getElementById('wplogstool-flybox');
        if (box) return box; // don't recreate

        // base box
        box = document.createElement('div');
        box.id = 'wplogstool-flybox';
        Object.assign(box.style, {
            position: 'fixed',
            bottom: '10px',
            right: '10px',
            width: '420px',
            maxHeight: '360px',
            overflow: 'hidden',
            background: '#0f0f13',
            color: '#cfeee0',
            fontFamily: 'monospace',
            fontSize: '12px',
            padding: '6px',
            borderRadius: '8px',
            boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
            zIndex: 999999,
            display: 'flex',
            flexDirection: 'column',
            transition: 'box-shadow 0.12s ease, height 0.18s ease, width 0.18s ease'
        });

        // header (taller now)
        const header = document.createElement('div');
        header.id = 'wplogstool-flybox-header';
        Object.assign(header.style, {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '6px',
            marginBottom: '6px',
            cursor: 'move',
            userSelect: 'none',
            padding: '10px 12px',    // increased padding for taller header
            minHeight: '40px',       // explicit taller header
            background: '#111117',
            borderTopLeftRadius: '8px',
            borderTopRightRadius: '8px'
        });

        // title
        const title = document.createElement('div');
        title.textContent = 'WPLogsTool';
        title.style.fontWeight = '700';
        title.style.fontSize = '13px';
        title.style.lineHeight = '1';

        // header actions container (hidden when collapsed)
        const headerActions = document.createElement('div');
        headerActions.id = 'wplogstool-header-actions';
        Object.assign(headerActions.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginLeft: '8px'
        });

        // Mode toggle (Per-page / Global)
        const modeBtn = document.createElement('button');
        modeBtn.id = 'wplogstool-mode-btn';
        modeBtn.title = 'Toggle mode: per-page / global';
        modeBtn.style.padding = '2px 6px';
        headerActions.appendChild(modeBtn);

        // small action buttons (moved into headerActions)
        const btnClear = document.createElement('button');
        btnClear.id = 'wplogstool-clear-btn';
        btnClear.textContent = 'Clear';
        btnClear.style.padding = '4px';
        headerActions.appendChild(btnClear);

        const btnClearAll = document.createElement('button');
        btnClearAll.id = 'wplogstool-clearall-btn';
        btnClearAll.textContent = 'Clear All';
        btnClearAll.style.padding = '4px';
        headerActions.appendChild(btnClearAll);

        const btnExport = document.createElement('button');
        btnExport.id = 'wplogstool-export-btn';
        btnExport.textContent = 'Export';
        btnExport.style.padding = '4px';
        headerActions.appendChild(btnExport);

        // Copy All Logs button
        const btnCopy = document.createElement('button');
        btnCopy.id = 'wplogstool-copy-btn';
        btnCopy.textContent = 'Copy Logs';
        btnCopy.style.padding = '4px';
        headerActions.appendChild(btnCopy);

        // Toggle button (single arrow)
        const btnToggle = document.createElement('button');
        btnToggle.id = 'wplogstool-toggle-btn';
        btnToggle.title = 'Minimize / Maximize';
        btnToggle.setAttribute('aria-expanded', 'true');
        Object.assign(btnToggle.style, {
            background: 'transparent',
            color: '#cfeee0',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '0 6px',
            marginLeft: '8px',
            lineHeight: '1'
        });
        btnToggle.textContent = '▼'; // default expanded glyph

        // assemble header with inner wrapper so toggle sits at far right
        const headerInner = document.createElement('div');
        Object.assign(headerInner.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            width: '100%'
        });
        headerInner.appendChild(title);
        headerInner.appendChild(headerActions);
        header.appendChild(headerInner);
        header.appendChild(btnToggle);

        // append header early (selector/logArea/resizer created below)
        box.appendChild(header);

        // page selector
        const selector = document.createElement('select');
        selector.id = 'wplogstool-page-select';
        selector.title = 'Select page logs to view';
        selector.style.fontFamily = 'inherit';
        selector.style.fontSize = '12px';
        selector.style.padding = '4px';
        selector.style.marginBottom = '6px';
        selector.style.display = 'block';
        box.appendChild(selector);

        // log area
        const logArea = document.createElement('div');
        logArea.id = 'wplogstool-log-area';
        Object.assign(logArea.style, {
            overflowY: 'auto',
            background: '#050507',
            padding: '8px',
            borderRadius: '6px',
            flex: '1 1 auto',
        });
        box.appendChild(logArea);

        // resizer
        const resizer = document.createElement('div');
        resizer.id = 'wplogstool-resizer';
        Object.assign(resizer.style, {
            width: '12px',
            height: '12px',
            position: 'absolute',
            right: '6px',
            bottom: '6px',
            cursor: 'se-resize',
            zIndex: 1000000,
            background: 'transparent'
        });
        box.appendChild(resizer);

        // existing copy handler (unchanged)
        btnCopy.addEventListener('click', function () {
            const sel = document.getElementById('wplogstool-page-select');
            const pk = sel ? sel.value : getPageKey();
            let text = '';
            if (pk === '__all__') {
                text = exportAllText();
            } else {
                text = exportPageText(pk);
            }
            if (!text) {
                alert('No logs to copy');
                return;
            }

            try {
                navigator.clipboard.writeText(text)
                    .then(() => alert('Logs copied to clipboard!'))
                    .catch(err => {
                        console.warn('Clipboard copy failed', err);
                        alert('Failed to copy logs to clipboard.');
                    });
            } catch (e) {
                console.warn('Clipboard API not supported', e);
                alert('Clipboard API not supported in this browser.');
            }
        });

        // apply saved layout if present, else default bottom-right
        const savedLayout = (typeof getSavedLayout === 'function') ? getSavedLayout(pageKey) : { left: null, top: null, width: null, height: null };
        if (savedLayout && savedLayout.left !== null && savedLayout.top !== null) {
            box.style.left = savedLayout.left + 'px';
            box.style.top = savedLayout.top + 'px';
            box.style.right = 'auto';
            box.style.bottom = 'auto';
        } else {
            box.style.left = 'auto';
            box.style.top = 'auto';
            box.style.right = '10px';
            box.style.bottom = '10px';
        }
        if (savedLayout && savedLayout.width !== null) {
            box.style.width = Math.max(220, savedLayout.width) + 'px';
        }
        if (savedLayout && savedLayout.height !== null) {
            box.style.height = Math.max(120, savedLayout.height) + 'px';
            box.style.maxHeight = 'none';
        }

        // compute/adjust initial height dynamically (only if not explicitly saved)
        try {
            if (!savedLayout || savedLayout.height === null) {
                if (typeof applyDesiredFlyboxHeight === 'function') {
                    applyDesiredFlyboxHeight(box, pageKey);
                }
            } else {
                box.style.maxHeight = Math.min(window.innerHeight - 80, 800) + 'px';
            }
        } catch (e) { /* ignore */ }

        // --- collapse/expand behavior ---
        let collapsed = false;

        function setCollapsed(state, skipEmit) {
            collapsed = !!state;
            if (collapsed) {
                // hide extra UI
                headerActions.style.display = 'none';
                selector.style.display = 'none';
                logArea.style.display = 'none';
                resizer.style.display = 'none';

                // shrink height to header and width to fit title + toggle
                const headerHeight = header.offsetHeight || 40;
                box.style.height = headerHeight + 'px';
                box.style.maxHeight = headerHeight + 'px';

                // width: shrink-to-fit but keep a sensible minimum and max limit
                box.style.width = 'fit-content';
                box.style.minWidth = '120px';
                box.style.maxWidth = 'calc(100% - 20px)';

                // adjust padding for collapsed state
                box.style.padding = '2px 6px'; // top/bottom smaller, left/right normal

                btnToggle.textContent = '▲'; // up arrow when collapsed (click to expand)
                btnToggle.setAttribute('aria-expanded', 'false');
            } else {
                // show full UI
                headerActions.style.display = 'flex';
                selector.style.display = 'block';
                logArea.style.display = 'block';
                resizer.style.display = 'block';

                // restore width: prefer saved width, else use default
                const defaultWidth = 420;
                if (savedLayout && savedLayout.width !== null) {
                    box.style.width = Math.max(220, savedLayout.width) + 'px';
                } else {
                    box.style.width = defaultWidth + 'px'; // default expanded width
                }

                // restore height
                const savedH = (savedLayout && savedLayout.height !== null) ? savedLayout.height : null;
                if (savedH !== null) {
                    box.style.height = Math.max(120, savedH) + 'px';
                    box.style.maxHeight = Math.min(window.innerHeight - 80, 800) + 'px';
                } else {
                    box.style.height = '';
                    box.style.maxHeight = Math.min(window.innerHeight - 80, 800) + 'px';
                }

                // restore normal padding for expanded state
                box.style.padding = '6px';

                btnToggle.textContent = '▼'; // down arrow when expanded (click to collapse)
                btnToggle.setAttribute('aria-expanded', 'true');
            }

            if (!skipEmit) {
                try {
                    document.dispatchEvent(new CustomEvent('wplogstool:ui-state-change', {
                        detail: { pageKey: pageKey, collapsed: !!collapsed }
                    }));
                } catch (e) { /* ignore */ }
            }
        }

        // apply collapsed/expanded state *after* layout applied
        (function applyInitialCollapsedOnce() {
            const g = (typeof loadGlobalUIState === 'function') ? loadGlobalUIState() : null;
            if (g && g.mode === 'global') {
                if (typeof applyUIState === 'function') applyUIState(g, pageKey, true);
                setCollapsed(!!(g && g.collapsed), true);
            } else {
                const st = (typeof getUIStateFor === 'function') ? getUIStateFor(pageKey) : { collapsed: false };
                if (typeof applyUIState === 'function') applyUIState(st, pageKey, false);
                setCollapsed(!!(st && st.collapsed), true);
            }
        })();

        // click handlers: clear / clearAll / export (unchanged)
        btnClear.addEventListener('click', function () {
            const pk = selector.value || pageKey;
            if (!pk) return;
            const isAll = (pk === '__all__');
            const confirmMsg = isAll
                ? 'Clear ALL stored page logs? This cannot be undone.'
                : ('Clear logs for "' + pk + '"? This cannot be undone.');
            if (!confirm(confirmMsg)) return;

            if (isAll) {
                clearAll();
                try { console.clear(); } catch (e) { /* ignore */ }
                try { document.dispatchEvent(new CustomEvent('wplogstool:cleared', { detail: { pageKey: '__all__' } })); } catch (e) { }
                refreshPageSelector();
                renderLogs('__all__');
            } else {
                clearPage(pk);
                try { console.clear(); } catch (e) { /* ignore */ }
                try { document.dispatchEvent(new CustomEvent('wplogstool:cleared', { detail: { pageKey: pk } })); } catch (e) { }
                refreshPageSelector();
                renderLogs(pk);
            }
        });

        btnClearAll.addEventListener('click', function () {
            if (!confirm('Clear ALL stored page logs across all pages? This cannot be undone.')) return;
            clearAll();
            try { console.clear(); } catch (e) { /* ignore */ }
            try { document.dispatchEvent(new CustomEvent('wplogstool:cleared', { detail: { pageKey: '__all__' } })); } catch (e) { }
            refreshPageSelector();
            renderLogs('__all__');
        });

        window.addEventListener('keydown', function (ev) {
            if (ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === 'l') {
                ev.preventDefault();
                const pk = (document.getElementById('wplogstool-page-select') || {}).value || getPageKey();
                if (window.wpLogsTool && typeof wpLogsTool.clearLogsFor === 'function') {
                    wpLogsTool.clearLogsFor(pk);
                }
            }
        });

        btnExport.addEventListener('click', function () {
            const pk = selector.value || pageKey;
            let text = '';
            let filename = 'wplogstool_logs.txt';
            if (pk === '__all__') {
                text = exportAllText();
            } else {
                text = exportPageText(pk);
                filename = 'wplogstool_logs_' + encodeURIComponent(pk.replace(/[/?&=]/g, '_')) + '.txt';
            }
            const blob = new Blob([text || ''], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.documentElement.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        });

        // Min/Max logic (respects mode) - keep backward-compatible applyUIState
        function applyUIState(stateObj, pk, globalMode) {
            const stateCollapsed = !!(stateObj && stateObj.collapsed);
            if (stateCollapsed) {
                setCollapsed(true, true);
            } else {
                setCollapsed(false, true);
                if (stateObj && typeof stateObj.height === 'number') {
                    box.style.height = Math.max(120, stateObj.height) + 'px';
                    box.style.maxHeight = 'none';
                } else {
                    box.style.height = '';
                    box.style.maxHeight = '360px';
                }
            }
        }

        // Mode button text update
        function updateModeButtonText() {
            const g = (typeof loadGlobalUIState === 'function') ? loadGlobalUIState() : { mode: 'per-page' };
            modeBtn.textContent = (g.mode === 'global') ? 'Mode: Global' : 'Mode: Per-page';
        }

        // init selector and logs
        if (typeof refreshPageSelector === 'function') refreshPageSelector();
        if (typeof renderLogs === 'function') renderLogs(pageKey);

        // set initial mode button text
        updateModeButtonText();

        // Toggle handler: switch collapse state on current mode
        btnToggle.addEventListener('click', function (ev) {
            ev.stopPropagation();
            const g = (typeof loadGlobalUIState === 'function') ? loadGlobalUIState() : null;
            if (g && g.mode === 'global') {
                g.collapsed = !g.collapsed;
                if (typeof saveGlobalUIState === 'function') saveGlobalUIState(g);
                applyUIState(g, pageKey, true);
                setCollapsed(!!g.collapsed);
            } else {
                const pk = selector.value || pageKey;
                const pstate = (typeof getUIStateFor === 'function') ? getUIStateFor(pk) : { collapsed: false };
                pstate.collapsed = !pstate.collapsed;
                if (typeof setUIStateFor === 'function') setUIStateFor(pk, pstate);
                applyUIState(pstate, pageKey, false);
                setCollapsed(!!pstate.collapsed);
            }
        });

        // Mode toggle handler: swap between per-page and global
        modeBtn.addEventListener('click', function () {
            const g = (typeof loadGlobalUIState === 'function') ? loadGlobalUIState() : { mode: 'per-page' };
            g.mode = (g.mode === 'global') ? 'per-page' : 'global';
            if (typeof g.collapsed === 'undefined') g.collapsed = false;
            if (typeof saveGlobalUIState === 'function') saveGlobalUIState(g);
            updateModeButtonText();
            if (g.mode === 'global') {
                applyUIState(g, pageKey, true);
            } else {
                const p = (typeof getUIStateFor === 'function') ? getUIStateFor(pageKey) : { collapsed: false };
                applyUIState(p, pageKey, false);
            }
        });

        // When selector changes, render and apply per-page state (or global if that mode is set)
        selector.addEventListener('change', function () {
            const pk = selector.value;
            if (typeof refreshPageSelector === 'function') refreshPageSelector();
            if (typeof renderLogs === 'function') renderLogs(pk);
            const g = (typeof loadGlobalUIState === 'function') ? loadGlobalUIState() : null;
            if (g && g.mode === 'global') {
                applyUIState(g, pk, true);
            } else {
                const p = (typeof getUIStateFor === 'function') ? getUIStateFor(pk) : { collapsed: false };
                applyUIState(p, pk, false);
            }
        });

        // make header draggable (saves layout to global and per-page)
        (function makeDraggable() {
            let dragging = false;
            let startX = 0, startY = 0, startLeft = 0, startTop = 0;
            header.addEventListener('mousedown', function (ev) {
                if (ev.button !== 0) return;
                dragging = true;
                startX = ev.clientX;
                startY = ev.clientY;
                const rect = box.getBoundingClientRect();
                box.style.left = (rect.left) + 'px';
                box.style.top = (rect.top) + 'px';
                box.style.right = 'auto';
                box.style.bottom = 'auto';
                startLeft = rect.left;
                startTop = rect.top;
                document.body.style.userSelect = 'none';
                box.style.boxShadow = '0 10px 30px rgba(0,0,0,0.7)';
                ev.preventDefault();
            });

            window.addEventListener('mousemove', function (ev) {
                if (!dragging) return;
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                const newLeft = Math.max(6, Math.min(window.innerWidth - 80, startLeft + dx));
                const newTop = Math.max(6, Math.min(window.innerHeight - 40, startTop + dy));
                box.style.left = newLeft + 'px';
                box.style.top = newTop + 'px';
                box.style.right = 'auto';
                box.style.bottom = 'auto';
            });

            window.addEventListener('mouseup', function () {
                if (!dragging) return;
                dragging = false;
                document.body.style.userSelect = '';
                box.style.boxShadow = '0 6px 24px rgba(0,0,0,0.6)';
                // persist layout (save to global and per-page)
                const left = box.style.left ? parseInt(box.style.left, 10) : null;
                const top = box.style.top ? parseInt(box.style.top, 10) : null;
                const width = box.offsetWidth;
                const height = box.offsetHeight;
                if (typeof saveLayout === 'function') saveLayout(pageKey, { left: left, top: top, width: width, height: height }, false);
            });
        })();

        // resizer logic
        (function makeResizable() {
            let resizing = false;
            let startX = 0, startY = 0, startW = 0, startH = 0;
            resizer.addEventListener('mousedown', function (ev) {
                if (ev.button !== 0) return;
                resizing = true;
                startX = ev.clientX;
                startY = ev.clientY;
                startW = box.offsetWidth;
                startH = box.offsetHeight;
                document.body.style.userSelect = 'none';
                ev.preventDefault();
            });
            window.addEventListener('mousemove', function (ev) {
                if (!resizing) return;
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                const newW = Math.max(220, startW + dx);
                const newH = Math.max(100, startH + dy);
                box.style.width = newW + 'px';
                box.style.height = newH + 'px';
                box.style.maxHeight = 'none';
            });
            window.addEventListener('mouseup', function () {
                if (!resizing) return;
                resizing = false;
                document.body.style.userSelect = '';
                // save layout
                const left = box.style.left ? parseInt(box.style.left, 10) : null;
                const top = box.style.top ? parseInt(box.style.top, 10) : null;
                const width = box.offsetWidth;
                const height = box.offsetHeight;
                if (typeof saveLayout === 'function') saveLayout(pageKey, { left: left, top: top, width: width, height: height }, false);
            });
        })();

        // finally append box to DOM
        document.body.appendChild(box);

        // ensure mode button text is accurate
        updateModeButtonText();

        // return node
        return box;
    }


    function refreshPageSelector() {
        // get selector element — **do not** create the flybox here (avoids recursion)
        let sel = document.getElementById('wplogstool-page-select');
        if (!sel) {
            // selector not present yet; caller should create the flybox first.
            return;
        }

        // clear options
        sel.innerHTML = '';

        // add current page first
        const currentKey = getPageKey();
        const optCurrent = document.createElement('option');
        optCurrent.value = currentKey;
        optCurrent.textContent = '(This page) ' + currentKey;
        sel.appendChild(optCurrent);

        // option all
        const optAll = document.createElement('option');
        optAll.value = '__all__';
        optAll.textContent = 'All pages';
        sel.appendChild(optAll);

        // other pages
        const pages = loadAllPages();
        pages.forEach(p => {
            if (p === currentKey) return;
            const o = document.createElement('option');
            o.value = p;
            o.textContent = p;
            sel.appendChild(o);
        });

        // default select current page (or keep existing if it still exists)
        if (!Array.prototype.slice.call(sel.options).some(o => o.value === sel.value)) {
            sel.value = currentKey;
        }
    }


    // ---------- safe renderLogs (no recursive createFlyBox()) ----------
    function renderLogs(pageKey) {
        // ensure final CSS exists (same rule used by addLogToFlyBox)
        if (!document.getElementById('wplogstool-styles')) {
            const s = document.createElement('style');
            s.id = 'wplogstool-styles';
            s.textContent = `
            /* final (stop) log style — easily change color here */
            .wplogstool-log-final {
                color: orange !important;
                font-weight: 700;
            }
        `;
            document.head.appendChild(s);
        }

        // don't create the flybox here to avoid recursion; caller must ensure it exists
        const area = document.getElementById('wplogstool-log-area');
        if (!area) return;

        area.innerHTML = '';
        if (!pageKey) pageKey = getPageKey();

        // helper to detect final/stop logs (same logic as addLogToFlyBox)
        function isFinalLog(l) {
            const txt = (l && l.text) ? String(l.text).trim().toLowerCase() : '';
            const isFinalByTag = l && l._tag && String(l._tag).toLowerCase() === 'stop';
            return isFinalByTag;
        }

        if (pageKey === '__all__') {
            const pages = loadAllPages();
            if (!pages || pages.length === 0) {
                area.textContent = '(no logs)';
                return;
            }
            pages.forEach(p => {
                const header = document.createElement('div');
                header.textContent = '--- PAGE: ' + p + ' ---';
                header.style.color = 'lightgray';
                header.style.fontWeight = '700';
                header.style.marginTop = '6px';
                area.appendChild(header);

                const logs = loadPageLogs(p) || [];
                logs.forEach(l => {
                    const line = document.createElement('div');
                    line.style.whiteSpace = 'pre-wrap';

                    const dtPart = l && l.datetime ? ('[' + l.datetime + '] ') : '';
                    const display = (l && (!l.text || l.text === '')) ?
                        (dtPart + '[' + (l.time || ''))+ '] ' :
                        (dtPart + '[' + (l.time || '') + '] ' + (l.text || ''));

                    // Always set the text
                    line.textContent = display;

                    // Decide if this is a final/stop log
                    if (isFinalLog(l)) {
                        line.classList.add('wplogstool-log-final');
                        line.dataset.logTag = 'stop';
                    } else {
                        try {
                            const c = typeof getLogColor === 'function' ? getLogColor(l, true) : null;
                            if (c) line.style.color = c;
                        } catch (e) { /* ignore */ }
                    }

                    area.appendChild(line);
                });
            });
            area.scrollTop = area.scrollHeight;
            return;
        }

        // single page
        const logs = loadPageLogs(pageKey) || [];
        if (!logs || logs.length === 0) {
            area.textContent = '(no logs)';
            return;
        }

        logs.forEach(l => {
            const line = document.createElement('div');
            line.style.whiteSpace = 'pre-wrap';

            const dtPart = l && l.datetime ? ('[' + l.datetime + '] ') : '';
            const display = (l && (!l.text || l.text === '')) ?
                (dtPart + '[' + (l.time || '') + '] ') :
                (dtPart + '[' + (l.time || '') + '] ' + (l.text || ''));

            line.textContent = display;

            // l is an old/saved log when rendering from storage
            if (isFinalLog(l)) {
                line.classList.add('wplogstool-log-final');
                line.dataset.logTag = 'stop';
            } else {
                try {
                    const c = typeof getLogColor === 'function' ? getLogColor(l, true) : null;
                    if (c) line.style.color = c;
                } catch (e) { /* ignore */ }
            }

            area.appendChild(line);
        });

        area.scrollTop = area.scrollHeight;
    }


    // ---------- safe addLogToFlyBox (creates flybox only if safe) ----------

    function addLogToFlyBox(entry, isOld, pageKeyOfLog) {
        try {
            // ensure flybox exists
            if (!document.getElementById('wplogstool-flybox')) {
                try { createFlyBox(); } catch (e) { return; }
            }

            entry = entry || { time: '', text: '' };
            pageKeyOfLog = pageKeyOfLog || getPageKey();

            // normalize keys
            function normalizeKey(k) {
                if (!k) return '';
                try {
                    k = String(k).trim();
                    try { k = decodeURIComponent(k); } catch (e) { }
                    if (k.length > 1 && k.endsWith('/')) k = k.slice(0, -1);
                    return k;
                } catch (e) {
                    return String(k || '');
                }
            }

            // ensure CSS for final log exists (only once)
            if (!document.getElementById('wplogstool-styles')) {
                const s = document.createElement('style');
                s.id = 'wplogstool-styles';
                s.textContent = `
                /* final (stop) log style — easily change color here */
                .wplogstool-log-final {
                    color: orange !important;
                    font-weight: 700;
                }
            `;
                document.head.appendChild(s);
            }

            const selEl = document.getElementById('wplogstool-page-select');
            const selValue = selEl && selEl.value ? String(selEl.value) : null;
            const normalizedSel = normalizeKey(selValue);
            const normalizedLogKey = normalizeKey(pageKeyOfLog);
            const normalizedCurrent = normalizeKey(getPageKey());

            // decide whether to append
            const shouldAppend =
                !selEl ||
                selValue === '__all__' ||
                (normalizedSel && normalizedSel === normalizedLogKey) ||
                (normalizedSel === normalizedCurrent && normalizedLogKey === normalizedCurrent);

            if (!shouldAppend) return;

            // ensure log area exists
            let area = document.getElementById('wplogstool-log-area');
            if (!area) {
                const box = document.getElementById('wplogstool-flybox');
                if (!box) return;
                area = document.createElement('div');
                area.id = 'wplogstool-log-area';
                Object.assign(area.style, {
                    overflowY: 'auto',
                    background: '#050507',
                    padding: '8px',
                    borderRadius: '6px',
                    flex: '1 1 auto'
                });
                box.appendChild(area);
            }

            // build line
            const dtPart = entry && entry.datetime ? ('[' + entry.datetime + '] ') : '';
            let displayText;
            if (!entry.text || entry.text === '') {
                displayText = dtPart + '[' + (entry.time || '') + '] ....'; // <<< Option A suffix
            } else {
                displayText = dtPart + '[' + (entry.time || '') + '] ' + (entry.text || '');
            }

            const line = document.createElement('div');
            line.textContent = displayText;
            line.style.whiteSpace = 'pre-wrap';

            // Decide if this is a final/stop log (match tag or text case-insensitively)
            const txt = (entry.text || '').trim().toLowerCase();
            const isFinalByTag = entry && entry._tag && String(entry._tag).toLowerCase() === 'stop';
            const isFinal = isFinalByTag;

            if (isFinal) {
                // use CSS class for final logs so it's easy to restyle globally
                line.classList.add('wplogstool-log-final');
                // also add a data attribute in case you want JS hooks
                line.dataset.logTag = 'stop';
            } else {
                // fallback to existing color logic
                try {
                    const c = getLogColor ? getLogColor(entry, isOld) : null;
                    if (c) line.style.color = c;
                } catch (e) {
                    // ignore and leave default color
                }
            }

            area.appendChild(line);
            area.scrollTop = area.scrollHeight;

            // gently expand flybox if needed (but do not override explicit saved layout)
            try {
                const box = document.getElementById('wplogstool-flybox');
                if (box) {
                    // compute desired height but only apply if it increases current height
                    const desired = computeDesiredFlyboxHeight(pageKeyOfLog);
                    const cur = parseInt(box.style.height, 10) || box.offsetHeight || 0;
                    if (desired > cur && (!getSavedLayout(pageKeyOfLog) || getSavedLayout(pageKeyOfLog).height === null)) {
                        // animate a smoother change
                        box.style.transition = 'height 0.18s ease';
                        box.style.height = Math.min(desired, Math.min(window.innerHeight - 80, 800)) + 'px';
                    }
                }
            } catch (e) { /* ignore */ }

        } catch (err) {
            console.warn('wpLogsTool.addLogToFlyBox error', err);
        }
    }



    // ---------- WPLogsTool class (per-page) ----------
    class WPLogsTool {
        constructor() {
            this.startTime = null;
            this.elapsed = 0;
            this.running = false;
            this.pageKey = getPageKey();
            this.logs = loadPageLogs(this.pageKey); // restore logs for this page
            this.timerId = null;

            // register page in index
            addPageToIndex(this.pageKey);

            // create fly box UI and populate selector
            try {
                createFlyBox();
                refreshPageSelector();
                renderLogs(this.pageKey);
            } catch (e) { }

            // saved logs are rendered by renderLogs() above; no need to replay here.
            // (previous replay code removed to avoid duplicate UI/console entries)

            // replay saved logs to console and flybox (old ones in blue)
            // try {
            //     this.logs.forEach(l => {
            //         try {
            //             const isTick = (!l.text || l.text === '');
            //             const label = isTick ? '[TIMER] ' : '';
            //             const display = isTick
            //                 ? (label + '[' + (l.time || '') + '] ....')   // tick with suffix
            //                 : ('[' + (l.time || '') + '] ' + (l.text || ''));
            //             console.log('%c' + display, 'color: blue;');
            //         } catch (e) { }
            //         addLogToFlyBox(l, true, this.pageKey);
            //     });
            // } catch (e) { /* ignore */ }
        }

        start() {
            if (this.running) return;
            this.startTime = Date.now();
            this.running = true;

            // create and dispatch initial tick (UI update happens via event handler)
            this._saveTick();

            // start repeating console ticker and save each tick
            this.timerId = setInterval(() => {
                try {
                    const entry = this._saveTick(); // this dispatches the event
                } catch (e) { }
            }, 1000 * 30);
        }


        stop() {
            if (!this.running) return;

            // update elapsed and stop running
            this.elapsed += Date.now() - this.startTime;
            this.running = false;
            this.startTime = null;

            // clear repeating timer
            if (this.timerId) {
                clearInterval(this.timerId);
                this.timerId = null;
            }

            // log final runtime with text
            const entry = this.log('[FINISHED]', { dispatch: false, tag: 'stop' });
            addLogToFlyBox(entry, false, this.pageKey);
        }


        reset() {
            this.elapsed = 0;
            this.startTime = this.running ? Date.now() : null;
            this.log('reset');
        }

        getTimeMs() {
            let total = this.elapsed || 0;
            if (this.running && this.startTime) total += Date.now() - this.startTime;
            return total;
        }

        getTime() {
            return msToHMS(this.getTimeMs());
        }


        // internal: create a tick log (no text, just time) and persist
        // now accepts options: { dispatch: true|false, tag: 'tick'|'stop' }
        _saveTick(options = {}) {
            const { dispatch = true, tag = 'tick' } = options;
            try {
                const nowTs = Date.now();
                const entry = {
                    ts: nowTs,
                    datetime: formatDateTime(nowTs),
                    time: this.getTime(), // elapsed HH:MM:SS
                    text: '',
                    _fromTC: true,
                    _tag: tag // optional marker so UI can show "stopped" differently
                };
                this.logs.push(entry);
                savePageLogs(this.pageKey, this.logs);

                // optionally dispatch event — UI will be updated by the single global listener
                if (dispatch) {
                    try {
                        var ev = new CustomEvent('wplogstool:log', { detail: { entry: entry, pageKey: this.pageKey } });
                        document.dispatchEvent(ev);
                    } catch (e) { /* ignore */ }
                }

                return entry;
            } catch (e) {
                try { console.log('[wpLogsTool._saveTick error]', e); } catch (er) { }
                return null;
            }
        }


        // public manual log
        log(text, options = {}) {
            try {
                const nowTs = Date.now();
                const entry = {
                    ts: nowTs,
                    datetime: formatDateTime(nowTs),
                    time: this.getTime(),
                    text: (typeof text === 'undefined' || text === null) ? '' : String(text),
                    _fromTC: true
                };
                this.logs.push(entry);
                savePageLogs(this.pageKey, this.logs);

                // dispatch event — DO NOT call addLogToFlyBox() here to avoid duplication
                try {
                    if (!options || options.dispatch !== false) {
                        var ev = new CustomEvent('wplogstool:log', { detail: { entry: entry, pageKey: this.pageKey } });
                        document.dispatchEvent(ev);
                    }
                } catch (e) { }

                return entry;
            } catch (e) {
                try { console.log('[wpLogsTool.log error]', e); } catch (er) { }
            }
        }



        getLogs() {
            // return a copy of current page logs
            return this.logs.slice();
        }

        // get logs for any page
        getLogsFor(pageKey) {
            return loadPageLogs(pageKey);
        }

        clearLogs() {
            this.logs = [];
            savePageLogs(this.pageKey, this.logs);
            // update UI
            refreshPageSelector();
            renderLogs(this.pageKey);
        }

        clearLogsFor(pageKey) {
            clearPage(pageKey);
            refreshPageSelector();
            if (pageKey === this.pageKey) {
                this.logs = [];
                renderLogs(this.pageKey);
            }
        }

        exportText() {
            return this.logs.map(l => {
                const dt = l && l.datetime ? ('[' + l.datetime + '] ') : '';
                const tm = '[' + (l && l.time ? l.time : '') + '] ';
                const txt = l && l.text ? l.text : '';
                return dt + tm + txt;
            }).join('\n');
        }

        exportCSV() {
            var rows = ['datetime,time,text,timestamp'];
            for (var i = 0; i < this.logs.length; i++) {
                var l = this.logs[i];
                var safe = String(l.text).replace(/"/g, '""');
                var dt = l.datetime ? l.datetime : '';
                rows.push('"' + dt + '",' + l.time + ',"' + safe + '",' + l.ts);
            }
            return rows.join('\n');
        }


        download(filename, mime) {
            var content = (mime && mime.indexOf('csv') !== -1) ? this.exportCSV() : this.exportText();
            var blob = new Blob([content], { type: mime || 'text/plain' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = filename || 'wplogstool_logs.txt';
            document.documentElement.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        }
    }

    // ---------- instantiate ----------
    var instance = new WPLogsTool();
    Object.defineProperty(window, 'wpLogsTool', {
        configurable: true,
        enumerable: true,
        value: instance,
        writable: false
    });

    // convenience shims (same as before, plus page-level functions)
    window.wpLogsToolLog = function (t) { return instance.log(t); };
    window.wpLogsToolStart = function () { return instance.start(); };
    window.wpLogsToolStop = function () { return instance.stop(); };
    window.wpLogsToolReset = function () { return instance.reset(); };
    window.wpLogsToolGetLogs = function () { return instance.getLogs(); };
    window.wpLogsToolClear = function () { return instance.clearLogs(); };
    window.wpLogsToolExportText = function () { return instance.exportText(); };
    window.wpLogsToolExportCSV = function () { return instance.exportCSV(); };
    window.wpLogsToolDownload = function (fn, mime) { return instance.download(fn, mime); };

    // additional helpers for multi-page control
    window.wpLogsToolGetPages = function () { return loadAllPages(); };
    window.wpLogsToolGetLogsFor = function (p) { return instance.getLogsFor(p); };
    window.wpLogsToolClearFor = function (p) { return instance.clearLogsFor(p); };
    window.wpLogsToolClearAll = function () { clearAll(); refreshPageSelector(); renderLogs('__all__'); };
    window.wpLogsToolExportAllText = function () { return exportAllText(); };

    window.wpLogsToolHelper = function (action, t, m) {
        switch (action) {
            case 'log':
                return instance.log(t);
            case 'start':
                return instance.start();
            case 'stop':
                return instance.stop();
            case 'reset':
                return instance.reset();
            case 'get':
                return instance.getLogs();
            case 'clear':
                return instance.clearLogs();
            default:
        }
    };

    try { console.info('wpLogsTool injected (window.wpLogsTool) on admin — per-page storage enabled'); } catch (e) { }

})(window, document);
