// auto-save.js - Periodic session backup to OPFS (session-autosave.mid); restore on next load.
(function() {
    const AUTOSAVE_NAME = 'session-autosave.mid';
    const INTERVAL_MS = 60000;
    const ACTIVITY_WINDOW_MS = 60000;

    let pulseDir = null;

    /** @returns {Promise<FileSystemDirectoryHandle | null>} */
    async function ensurePulseDir() {
        if (pulseDir) return pulseDir;
        if (!navigator.storage || typeof navigator.storage.getDirectory !== 'function') return null;
        try {
            const root = await navigator.storage.getDirectory();
            pulseDir = await root.getDirectoryHandle('pulsepro', { create: true });
            return pulseDir;
        } catch (e) {
            console.warn('autosave: OPFS unavailable', e);
            return null;
        }
    }

    let lastEditAt = 0;
    let lastAutoSaveAt = 0;
    let indicatorHideTimer = null;

    function markEditorDirtyForAutoSave() {
        lastEditAt = Date.now();
    }
    window.markEditorDirtyForAutoSave = markEditorDirtyForAutoSave;

    function showAutosaveIndicator() {
        const el = document.getElementById('autosave-indicator');
        if (!el) return;
        el.classList.add('autosave-indicator--visible');
        el.setAttribute('aria-hidden', 'false');
        if (indicatorHideTimer) clearTimeout(indicatorHideTimer);
        indicatorHideTimer = window.setTimeout(function() {
            el.classList.remove('autosave-indicator--visible');
            el.setAttribute('aria-hidden', 'true');
            indicatorHideTimer = null;
        }, 500);
    }

    /**
     * Remove session autosave from disk (new project, open/import replacement, user reset).
     * @returns {Promise<void>}
     */
    async function clearSessionAutosave() {
        const dir = await ensurePulseDir();
        if (!dir) return;
        try {
            await dir.removeEntry(AUTOSAVE_NAME);
        } catch (e) {
            /* not present */
        }
    }
    window.pulseProClearSessionAutosave = clearSessionAutosave;

    /** @returns {Promise<void>} */
    async function writeSessionAutosave() {
        const dir = await ensurePulseDir();
        if (!dir) return;
        let bytes = exportMidi();
        if (!bytes) bytes = exportMidiOrEmptyTemplate();
        const fh = await dir.getFileHandle(AUTOSAVE_NAME, { create: true });
        const w = await fh.createWritable();
        await w.write(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
        await w.close();
    }

    /**
     * If a session backup exists, load it into the editor.
     * @returns {Promise<boolean>} true when editor was restored from autosave
     */
    async function tryRestoreSessionAutosave() {
        const dir = await ensurePulseDir();
        if (!dir) return false;
        let file;
        try {
            const fh = await dir.getFileHandle(AUTOSAVE_NAME, { create: false });
            file = await fh.getFile();
        } catch (e) {
            return false;
        }
        const buf = await file.arrayBuffer();
        if (!buf || buf.byteLength < 14) return false;
        try {
            applyMidiImportFromArrayBuffer(buf, { skipUndo: true, clearSessionAutosave: false });
        } catch (err) {
            console.warn('autosave restore failed', err);
            await clearSessionAutosave();
            return false;
        }
        if (typeof window.pulseProClearLibrarySongContext === 'function') {
            window.pulseProClearLibrarySongContext();
        }
        state.undoStack = [];
        state.redoStack = [];
        lastEditAt = 0;
        lastAutoSaveAt = Date.now();
        return true;
    }
    window.pulseProTryRestoreSessionAutosave = tryRestoreSessionAutosave;

    /** @returns {Promise<void>} */
    async function tickAutosave() {
        if (lastEditAt === 0 || lastEditAt <= lastAutoSaveAt) return;
        const now = Date.now();
        if (now - lastEditAt > ACTIVITY_WINDOW_MS) return;
        showAutosaveIndicator();
        try {
            await writeSessionAutosave();
            lastAutoSaveAt = Date.now();
        } catch (e) {
            console.warn('autosave write failed', e);
        }
    }

    let intervalId = null;

    /** Begin the one-minute autosave timer (call once after initial load / restore). */
    function pulseProStartSessionAutosave() {
        if (intervalId !== null) return;
        intervalId = window.setInterval(function() {
            void tickAutosave();
        }, INTERVAL_MS);
    }
    window.pulseProStartSessionAutosave = pulseProStartSessionAutosave;
})();
