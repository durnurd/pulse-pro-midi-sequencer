// song-storage.js - Songs library (folders, sort, multi-select) backed by OPFS + library.json

(function() {
    const BASE_TITLE = 'PulsePro MIDI Sequencer';
    const RECENT_SONGS_STORAGE_KEY = 'pulsepro-recent-library-songs';
    const RECENT_SONGS_MAX = 10;

    let currentLibraryId = null;
    let titleDisplayName = null;

    let libraryNavFolderId = null;
    let librarySortValue = 'name_asc';
    let librarySelection = new Set();
    let libraryAnchorId = null;
    let marqueeActive = false;
    let marqueeEl = null;
    let marqueeStart = null;
    let marqueeContainer = null;

    let pulseDir = null;
    let midiDir = null;

    function readRecentSongsFromStorage() {
        try {
            const raw = localStorage.getItem(RECENT_SONGS_STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(function(x) {
                return x && typeof x.id === 'string' && typeof x.name === 'string';
            });
        } catch (e) {
            return [];
        }
    }

    function writeRecentSongsToStorage(entries) {
        try {
            localStorage.setItem(RECENT_SONGS_STORAGE_KEY, JSON.stringify(entries));
        } catch (e) {
            console.warn('writeRecentSongsToStorage', e);
        }
    }

    /** Remember a library song for File ▸ Open recent (most recent first, capped). */
    function recordRecentLibrarySong(id, name) {
        if (!id || typeof id !== 'string') return;
        const label = (name || '').trim() || 'Untitled';
        let list = readRecentSongsFromStorage();
        list = list.filter(function(x) { return x.id !== id; });
        list.unshift({ id: id, name: label });
        if (list.length > RECENT_SONGS_MAX) list = list.slice(0, RECENT_SONGS_MAX);
        writeRecentSongsToStorage(list);
    }

    function syncRecentSongDisplayName(id, newName) {
        const label = (newName || '').trim() || 'Untitled';
        const list = readRecentSongsFromStorage();
        let changed = false;
        for (let i = 0; i < list.length; i++) {
            if (list[i].id === id) {
                list[i].name = label;
                changed = true;
            }
        }
        if (changed) writeRecentSongsToStorage(list);
    }

    function removeRecentSongsByIds(idSet) {
        const list = readRecentSongsFromStorage().filter(function(x) { return !idSet.has(x.id); });
        writeRecentSongsToStorage(list);
    }

    async function ensureOpfs() {
        if (pulseDir) return;
        if (!navigator.storage || typeof navigator.storage.getDirectory !== 'function') {
            throw new Error('This browser does not support the Origin Private File System (OPFS). Try a current Chrome, Edge, or Firefox.');
        }
        const root = await navigator.storage.getDirectory();
        pulseDir = await root.getDirectoryHandle('pulsepro', { create: true });
        midiDir = await pulseDir.getDirectoryHandle('midi', { create: true });
    }

    function midiFileNameForId(id) {
        return String(id).replace(/[^a-zA-Z0-9._-]+/g, '_') + '.mid';
    }

    async function readLibraryFileRaw() {
        await ensureOpfs();
        try {
            const fh = await pulseDir.getFileHandle('library.json', { create: false });
            const file = await fh.getFile();
            const t = await file.text();
            return JSON.parse(t);
        } catch (e) {
            return { items: [], ui: {} };
        }
    }

    function applyUiFromData(data) {
        const ui = (data && data.ui) || {};
        if (ui.sort) librarySortValue = ui.sort;
        if (ui.navFolderId !== undefined) libraryNavFolderId = ui.navFolderId || null;
    }

    /** Load items only; does not overwrite in-memory UI globals (sort, nav folder). */
    async function loadItemsPreserveUi() {
        const data = await readLibraryFileRaw();
        const arr = data.items;
        if (!Array.isArray(arr)) return [];
        return arr.map(normalizeItem);
    }

    /** Load items and apply saved UI from disk (e.g. when opening the library). */
    async function loadItemsAndUiFromDisk() {
        const data = await readLibraryFileRaw();
        applyUiFromData(data);
        const arr = data.items;
        if (!Array.isArray(arr)) return [];
        return arr.map(normalizeItem);
    }

    async function writeLibraryPayload(items) {
        await ensureOpfs();
        const payload = {
            version: 1,
            items: items,
            ui: { sort: librarySortValue, navFolderId: libraryNavFolderId },
        };
        const fh = await pulseDir.getFileHandle('library.json', { create: true });
        const w = await fh.createWritable();
        await w.write(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
        await w.close();
    }

    async function writeMidiBytes(id, u8) {
        await ensureOpfs();
        const name = midiFileNameForId(id);
        const fh = await midiDir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(u8 instanceof Uint8Array ? u8 : new Uint8Array(u8));
        await w.close();
    }

    async function readMidiBytes(id) {
        await ensureOpfs();
        try {
            const fh = await midiDir.getFileHandle(midiFileNameForId(id), { create: false });
            const file = await fh.getFile();
            return await file.arrayBuffer();
        } catch (e) {
            return null;
        }
    }

    async function deleteMidiFile(id) {
        await ensureOpfs();
        try {
            await midiDir.removeEntry(midiFileNameForId(id));
        } catch (e) { /* missing */ }
    }

    function normalizeItem(raw) {
        const o = Object.assign({}, raw);
        if (!o.kind) o.kind = 'file';
        if (o.parentId === undefined || o.parentId === '') o.parentId = null;
        if (!o.updatedAt) o.updatedAt = Date.now();
        return o;
    }

    function newSongId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return 'song_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    }

    function newFolderId() {
        return 'fld_' + newSongId();
    }

    function readFileAsArrayBuffer(file) {
        return new Promise(function(resolve, reject) {
            const reader = new FileReader();
            reader.onload = function() { resolve(reader.result); };
            reader.onerror = function() { reject(reader.error || new Error('File read failed')); };
            reader.readAsArrayBuffer(file);
        });
    }

    function computeSongMetaFromArrayBuffer(buf) {
        try {
            const r = importMidi(buf);
            let endTick = 0;
            for (let i = 0; i < r.notes.length; i++) {
                const n = r.notes[i];
                const e = n.startTick + n.durationTicks;
                if (e > endTick) endTick = e;
            }
            const pbs = r.pitchBends || [];
            for (let i = 0; i < pbs.length; i++) {
                if (pbs[i].tick > endTick) endTick = pbs[i].tick;
            }
            const ccs = r.controllerChanges || [];
            for (let i = 0; i < ccs.length; i++) {
                if (ccs[i].tick > endTick) endTick = ccs[i].tick;
            }
            const bpm = r.bpm || 120;
            const durationSec = endTick > 0 ? (endTick / MIDI_TPQN) * (60 / bpm) : 0;
            return { durationSec: durationSec, bpm: bpm };
        } catch (e) {
            return { durationSec: 0, bpm: 120 };
        }
    }

    async function enrichFileMetadata(items) {
        let changed = false;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind !== 'file') continue;
            if (item.sizeBytes != null && item.durationSec != null) continue;
            const buf = await readMidiBytes(item.id);
            if (!buf) continue;
            try {
                item.sizeBytes = buf.byteLength;
                const meta = computeSongMetaFromArrayBuffer(buf);
                item.durationSec = meta.durationSec;
                changed = true;
            } catch (e) { /* skip */ }
        }
        if (changed) await writeLibraryPayload(items);
    }

    function findItem(items, id) {
        for (let i = 0; i < items.length; i++) {
            if (items[i].id === id) return items[i];
        }
        return null;
    }

    function getFolderChain(items, folderId) {
        const chain = [];
        let cur = folderId;
        const seen = new Set();
        while (cur && !seen.has(cur)) {
            seen.add(cur);
            const f = findItem(items, cur);
            if (!f || f.kind !== 'folder') break;
            chain.unshift(f);
            cur = f.parentId;
        }
        return chain;
    }

    /** Full path for display (matches song library: Library / folders… / file name). */
    function getLibrarySongPathLabel(items, fileItem) {
        if (!fileItem || fileItem.kind !== 'file') {
            return (fileItem && fileItem.name) ? fileItem.name : '';
        }
        const chain = getFolderChain(items, fileItem.parentId);
        const segments = ['Library'];
        for (let i = 0; i < chain.length; i++) {
            segments.push(chain[i].name);
        }
        segments.push(fileItem.name);
        return segments.join(' / ');
    }

    function isDescendantOf(items, itemId, ancestorId) {
        if (!ancestorId || !itemId) return false;
        let cur = findItem(items, itemId);
        const seen = new Set();
        while (cur && cur.parentId && !seen.has(cur.id)) {
            seen.add(cur.id);
            if (cur.parentId === ancestorId) return true;
            cur = findItem(items, cur.parentId);
        }
        return false;
    }

    function collectDescendantIds(items, folderId) {
        const out = [];
        const stack = [folderId];
        while (stack.length) {
            const id = stack.pop();
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                if (it.parentId === id) {
                    out.push(it.id);
                    if (it.kind === 'folder') stack.push(it.id);
                }
            }
        }
        return out;
    }

    function canMoveSelectionTo(items, selectedIds, targetParentId) {
        if (targetParentId === null) return true;
        for (const sid of selectedIds) {
            const it = findItem(items, sid);
            if (it && it.kind === 'folder') {
                if (sid === targetParentId) return false;
                if (isDescendantOf(items, targetParentId, sid)) return false;
            }
        }
        return true;
    }

    function sortChildren(items, list) {
        const folders = list.filter(function(x) { return x.kind === 'folder'; });
        const files = list.filter(function(x) { return x.kind === 'file'; });
        const cmpName = function(a, b) {
            const an = (a.name || '').toLowerCase();
            const bn = (b.name || '').toLowerCase();
            if (an < bn) return -1;
            if (an > bn) return 1;
            return 0;
        };
        const cmpDate = function(a, b) { return (a.updatedAt || 0) - (b.updatedAt || 0); };
        const cmpSize = function(a, b) { return (a.sizeBytes || 0) - (b.sizeBytes || 0); };
        const cmpLen = function(a, b) { return (a.durationSec || 0) - (b.durationSec || 0); };

        function sortGroup(arr, key, desc) {
            arr.sort(function(a, b) {
                let c = 0;
                if (key === 'name') c = cmpName(a, b);
                else if (key === 'date') c = cmpDate(a, b);
                else if (key === 'size') c = cmpSize(a, b);
                else if (key === 'length') c = cmpLen(a, b);
                return desc ? -c : c;
            });
        }

        const parts = librarySortValue.split('_');
        const key = parts[0] === 'name' ? 'name' : parts[0] === 'date' ? 'date' : parts[0] === 'size' ? 'size' : 'length';
        const desc = parts[1] === 'desc';
        sortGroup(folders, key, desc);
        sortGroup(files, key, desc);
        return folders.concat(files);
    }

    function getChildrenInFolder(items, parentId) {
        return items.filter(function(x) {
            const p = x.parentId || null;
            const want = parentId || null;
            return p === want;
        });
    }

    function formatBytes(n) {
        if (n == null || n === 0) return '—';
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1048576).toFixed(1) + ' MB';
    }

    function formatDuration(sec) {
        if (sec == null || sec <= 0) return '—';
        const s = Math.round(sec * 10) / 10;
        if (s < 60) return s + ' s';
        const m = Math.floor(s / 60);
        const r = Math.round(s - m * 60);
        return m + ':' + (r < 10 ? '0' : '') + r;
    }

    function clearLibrarySelection() {
        librarySelection.clear();
        libraryAnchorId = null;
    }

    function updateToolbarState() {
        const btnUp = document.getElementById('song-library-up');
        if (btnUp) btnUp.disabled = !libraryNavFolderId;
        const btnDel = document.getElementById('song-library-delete-selected');
        const btnMove = document.getElementById('song-library-move');
        const n = librarySelection.size;
        if (btnDel) btnDel.disabled = n === 0;
        if (btnMove) btnMove.disabled = n === 0;
    }

    function updateBreadcrumb(items) {
        const el = document.getElementById('song-library-breadcrumb');
        if (!el) return;
        el.innerHTML = '';
        const root = document.createElement('span');
        root.className = 'song-library-crumb';
        root.textContent = 'Library';
        root.title = 'Go to root';
        root.addEventListener('click', function() {
            libraryNavFolderId = null;
            clearLibrarySelection();
            void persistUiOnly();
            void refreshLibraryList();
        });
        el.appendChild(root);
        const chain = getFolderChain(items, libraryNavFolderId);
        for (let i = 0; i < chain.length; i++) {
            const sep = document.createElement('span');
            sep.className = 'song-library-crumb-sep';
            sep.textContent = ' / ';
            el.appendChild(sep);
            const c = chain[i];
            const sp = document.createElement('span');
            sp.className = 'song-library-crumb' + (i === chain.length - 1 ? ' song-library-crumb-active' : '');
            sp.textContent = c.name;
            if (i < chain.length - 1) {
                sp.title = 'Open folder';
                (function(fid) {
                    sp.addEventListener('click', function() {
                        libraryNavFolderId = fid;
                        clearLibrarySelection();
                        void persistUiOnly();
                        void refreshLibraryList();
                    });
                })(c.id);
            }
            el.appendChild(sp);
        }
    }

    async function persistUiOnly() {
        try {
            const items = await loadItemsPreserveUi();
            await writeLibraryPayload(items);
        } catch (e) {
            console.warn('persistUiOnly', e);
        }
    }

    async function deleteLibraryItems(ids) {
        const items = await loadItemsPreserveUi();
        const toDelete = new Set(ids);
        for (let i = 0; i < ids.length; i++) {
            const it = findItem(items, ids[i]);
            if (it && it.kind === 'folder') {
                const desc = collectDescendantIds(items, ids[i]);
                for (let j = 0; j < desc.length; j++) toDelete.add(desc[j]);
            }
        }
        if (toDelete.has(libraryNavFolderId)) {
            const cur = findItem(items, libraryNavFolderId);
            libraryNavFolderId = cur && cur.parentId ? cur.parentId : null;
        }
        const next = [];
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (toDelete.has(it.id)) {
                if (it.kind === 'file') await deleteMidiFile(it.id);
            } else {
                next.push(it);
            }
        }
        await writeLibraryPayload(next);
        removeRecentSongsByIds(toDelete);
        if (currentLibraryId && toDelete.has(currentLibraryId)) clearLibrarySongContext(null);
        librarySelection = new Set(Array.from(librarySelection).filter(function(id) { return !toDelete.has(id); }));
        if (libraryAnchorId && toDelete.has(libraryAnchorId)) libraryAnchorId = null;
    }

    async function moveItemsToParent(ids, newParentId) {
        const items = await loadItemsPreserveUi();
        if (!canMoveSelectionTo(items, ids, newParentId)) {
            alert('Cannot move a folder into itself or one of its subfolders.');
            return false;
        }
        const idSet = new Set(ids);
        for (let i = 0; i < items.length; i++) {
            if (idSet.has(items[i].id)) {
                items[i].parentId = newParentId;
                items[i].updatedAt = Date.now();
            }
        }
        await writeLibraryPayload(items);
        return true;
    }

    async function addMidiFilesToLibrary(files) {
        try {
            await ensureOpfs();
        } catch (e) {
            alert(e.message || String(e));
            return;
        }
        let items = await loadItemsPreserveUi();
        const inFolder = getChildrenInFolder(items, libraryNavFolderId);
        const namesInUse = new Set(inFolder.map(function(x) { return x.name; }));
        function allocateName(base) {
            let n = (base || 'Untitled').trim() || 'Untitled';
            if (!namesInUse.has(n)) {
                namesInUse.add(n);
                return n;
            }
            let i = 2;
            while (namesInUse.has(n + ' (' + i + ')')) i++;
            const out = n + ' (' + i + ')';
            namesInUse.add(out);
            return out;
        }
        let added = 0;
        const errors = [];
        for (let fi = 0; fi < files.length; fi++) {
            const file = files[fi];
            try {
                const buf = await readFileAsArrayBuffer(file);
                importMidi(buf);
                const u8 = new Uint8Array(buf);
                const meta = computeSongMetaFromArrayBuffer(buf);
                const id = newSongId();
                const rawBase = file.name.replace(/\.(mid|midi)$/i, '').trim();
                const name = allocateName(rawBase || 'Untitled');
                items.push({
                    id: id,
                    kind: 'file',
                    name: name,
                    parentId: libraryNavFolderId,
                    updatedAt: Date.now(),
                    sizeBytes: u8.byteLength,
                    durationSec: meta.durationSec,
                });
                await writeMidiBytes(id, u8);
                await writeLibraryPayload(items);
                added++;
            } catch (e) {
                const msg = e && e.message ? e.message : String(e);
                errors.push(file.name + ': ' + msg);
                if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
                    errors.push('(Storage may be full; remaining files were not saved.)');
                    break;
                }
            }
        }
        void refreshSongLibraryIfVisible();
        if (added > 0) {
            alert('Added ' + added + ' song(s). Open Songs… to browse or open one.');
        }
        if (errors.length > 0) {
            alert('Some files could not be added:\n' + errors.join('\n'));
        }
    }

    function updateDocumentTitle() {
        document.title = titleDisplayName ? (titleDisplayName + ' – ' + BASE_TITLE) : BASE_TITLE;
    }

    function clearLibrarySongContext(importedBaseName) {
        currentLibraryId = null;
        titleDisplayName = importedBaseName
            ? importedBaseName.replace(/\.(mid|midi)$/i, '').trim() || importedBaseName
            : null;
        updateDocumentTitle();
    }

    function setCurrentLibrarySong(id, displayName) {
        currentLibraryId = id;
        titleDisplayName = displayName.trim() || 'Untitled';
        updateDocumentTitle();
    }

    function getMidiBytesForSave() {
        const full = exportMidi();
        return full != null ? full : exportMidiOrEmptyTemplate();
    }

    async function saveCurrentToStorage(name, idOrNull) {
        try {
            await ensureOpfs();
        } catch (e) {
            alert(e.message || String(e));
            return null;
        }
        const nameTrim = (name || '').trim();
        if (!nameTrim) {
            alert('Please enter a song name.');
            return null;
        }
        const bytes = getMidiBytesForSave();
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const meta = computeSongMetaFromArrayBuffer(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
        let items = await loadItemsPreserveUi();
        const now = Date.now();
        let id = idOrNull;
        if (!id) {
            id = newSongId();
            items.push({
                id: id,
                kind: 'file',
                name: nameTrim,
                parentId: libraryNavFolderId,
                updatedAt: now,
                sizeBytes: u8.byteLength,
                durationSec: meta.durationSec,
            });
        } else {
            const idx = items.findIndex(function(x) { return x.id === id; });
            if (idx < 0) {
                items.push({
                    id: id,
                    kind: 'file',
                    name: nameTrim,
                    parentId: libraryNavFolderId,
                    updatedAt: now,
                    sizeBytes: u8.byteLength,
                    durationSec: meta.durationSec,
                });
            } else {
                items[idx].name = nameTrim;
                items[idx].updatedAt = now;
                items[idx].sizeBytes = u8.byteLength;
                items[idx].durationSec = meta.durationSec;
                if (items[idx].kind !== 'file') items[idx].kind = 'file';
            }
        }
        try {
            await writeMidiBytes(id, u8);
            await writeLibraryPayload(items);
        } catch (e) {
            if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
                alert('Could not save: storage is full.');
            } else {
                alert('Could not save: ' + (e && e.message ? e.message : String(e)));
            }
            return null;
        }
        setCurrentLibrarySong(id, nameTrim);
        recordRecentLibrarySong(id, nameTrim);
        return id;
    }

    /**
     * Load a song from the OPFS library into the editor.
     * @param {string} id
     * @param {{ quiet?: boolean, skipUndo?: boolean }} [options] quiet: no alerts; skipUndo: do not push undo state (e.g. session restore).
     */
    async function loadSongFromStorage(id, options) {
        options = options || {};
        const quiet = options.quiet === true;
        const skipUndo = options.skipUndo === true;
        try {
            await ensureOpfs();
        } catch (e) {
            if (!quiet) alert(e.message || String(e));
            return false;
        }
        const items = await loadItemsPreserveUi();
        const it = findItem(items, id);
        if (!it || it.kind !== 'file') return false;
        const buf = await readMidiBytes(id);
        if (!buf) {
            if (!quiet) alert('Saved song data is missing.');
            return false;
        }
        try {
            applyMidiImportFromArrayBuffer(buf, skipUndo ? { skipUndo: true } : undefined);
        } catch (err) {
            if (!quiet) alert('Failed to load saved MIDI: ' + err.message);
            console.error(err);
            return false;
        }
        setCurrentLibrarySong(id, it.name);
        recordRecentLibrarySong(id, it.name);
        return true;
    }

    /** On startup: load the most recent library song if still present; drop stale recent entries silently. */
    async function restoreLastLibrarySongOnStartup() {
        try {
            await ensureOpfs();
        } catch (e) {
            return;
        }
        let entries = readRecentSongsFromStorage();
        while (entries.length > 0) {
            const id = entries[0].id;
            const ok = await loadSongFromStorage(id, { quiet: true, skipUndo: true });
            if (ok) return;
            entries = entries.slice(1);
            writeRecentSongsToStorage(entries);
        }
    }

    async function renameItem(id, newName) {
        const nameTrim = (newName || '').trim();
        if (!nameTrim) {
            alert('Please enter a name.');
            return false;
        }
        const items = await loadItemsPreserveUi();
        const idx = items.findIndex(function(x) { return x.id === id; });
        if (idx < 0) return false;
        items[idx].name = nameTrim;
        items[idx].updatedAt = Date.now();
        await writeLibraryPayload(items);
        if (currentLibraryId === id) {
            titleDisplayName = nameTrim;
            updateDocumentTitle();
        }
        syncRecentSongDisplayName(id, nameTrim);
        return true;
    }

    function formatUpdatedAt(ts) {
        try {
            return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        } catch (e) {
            return String(ts);
        }
    }

    async function refreshSongLibraryIfVisible() {
        const panel = document.getElementById('song-library');
        if (panel && !panel.classList.contains('hidden')) await refreshLibraryList();
    }

    function applyRangeSelection(visibleIds, anchorId, endId) {
        const ai = visibleIds.indexOf(anchorId);
        const bi = visibleIds.indexOf(endId);
        if (ai < 0 || bi < 0) return;
        const lo = Math.min(ai, bi);
        const hi = Math.max(ai, bi);
        librarySelection.clear();
        for (let i = lo; i <= hi; i++) librarySelection.add(visibleIds[i]);
    }

    function getRowIdsIntersectingMarquee(container, rect) {
        const out = [];
        const rows = container.querySelectorAll('.song-library-row[data-item-id]');
        rows.forEach(function(row) {
            const r = row.getBoundingClientRect();
            if (r.bottom >= rect.top && r.top <= rect.bottom && r.right >= rect.left && r.left <= rect.right) {
                out.push(row.getAttribute('data-item-id'));
            }
        });
        return out;
    }

    async function refreshLibraryList() {
        const listEl = document.getElementById('song-library-list');
        if (!listEl) return;
        try {
            await ensureOpfs();
        } catch (e) {
            listEl.innerHTML = '';
            const p = document.createElement('p');
            p.className = 'song-library-empty';
            p.textContent = e.message || 'OPFS is not available in this browser.';
            listEl.appendChild(p);
            return;
        }
        let items = await loadItemsPreserveUi();
        await enrichFileMetadata(items);
        items = await loadItemsPreserveUi();

        const children = getChildrenInFolder(items, libraryNavFolderId);
        const sorted = sortChildren(items, children);
        const visibleIds = sorted.map(function(x) { return x.id; });

        updateBreadcrumb(items);
        updateToolbarState();

        const sortSelect = document.getElementById('song-library-sort');
        if (sortSelect && sortSelect.value !== librarySortValue) sortSelect.value = librarySortValue;

        listEl.innerHTML = '';
        const previewingId = typeof getLibraryPreviewSongId === 'function' ? getLibraryPreviewSongId() : null;

        if (sorted.length === 0) {
            const p = document.createElement('p');
            p.className = 'song-library-empty';
            p.textContent = 'This folder is empty. Save songs, import MIDI, or create a folder.';
            listEl.appendChild(p);
            return;
        }

        for (let ri = 0; ri < sorted.length; ri++) {
            const item = sorted[ri];
            const row = document.createElement('div');
            row.className = 'song-library-row';
            row.dataset.itemId = item.id;
            row.dataset.itemKind = item.kind;
            if (librarySelection.has(item.id)) row.classList.add('song-library-row-selected');

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'song-library-row-cb';
            cb.checked = librarySelection.has(item.id);
            cb.title = 'Select';
            cb.addEventListener('click', function(e) { e.stopPropagation(); });
            cb.addEventListener('change', function() {
                if (cb.checked) {
                    librarySelection.add(item.id);
                    libraryAnchorId = item.id;
                } else {
                    librarySelection.delete(item.id);
                }
                void refreshLibraryList();
            });

            const nameCell = document.createElement('div');
            nameCell.className = 'song-library-col-name';
            let icon;
            if (item.kind === 'folder') {
                icon = document.createElement('span');
                icon.className = 'song-library-icon song-library-icon-emoji';
                icon.textContent = '📁';
                icon.setAttribute('aria-hidden', 'true');
            } else {
                icon = document.createElement('img');
                icon.className = 'song-library-icon';
                icon.src = 'Icons/Instrument.png';
                icon.alt = '';
            }
            const title = document.createElement('span');
            title.className = 'song-library-name-text';
            title.textContent = item.name;
            title.title = item.kind === 'folder' ? 'Double-click to open' : item.name;
            nameCell.appendChild(icon);
            nameCell.appendChild(title);

            const sizeCell = document.createElement('div');
            sizeCell.className = 'song-library-col-meta';
            sizeCell.textContent = item.kind === 'folder' ? '—' : formatBytes(item.sizeBytes);

            const lenCell = document.createElement('div');
            lenCell.className = 'song-library-col-meta';
            lenCell.textContent = item.kind === 'folder' ? '—' : formatDuration(item.durationSec);

            const dateCell = document.createElement('div');
            dateCell.className = 'song-library-col-meta';
            dateCell.textContent = formatUpdatedAt(item.updatedAt);

            const actions = document.createElement('div');
            actions.className = 'song-library-row-actions';

            if (item.kind === 'file') {
                const btnPlay = document.createElement('button');
                btnPlay.type = 'button';
                btnPlay.className = 'song-library-play';
                btnPlay.textContent = previewingId === item.id ? 'Stop' : 'Play';
                btnPlay.title = previewingId === item.id ? 'Stop preview' : 'Preview';
                btnPlay.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (typeof getLibraryPreviewSongId === 'function' && getLibraryPreviewSongId() === item.id) {
                        if (typeof stopLibraryPreview === 'function') stopLibraryPreview();
                        return;
                    }
                    (async function() {
                        const buf = await readMidiBytes(item.id);
                        if (!buf) { alert('Missing data.'); return; }
                        try {
                            if (typeof startLibraryPreview === 'function') startLibraryPreview(buf, item.id);
                        } catch (err) {
                            alert('Could not play file.');
                        }
                    })();
                });
                actions.appendChild(btnPlay);

                const btnOpen = document.createElement('button');
                btnOpen.type = 'button';
                btnOpen.textContent = 'Open';
                btnOpen.addEventListener('click', function(e) {
                    e.stopPropagation();
                    void (async function() {
                        if (await loadSongFromStorage(item.id)) closeSongLibrary();
                    })();
                });
                actions.appendChild(btnOpen);
            } else {
                const btnOpenF = document.createElement('button');
                btnOpenF.type = 'button';
                btnOpenF.textContent = 'Open';
                btnOpenF.addEventListener('click', function(e) {
                    e.stopPropagation();
                    libraryNavFolderId = item.id;
                    clearLibrarySelection();
                    void persistUiOnly();
                    void refreshLibraryList();
                });
                actions.appendChild(btnOpenF);
            }

            const btnRename = document.createElement('button');
            btnRename.type = 'button';
            btnRename.textContent = 'Rename';
            btnRename.addEventListener('click', function(e) {
                e.stopPropagation();
                const n = prompt(item.kind === 'folder' ? 'Folder name:' : 'Song name:', item.name);
                if (n === null) return;
                void (async function() {
                    if (await renameItem(item.id, n)) await refreshLibraryList();
                })();
            });

            const btnDelete = document.createElement('button');
            btnDelete.type = 'button';
            btnDelete.textContent = 'Delete';
            btnDelete.className = 'song-library-delete';
            btnDelete.addEventListener('click', function(e) {
                e.stopPropagation();
                const msg = item.kind === 'folder'
                    ? 'Delete folder "' + item.name + '" and everything inside it?'
                    : 'Delete "' + item.name + '"?';
                if (!confirm(msg)) return;
                void (async function() {
                    await deleteLibraryItems([item.id]);
                    await refreshLibraryList();
                })();
            });

            actions.appendChild(btnRename);
            actions.appendChild(btnDelete);

            row.addEventListener('mousedown', function(e) {
                if (e.button !== 0) return;
                if (e.target.closest('button') || e.target.closest('input[type="checkbox"]')) return;
                const shift = e.shiftKey;
                const meta = e.ctrlKey || e.metaKey;
                if (shift && libraryAnchorId) {
                    applyRangeSelection(visibleIds, libraryAnchorId, item.id);
                    void refreshLibraryList();
                    return;
                }
                if (meta) {
                    if (librarySelection.has(item.id)) librarySelection.delete(item.id);
                    else librarySelection.add(item.id);
                    libraryAnchorId = item.id;
                    void refreshLibraryList();
                    return;
                }
                librarySelection.clear();
                librarySelection.add(item.id);
                libraryAnchorId = item.id;
                void refreshLibraryList();
            });

            title.addEventListener('dblclick', function(e) {
                e.stopPropagation();
                if (item.kind === 'folder') {
                    libraryNavFolderId = item.id;
                    clearLibrarySelection();
                    void persistUiOnly();
                    void refreshLibraryList();
                }
            });

            row.appendChild(cb);
            row.appendChild(nameCell);
            row.appendChild(sizeCell);
            row.appendChild(lenCell);
            row.appendChild(dateCell);
            row.appendChild(actions);
            listEl.appendChild(row);
        }
    }

    function onLibraryBodyMouseDown(e) {
        if (e.button !== 0) return;
        if (e.target.closest('.song-library-row')) return;
        const body = document.getElementById('song-library-body');
        const listEl = document.getElementById('song-library-list');
        if (!body || !body.contains(e.target)) return;
        const emptyBg = e.target === body || e.target === listEl ||
            (e.target.classList && e.target.classList.contains('song-library-empty'));
        if (!emptyBg) return;
        e.preventDefault();
        const br = body.getBoundingClientRect();
        marqueeContainer = body;
        marqueeStart = {
            docLeft: e.clientX - br.left + body.scrollLeft,
            docTop: e.clientY - br.top + body.scrollTop,
            clientX: e.clientX,
            clientY: e.clientY,
        };
        marqueeActive = true;
        marqueeEl = document.createElement('div');
        marqueeEl.className = 'song-library-marquee';
        body.appendChild(marqueeEl);
        marqueeEl.style.left = marqueeStart.docLeft + 'px';
        marqueeEl.style.top = marqueeStart.docTop + 'px';
        marqueeEl.style.width = '0';
        marqueeEl.style.height = '0';
    }

    function onLibraryMarqueeMove(e) {
        if (!marqueeActive || !marqueeEl || !marqueeContainer || !marqueeStart) return;
        const r = marqueeContainer.getBoundingClientRect();
        const curL = e.clientX - r.left + marqueeContainer.scrollLeft;
        const curT = e.clientY - r.top + marqueeContainer.scrollTop;
        const left = Math.min(marqueeStart.docLeft, curL);
        const top = Math.min(marqueeStart.docTop, curT);
        const w = Math.abs(curL - marqueeStart.docLeft);
        const h = Math.abs(curT - marqueeStart.docTop);
        marqueeEl.style.left = left + 'px';
        marqueeEl.style.top = top + 'px';
        marqueeEl.style.width = w + 'px';
        marqueeEl.style.height = h + 'px';
    }

    function onLibraryMarqueeUp(e) {
        if (!marqueeActive) return;
        if (marqueeEl && marqueeContainer) {
            const br = marqueeEl.getBoundingClientRect();
            if (br.width > 4 && br.height > 4) {
                const ids = getRowIdsIntersectingMarquee(marqueeContainer, br);
                if (e.shiftKey) {
                    ids.forEach(function(id) { librarySelection.add(id); });
                } else {
                    librarySelection.clear();
                    ids.forEach(function(id) { librarySelection.add(id); });
                }
                if (ids.length) libraryAnchorId = ids[ids.length - 1];
            } else if (!e.shiftKey) {
                librarySelection.clear();
                libraryAnchorId = null;
            }
        }
        if (marqueeEl && marqueeEl.parentNode) marqueeEl.parentNode.removeChild(marqueeEl);
        marqueeEl = null;
        marqueeActive = false;
        marqueeContainer = null;
        marqueeStart = null;
        void refreshLibraryList();
    }

    async function openSongLibrary() {
        const panel = document.getElementById('song-library');
        if (!panel) return;
        try {
            await ensureOpfs();
            await loadItemsAndUiFromDisk();
            await refreshLibraryList();
            panel.classList.remove('hidden');
            panel.setAttribute('aria-hidden', 'false');
            panel.focus();
        } catch (err) {
            alert(err.message || String(err));
        }
    }

    function closeSongLibrary() {
        const panel = document.getElementById('song-library');
        if (!panel) return;
        panel.classList.add('hidden');
        panel.setAttribute('aria-hidden', 'true');
    }

    function promptName(defaultName) {
        const d = defaultName || 'Untitled';
        const n = prompt('Song name:', d);
        return n === null ? null : n;
    }

    async function saveFromToolbar() {
        try {
            await ensureOpfs();
        } catch (e) {
            alert(e.message || String(e));
            return;
        }
        if (currentLibraryId) {
            const items = await loadItemsPreserveUi();
            const meta = findItem(items, currentLibraryId);
            const nm = meta ? meta.name : 'Untitled';
            await saveCurrentToStorage(nm, currentLibraryId);
        } else {
            await saveAsFromToolbar();
        }
    }

    async function saveAsFromToolbar() {
        try {
            await ensureOpfs();
        } catch (e) {
            alert(e.message || String(e));
            return;
        }
        const items = await loadItemsPreserveUi();
        const meta = currentLibraryId ? findItem(items, currentLibraryId) : null;
        const def = meta ? meta.name : titleDisplayName || 'Untitled';
        const n = promptName(def);
        if (n === null) return;
        await saveCurrentToStorage(n, null);
    }

    function initSongLibraryChrome() {
        const btnUp = document.getElementById('song-library-up');
        const btnNewFolder = document.getElementById('song-library-new-folder');
        const btnDelSel = document.getElementById('song-library-delete-selected');
        const btnMove = document.getElementById('song-library-move');
        const sortSel = document.getElementById('song-library-sort');
        const panel = document.getElementById('song-library');

        if (btnUp) btnUp.addEventListener('click', function() {
            if (!libraryNavFolderId) return;
            void (async function() {
                const items = await loadItemsPreserveUi();
                const cur = findItem(items, libraryNavFolderId);
                libraryNavFolderId = cur && cur.parentId ? cur.parentId : null;
                clearLibrarySelection();
                await persistUiOnly();
                await refreshLibraryList();
            })();
        });

        if (btnNewFolder) btnNewFolder.addEventListener('click', function() {
            const n = prompt('New folder name:', 'New folder');
            if (n === null) return;
            const nameTrim = n.trim();
            if (!nameTrim) return;
            void (async function() {
                try {
                    await ensureOpfs();
                    const items = await loadItemsPreserveUi();
                    items.push({
                        id: newFolderId(),
                        kind: 'folder',
                        name: nameTrim,
                        parentId: libraryNavFolderId,
                        updatedAt: Date.now(),
                    });
                    await writeLibraryPayload(items);
                    await refreshLibraryList();
                } catch (e) {
                    alert(e.message || String(e));
                }
            })();
        });

        if (btnDelSel) btnDelSel.addEventListener('click', function() {
            if (librarySelection.size === 0) return;
            if (!confirm('Delete ' + librarySelection.size + ' item(s)?')) return;
            void (async function() {
                await deleteLibraryItems(Array.from(librarySelection));
                clearLibrarySelection();
                await refreshLibraryList();
            })();
        });

        if (btnMove) btnMove.addEventListener('click', function() {
            if (librarySelection.size === 0) return;
            void (async function() {
                const items = await loadItemsPreserveUi();
                const sel = Array.from(librarySelection);
                const folders = items.filter(function(x) {
                    return x.kind === 'folder' && !sel.includes(x.id);
                });
                const options = [{ id: null, label: '(Library root)' }];
                for (let i = 0; i < folders.length; i++) {
                    const f = folders[i];
                    if (!canMoveSelectionTo(items, sel, f.id)) continue;
                    const chain = getFolderChain(items, f.id);
                    const path = chain.map(function(c) { return c.name; }).join(' / ');
                    options.push({ id: f.id, label: path });
                }
                let msg = 'Move ' + sel.length + ' item(s) to:\n';
                for (let i = 0; i < options.length; i++) {
                    msg += (i + 1) + '. ' + options[i].label + '\n';
                }
                const ans = prompt(msg + '\nEnter number (1 = root):', '1');
                if (ans === null) return;
                const num = parseInt(ans, 10);
                if (isNaN(num) || num < 1 || num > options.length) return;
                const target = options[num - 1].id;
                if (await moveItemsToParent(sel, target)) {
                    clearLibrarySelection();
                    await refreshLibraryList();
                }
            })();
        });

        if (sortSel) {
            sortSel.value = librarySortValue;
            sortSel.addEventListener('change', function() {
                librarySortValue = sortSel.value;
                void persistUiOnly();
                void refreshLibraryList();
            });
        }

        const body = document.getElementById('song-library-body');
        if (body && !body.dataset.marqueeInit) {
            body.dataset.marqueeInit = '1';
            body.addEventListener('mousedown', onLibraryBodyMouseDown);
            document.addEventListener('mousemove', onLibraryMarqueeMove);
            document.addEventListener('mouseup', onLibraryMarqueeUp);
        }

        if (panel) {
            panel.tabIndex = -1;
            panel.addEventListener('keydown', function(e) {
                if (!panel.classList.contains('hidden')) {
                    if (e.key === 'Delete' && librarySelection.size > 0) {
                        e.preventDefault();
                        if (confirm('Delete ' + librarySelection.size + ' item(s)?')) {
                            void (async function() {
                                await deleteLibraryItems(Array.from(librarySelection));
                                clearLibrarySelection();
                                await refreshLibraryList();
                            })();
                        }
                    } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                        e.preventDefault();
                        void (async function() {
                            const items = await loadItemsPreserveUi();
                            const children = sortChildren(items, getChildrenInFolder(items, libraryNavFolderId));
                            librarySelection.clear();
                            children.forEach(function(c) { librarySelection.add(c.id); });
                            if (children.length) libraryAnchorId = children[children.length - 1].id;
                            await refreshLibraryList();
                        })();
                    }
                }
            });
        }
    }

    function refreshOpenRecentPanel() {
        const panel = document.getElementById('open-recent-panel');
        if (!panel) return;
        const entries = readRecentSongsFromStorage();
        panel.innerHTML = '';
        if (entries.length === 0) {
            const emptyBtn = document.createElement('button');
            emptyBtn.type = 'button';
            emptyBtn.disabled = true;
            emptyBtn.textContent = 'No recent songs';
            panel.appendChild(emptyBtn);
            return;
        }
        const loadingBtn = document.createElement('button');
        loadingBtn.type = 'button';
        loadingBtn.disabled = true;
        loadingBtn.textContent = 'Loading…';
        panel.appendChild(loadingBtn);
        void (async function() {
            let items = [];
            try {
                await ensureOpfs();
                items = await loadItemsPreserveUi();
            } catch (e) {
                panel.innerHTML = '';
                const errBtn = document.createElement('button');
                errBtn.type = 'button';
                errBtn.disabled = true;
                errBtn.textContent = 'Storage unavailable';
                panel.appendChild(errBtn);
                return;
            }
            const seen = new Set();
            const valid = [];
            for (let i = 0; i < entries.length; i++) {
                const ent = entries[i];
                const it = findItem(items, ent.id);
                if (!it || it.kind !== 'file') continue;
                if (seen.has(ent.id)) continue;
                seen.add(ent.id);
                valid.push({
                    id: ent.id,
                    name: it.name,
                    pathLabel: getLibrarySongPathLabel(items, it),
                });
            }
            writeRecentSongsToStorage(valid.map(function(v) { return { id: v.id, name: v.name }; }));
            panel.innerHTML = '';
            if (valid.length === 0) {
                const emptyBtn = document.createElement('button');
                emptyBtn.type = 'button';
                emptyBtn.disabled = true;
                emptyBtn.textContent = 'No recent songs';
                panel.appendChild(emptyBtn);
                return;
            }
            for (let j = 0; j < valid.length; j++) {
                const row = valid[j];
                const b = document.createElement('button');
                b.type = 'button';
                b.setAttribute('role', 'menuitem');
                b.textContent = row.pathLabel;
                b.title = row.pathLabel;
                (function(songId) {
                    b.addEventListener('click', function() {
                        void (async function() {
                            if (await loadSongFromStorage(songId)) {
                                closeSongLibrary();
                            }
                        })();
                    });
                })(row.id);
                panel.appendChild(b);
            }
        })();
    }

    function initSongLibraryUI() {
        initSongLibraryChrome();
        const btnSongs = document.getElementById('btn-song-library');
        const btnBack = document.getElementById('song-library-back');
        const btnSave = document.getElementById('btn-save-local');
        const btnSaveAs = document.getElementById('btn-save-as-local');

        if (btnSongs) btnSongs.addEventListener('click', function() { void openSongLibrary(); });
        if (btnBack) btnBack.addEventListener('click', closeSongLibrary);
        if (btnSave) btnSave.addEventListener('click', function() { void saveFromToolbar(); });
        if (btnSaveAs) btnSaveAs.addEventListener('click', function() { void saveAsFromToolbar(); });

        updateDocumentTitle();
    }

    window.pulseProOnMidiImportedFromDisk = function(fileName) {
        clearLibrarySongContext(fileName);
    };

    window.pulseProClearLibrarySongContext = function() {
        clearLibrarySongContext(null);
    };

    window.pulseProInitSongLibrary = initSongLibraryUI;

    window.pulseProAddMidiFilesToLibrary = function(files) {
        return addMidiFilesToLibrary(Array.from(files));
    };

    window.pulseProRefreshSongLibraryIfVisible = refreshSongLibraryIfVisible;

    window.pulseProRefreshOpenRecentMenu = refreshOpenRecentPanel;

    window.pulseProRestoreLastLibrarySongOnLoad = restoreLastLibrarySongOnStartup;
})();
