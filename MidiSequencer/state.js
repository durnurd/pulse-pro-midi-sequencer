// state.js - Application state
const state = {
    // Scroll position
    scrollX: 0,
    scrollY: TOTAL_HEIGHT / 2 - 300, // start roughly at middle C area

    /** Piano roll timeline runs bottom→top; keyboard strip along bottom; playhead on grid bottom edge. */
    verticalPianoRoll: false,
    /** Vertical layout: Y offset (px) so user can browse time while paused; zeroed during playback. */
    verticalTimePanPx: 0,
    /** Vertical layout: horizontal scroll for playback header (time axis); grid pitch uses scrollX. */
    timelineHeaderScrollPx: 0,

    // Notes: array of {id, note, channel, track, startTick, durationTicks, velocity}
    // channel = MIDI channel (0-15) for audio output
    // track = index into state.tracks[] for UI grouping/color
    // velocity: 0-127 (MIDI velocity)
    notes: [],
    nextNoteId: 1,

    // Current active track index (into state.tracks[])
    activeTrack: 0,
    // Convenience: the MIDI channel of the active track (kept in sync)
    activeChannel: 0,

    // BPM
    bpm: 120,

    // Selection
    selectedNoteIds: new Set(),

    // Playback
    playbackTick: 0,
    isPlaying: false,
    isPaused: false,
    isRepeat: false,
    /** When true, MIDI note on/off from hardware is written to the piano roll during playback. */
    midiRecordArmed: false,
    /** When true, Web MIDI note on/off lights matching keys on the on-screen keyboard (View menu). */
    midiKeyboardMonitor: false,
    playbackStartTime: 0,
    playbackStartTick: 0,
    /** Last playhead tick set by clicking/dragging the playback header (restore after natural end when repeat is off). */
    lastMousePlaybackTick: 0,
    // Track indices with at least one note currently sounding during editor playback (for UI)
    playbackSoundingTracks: new Set(),

    // Active tool: 'cursor', 'pencil', 'eraser'
    activeTool: 'pencil',

    // Time signature (values from project start until first timeSig change)
    timeSigNumerator: 4,
    timeSigDenominator: 4,

    // Conductor map: changes at tick > 0 only; tick 0 uses bpm / timeSig* above
    tempoChanges: [],
    timeSigChanges: [],
    conductor: {
        locked: false,
    },
    /** null | 'bpm' | 'timesig' — Insert menu placement mode */
    conductorPlacementMode: null,
    /** Live preview tick during placement (grid + header); null if unknown */
    conductorPlacementHoverTick: null,
    /** While dragging a conductor marker on the playback header: { kind, origTick, previewTick } */
    conductorMarkerDragPreview: null,

    // Grid snap: 0 = quarter … 5 = 128th; -1 = none (see setSnapGridPower)
    snapGridPower: 2,

    /** null = chromatic; { root: 0–11 (C=0), mode: 'major' | 'minor' } limits placement / vertical drags (Shift overrides) */
    keySignature: null,

    // Undo/Redo
    undoStack: [],
    redoStack: [],

    // Clipboard (kept for internal fallback; primary is system clipboard)
    clipboard: [],

    // Active/highlighted keyboard notes (Set of MIDI note numbers)
    highlightedKeys: new Set(),
    /** Keys currently held on a MIDI controller when midiKeyboardMonitor is on (0–127). */
    midiInputHeldKeys: new Set(),

    // Interaction mode
    mode: 'idle', // idle, placing, resizing-left, resizing-right, moving, selecting, dragging-playback, pencil-drawing, erasing
    interactionNote: null,
    interactionData: null,

    // Canvas dimensions
    gridWidth: 0,
    gridHeight: 0,

    // Per-channel automation events (pitch bends and CC changes loaded from MIDI)
    // pitchBends: array of {tick, channel, value} where value is 0-16383 (8192 = center)
    pitchBends: [],
    // controllerChanges: array of {tick, channel, controller, value} (0-127)
    controllerChanges: [],

    // Automation overlay: null = none, 'pitchBend', or a CC number (7, 10, 11, etc.)
    automationOverlay: null,

    // When true, automation editor is docked below the piano roll (full timeline width)
    automationEditorExpanded: false,

    // Height (px) of the expanded automation strip (including resize handle); applied when expanded
    automationExpandedHeightPx: 168,

    // Automation editor tool: 'line' | 'freehand' | 'curve' | 'wave-sine' | 'wave-square' | 'wave-saw' | 'wave-triangle' | 'erase' | 'select'
    automationEditorTool: 'line',

    // Manual tick range for select/copy when no notes are selected { startTick, endTick }; null if unset
    automationSelectTicks: null,

    // Internal clipboard for automation copy/paste (select tool); shape set by automation-editor.js
    automationClipboard: null,

    // Dynamic track list. Each track: {name, channel, instrument, color, hidden, locked, muted, solo}
    // color is null when no notes exist on the track; assigned from TRACK_COLORS palette dynamically
    tracks: [],

    // Legacy compatibility: channels array is a view derived from tracks
    // (kept as a getter below)
};

// Create default 16 tracks (Track 1–16, channels 0–15)
const MAX_TRACKS = 100;

function createDefaultTracks() {
    const tracks = [];
    for (let i = 0; i < MAX_TRACKS; i++) {
        tracks.push({ name: `Track ${i + 1}`, channel: i < 16 ? i : 0, instrument: 0, color: null, hidden: false, locked: false, muted: false, solo: false });
    }
    return tracks;
}
state.tracks = createDefaultTracks();

// Ensure state.tracks has at least MAX_TRACKS entries, padding with defaults if needed
function ensureMinTracks() {
    while (state.tracks.length < MAX_TRACKS) {
        const i = state.tracks.length;
        state.tracks.push({ name: `Track ${i + 1}`, channel: i < 16 ? i : 0, instrument: 0, color: null, hidden: false, locked: false, muted: false, solo: false });
    }
}

// --- Track color assignment ---
// Assigns colors from TRACK_COLORS palette to tracks that have notes.
// Called after notes change (add/remove/import/clear).
function reassignTrackColors() {
    // Count notes per track
    const counts = new Array(state.tracks.length).fill(0);
    for (const n of state.notes) {
        if (n.track >= 0 && n.track < state.tracks.length) counts[n.track]++;
    }
    let colorIdx = 0;
    for (let i = 0; i < state.tracks.length; i++) {
        if (counts[i] > 0) {
            state.tracks[i].color = TRACK_COLORS[colorIdx % TRACK_COLORS.length];
            colorIdx++;
        } else {
            state.tracks[i].color = null;
        }
    }
}

// Get the color for a track (fallback to grey if no color assigned)
function getTrackColor(trackIdx) {
    const trk = state.tracks[trackIdx];
    if (trk && trk.color) return trk.color;
    return '#888888';
}

// Get track object for a note
function getTrackForNote(n) {
    return state.tracks[n.track] || state.tracks[0];
}

// Helper: is a track audible? (respects mute + solo logic)
function isTrackAudible(trackIdx) {
    const trk = state.tracks[trackIdx];
    if (!trk) return false;
    if (trk.muted) return false;
    const anySolo = state.tracks.some(t => t.solo);
    if (anySolo && !trk.solo) return false;
    return true;
}

// Legacy: is a channel audible? Checks all tracks on that channel.
function isChannelAudible(ch) {
    // A channel is audible if ANY track on that channel is audible
    for (let i = 0; i < state.tracks.length; i++) {
        if (state.tracks[i].channel === ch && isTrackAudible(i)) return true;
    }
    return false;
}

// Set active track and sync activeChannel
function setActiveTrack(trackIdx) {
    if (trackIdx < 0 || trackIdx >= state.tracks.length) return;
    state.activeTrack = trackIdx;
    state.activeChannel = state.tracks[trackIdx].channel;
}

function addNote(note, channel, startTick, durationTicks, velocity = 100, track = undefined) {
    const trk = (track !== undefined) ? track : state.activeTrack;
    // Check if this track was empty before adding
    const wasEmpty = !state.notes.some(n => n.track === trk);
    const n = {
        id: state.nextNoteId++,
        note,
        channel,
        track: trk,
        startTick,
        durationTicks: Math.max(1, durationTicks),
        velocity: Math.max(0, Math.min(127, velocity)),
    };
    state.notes.push(n);
    if (wasEmpty) reassignTrackColors();
    return n;
}

function removeNote(id) {
    const idx = state.notes.findIndex(n => n.id === id);
    if (idx >= 0) {
        const trk = state.notes[idx].track;
        state.notes.splice(idx, 1);
        state.selectedNoteIds.delete(id);
        // If track is now empty, reassign colors
        if (!state.notes.some(n => n.track === trk)) reassignTrackColors();
    }
}

function removeSelectedNotes() {
    state.notes = state.notes.filter(n => !state.selectedNoteIds.has(n.id));
    state.selectedNoteIds.clear();
    reassignTrackColors();
}

function clearAllNotes() {
    state.notes = [];
    state.selectedNoteIds.clear();
    state.nextNoteId = 1;
    state.pitchBends = [];
    state.controllerChanges = [];
    state.tempoChanges = [];
    state.timeSigChanges = [];
    state.conductorPlacementMode = null;
    state.conductorPlacementHoverTick = null;
    state.conductorMarkerDragPreview = null;
    state.conductor = { locked: false };
    reassignTrackColors();
}

/**
 * Map grid canvas local coords to unified world space (time px on X, pitch row px on Y).
 * @param {number} lx
 * @param {number} ly
 * @returns {{ x: number, y: number }}
 */
function gridPointerToWorld(lx, ly) {
    if (!state.verticalPianoRoll) {
        return { x: lx + state.scrollX, y: ly + state.scrollY };
    }
    const noteCol = Math.max(0, Math.min(TOTAL_MIDI_NOTES - 1, Math.floor((lx + state.scrollX) / NOTE_HEIGHT)));
    const row = TOTAL_MIDI_NOTES - 1 - noteCol;
    const seamY = state.gridHeight - 1;
    const tickFloat = state.playbackTick + (seamY - ly + state.verticalTimePanPx) / SNAP_WIDTH;
    return { x: tickFloat * SNAP_WIDTH, y: row * NOTE_HEIGHT };
}

function isVerticalPianoRoll() {
    return !!state.verticalPianoRoll;
}

function getPlaybackHeaderScrollPx() {
    return state.verticalPianoRoll ? state.timelineHeaderScrollPx : state.scrollX;
}

/**
 * Map a Y coordinate on the vertical playback strip canvas to a raw tick (same geometry as the grid).
 * @param {number} localY
 * @returns {number}
 */
function playbackVerticalStripYToTick(localY) {
    const h = state.gridHeight;
    const seamY = h - 1;
    const pan = state.verticalTimePanPx;
    const pb = state.playbackTick;
    return pb + (seamY - localY + pan) / SNAP_WIDTH;
}

function getNoteAt(x, y) {
    // x, y in grid-space (with scroll applied)
    const tick = x / SNAP_WIDTH;
    const noteNum = Math.floor(y / NOTE_HEIGHT);
    // Search in reverse so topmost (last drawn) is found first
    for (let i = state.notes.length - 1; i >= 0; i--) {
        const n = state.notes[i];
        // Skip notes on hidden or locked tracks (not interactable)
        const trk = state.tracks[n.track];
        if (trk && (trk.hidden || trk.locked)) continue;
        const row = TOTAL_MIDI_NOTES - 1 - n.note;
        if (row !== noteNum) continue;
        const nx = n.startTick * SNAP_WIDTH;
        const nw = n.durationTicks * SNAP_WIDTH;
        if (x >= nx && x < nx + nw) return n;
    }
    return null;
}

function getNotesInRect(x1, y1, x2, y2) {
    // All coords in grid-space
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    const result = [];
    for (const n of state.notes) {
        // Skip notes on hidden or locked tracks (not selectable)
        const trk = state.tracks[n.track];
        if (trk && (trk.hidden || trk.locked)) continue;
        const row = TOTAL_MIDI_NOTES - 1 - n.note;
        const ny = row * NOTE_HEIGHT;
        const nx = n.startTick * SNAP_WIDTH;
        const nw = n.durationTicks * SNAP_WIDTH;
        if (nx + nw > left && nx < right && ny + NOTE_HEIGHT > top && ny < bottom) {
            result.push(n);
        }
    }
    return result;
}

function getEndTick() {
    let maxTick = 0;
    for (const n of state.notes) {
        const end = n.startTick + n.durationTicks;
        if (end > maxTick) maxTick = end;
    }
    for (const e of state.tempoChanges) {
        if (e.tick > maxTick) maxTick = e.tick;
    }
    for (const e of state.timeSigChanges) {
        if (e.tick > maxTick) maxTick = e.tick;
    }
    return maxTick;
}

// Convert pixel position to raw tick
function pxToTick(px) {
    return Math.round(px / SNAP_WIDTH);
}

// Snap a raw tick to the nearest grid boundary (see TICKS_PER_SNAP); off-grid when snap disabled
function snapTickToGrid(tick) {
    if (state.snapGridPower < 0) return Math.round(tick);
    return Math.round(tick / TICKS_PER_SNAP) * TICKS_PER_SNAP;
}

// Convert pixel position to snapped tick (for UI interactions)
function snapTick(px) {
    return snapTickToGrid(pxToTick(px));
}

// --- Undo/Redo ---
function _makeSnapshot() {
    return JSON.stringify({
        notes: state.notes.map(n => ({ ...n })),
        pitchBends: state.pitchBends,
        controllerChanges: state.controllerChanges,
        tracks: state.tracks.map(t => ({ ...t })),
        bpm: state.bpm,
        timeSigNumerator: state.timeSigNumerator,
        timeSigDenominator: state.timeSigDenominator,
        tempoChanges: state.tempoChanges.map(e => ({ ...e })),
        timeSigChanges: state.timeSigChanges.map(e => ({ ...e })),
        conductor: { ...state.conductor },
        snapGridPower: state.snapGridPower,
        activeTrack: state.activeTrack,
        keySignature: state.keySignature ? { root: state.keySignature.root, mode: state.keySignature.mode } : null,
    });
}
function _restoreSnapshot(json) {
    const snap = JSON.parse(json);
    state.notes = snap.notes || [];
    state.pitchBends = snap.pitchBends || [];
    state.controllerChanges = snap.controllerChanges || [];
    if (snap.tracks) state.tracks = snap.tracks;
    if (typeof snap.bpm === 'number') state.bpm = snap.bpm;
    if (typeof snap.timeSigNumerator === 'number') state.timeSigNumerator = snap.timeSigNumerator;
    if (typeof snap.timeSigDenominator === 'number') state.timeSigDenominator = snap.timeSigDenominator;
    state.tempoChanges = Array.isArray(snap.tempoChanges) ? snap.tempoChanges.map(e => ({ tick: e.tick, bpm: e.bpm })) : [];
    state.timeSigChanges = Array.isArray(snap.timeSigChanges)
        ? snap.timeSigChanges.map(e => ({ tick: e.tick, numerator: e.numerator, denominator: e.denominator }))
        : [];
    if (snap.conductor && typeof snap.conductor === 'object') {
        state.conductor.locked = !!snap.conductor.locked;
    }
    state.conductorPlacementMode = null;
    state.conductorPlacementHoverTick = null;
    state.conductorMarkerDragPreview = null;
    let sgp = typeof snap.snapGridPower === 'number' ? snap.snapGridPower : 2;
    if (sgp !== SNAP_GRID_POWER_NONE) sgp = Math.max(SNAP_GRID_POWER_MIN, Math.min(SNAP_GRID_POWER_MAX, sgp));
    state.snapGridPower = setSnapGridPower(sgp);
    if (typeof snap.activeTrack === 'number' && snap.activeTrack >= 0 && snap.activeTrack < state.tracks.length) {
        setActiveTrack(snap.activeTrack);
    }
    if (snap.keySignature && typeof snap.keySignature.root === 'number' &&
        (snap.keySignature.mode === 'major' || snap.keySignature.mode === 'minor')) {
        state.keySignature = { root: snap.keySignature.root % 12, mode: snap.keySignature.mode };
    } else {
        state.keySignature = null;
    }
    state.selectedNoteIds.clear();
    if (state.notes.length > 0) state.nextNoteId = Math.max(...state.notes.map(n => n.id)) + 1;
    reassignTrackColors();
}

/** Cleared when any non-BPM undo runs, or after undo/redo. */
let _bpmUndoCoalesceOpen = false;

/** @param {unknown} entry */
function normalizeUndoStackEntry(entry) {
    if (typeof entry === 'string') return { snapshot: entry, label: 'edit' };
    if (entry && typeof entry.snapshot === 'string') {
        return { snapshot: entry.snapshot, label: (entry.label && String(entry.label).trim()) ? String(entry.label).trim() : 'edit' };
    }
    return { snapshot: _makeSnapshot(), label: 'edit' };
}

/**
 * Push current state onto the undo stack before a mutating operation.
 * @param {string} [label] Short phrase for Edit menu (e.g. 'move note').
 */
function pushUndoState(label) {
    const l = (label != null && String(label).trim()) ? String(label).trim() : 'edit';
    state.undoStack.push({ snapshot: _makeSnapshot(), label: l });
    if (state.undoStack.length > 200) state.undoStack.shift();
    state.redoStack = [];
    _bpmUndoCoalesceOpen = false;
    if (typeof window.markEditorDirtyForAutoSave === 'function') window.markEditorDirtyForAutoSave();
}

/**
 * For BPM tweaks (e.g. spinner arrows): one stack entry for a run of consecutive BPM edits.
 * Any other pushUndoState ends the coalesce window.
 */
function pushUndoStateForBpm() {
    if (!_bpmUndoCoalesceOpen) {
        state.undoStack.push({ snapshot: _makeSnapshot(), label: 'change BPM' });
        if (state.undoStack.length > 200) state.undoStack.shift();
        state.redoStack = [];
        _bpmUndoCoalesceOpen = true;
    }
    if (typeof window.markEditorDirtyForAutoSave === 'function') window.markEditorDirtyForAutoSave();
}

/** End BPM coalesce when the BPM control loses focus so a later edit starts a new undo step. */
function endBpmUndoCoalesceSession() {
    _bpmUndoCoalesceOpen = false;
}

function undo() {
    if (state.undoStack.length === 0) return;
    const entry = normalizeUndoStackEntry(state.undoStack.pop());
    state.redoStack.push({ snapshot: _makeSnapshot(), label: entry.label });
    _restoreSnapshot(entry.snapshot);
    _bpmUndoCoalesceOpen = false;
    if (window.afterUndoRedoRestore) window.afterUndoRedoRestore();
    if (typeof window.markEditorDirtyForAutoSave === 'function') window.markEditorDirtyForAutoSave();
    renderAll();
}

function redo() {
    if (state.redoStack.length === 0) return;
    const entry = normalizeUndoStackEntry(state.redoStack.pop());
    state.undoStack.push({ snapshot: _makeSnapshot(), label: entry.label });
    _restoreSnapshot(entry.snapshot);
    _bpmUndoCoalesceOpen = false;
    if (window.afterUndoRedoRestore) window.afterUndoRedoRestore();
    if (typeof window.markEditorDirtyForAutoSave === 'function') window.markEditorDirtyForAutoSave();
    renderAll();
}

// --- Clipboard (system clipboard, text-based) ---
function notesToClipboardText(notes) {
    // Format: tab-separated lines: note channel startTick durationTicks velocity track
    const minTick = Math.min(...notes.map(n => n.startTick));
    return 'PULSEPRO_NOTES\n' + notes.map(n =>
        [n.note, n.channel, n.startTick - minTick, n.durationTicks, n.velocity ?? 100, n.track ?? 0].join('\t')
    ).join('\n');
}

function clipboardTextToNotes(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines[0].trim() !== 'PULSEPRO_NOTES') return null;
    const result = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split('\t');
        if (parts.length < 4) continue;
        result.push({
            note: parseInt(parts[0]),
            channel: parseInt(parts[1]),
            startTickOffset: parseInt(parts[2]),
            durationTicks: parseInt(parts[3]),
            velocity: parts.length >= 5 ? parseInt(parts[4]) : 100,
            track: parts.length >= 6 ? parseInt(parts[5]) : 0,
        });
    }
    return result.length > 0 ? result : null;
}

async function copySelectedNotes() {
    if (state.selectedNoteIds.size === 0) return;
    const selected = state.notes.filter(n => state.selectedNoteIds.has(n.id));
    const text = notesToClipboardText(selected);
    try {
        await navigator.clipboard.writeText(text);
    } catch (e) {
        // Fallback: store internally
        console.warn('Clipboard write failed, using internal clipboard', e);
    }
    // Also store internally as fallback
    const minTick = Math.min(...selected.map(n => n.startTick));
    state.clipboard = selected.map(n => ({
        note: n.note,
        channel: n.channel,
        track: n.track ?? 0,
        startTickOffset: n.startTick - minTick,
        durationTicks: n.durationTicks,
        velocity: n.velocity ?? 100,
    }));
}

async function pasteNotes() {
    let clipData = null;
    try {
        const text = await navigator.clipboard.readText();
        clipData = clipboardTextToNotes(text);
    } catch (e) {
        console.warn('Clipboard read failed, using internal clipboard', e);
    }
    if (!clipData && state.clipboard.length > 0) clipData = state.clipboard;
    if (!clipData || clipData.length === 0) return;
    pushUndoState('paste notes');
    state.selectedNoteIds.clear();
    const baseTick = state.playbackTick;
    let maxEndTick = 0;
    
    // Check if all copied notes belong to the same track
    const uniqueTracks = new Set(clipData.map(c => c.track));
    const isSingleTrack = uniqueTracks.size === 1;
    
    for (const c of clipData) {
        // If single track, paste to active track. Otherwise, keep original track (if valid)
        let trk = state.activeTrack;
        if (!isSingleTrack) {
            trk = (c.track >= 0 && c.track < state.tracks.length) ? c.track : state.activeTrack;
        }
        // Use the channel of the destination track
        const ch = state.tracks[trk].channel;
        
        let pasteNote = c.note;
        if (isKeySignatureActive(state.keySignature)) {
            pasteNote = snapMidiNoteToKey(pasteNote, state.keySignature);
        }
        const n = addNote(pasteNote, ch, Math.round(baseTick) + c.startTickOffset, c.durationTicks, c.velocity ?? 100, trk);
        state.selectedNoteIds.add(n.id);
        const end = n.startTick + n.durationTicks;
        if (end > maxEndTick) maxEndTick = end;
    }
    reassignTrackColors();
    state.playbackTick = maxEndTick;
    state.playbackStartTick = maxEndTick;
    renderAll();
}

// --- Conductor / effective tempo & time signature ---
function conductorTrackVisible() {
    return state.tempoChanges.length + state.timeSigChanges.length > 0;
}

function getEffectiveBpmAtTick(tick) {
    let bpm = state.bpm;
    for (let i = 0; i < state.tempoChanges.length; i++) {
        const e = state.tempoChanges[i];
        if (e.tick > tick) break;
        bpm = e.bpm;
    }
    return bpm;
}

function getEffectiveTimeSigAtTick(tick) {
    let numerator = state.timeSigNumerator;
    let denominator = state.timeSigDenominator;
    for (let i = 0; i < state.timeSigChanges.length; i++) {
        const e = state.timeSigChanges[i];
        if (e.tick > tick) break;
        numerator = e.numerator;
        denominator = e.denominator;
    }
    return { numerator, denominator };
}

/** Ticks per measure at a timeline position (respects conductor map). */
function ticksPerMeasureAtTick(tick) {
    const sig = getEffectiveTimeSigAtTick(tick);
    return sig.numerator * SNAP_DIVISION * (4 / sig.denominator);
}

// --- Measure helpers ---
function ticksPerMeasure() {
    return ticksPerMeasureAtTick(0);
}

/**
 * Start tick of the measure containing `tick` (walk forward from 0; supports changing time signatures).
 */
function measureStartTickContaining(tick) {
    if (tick <= 0) return 0;
    let cur = 0;
    let guard = 0;
    const maxGuard = 2000000;
    while (cur <= tick && guard++ < maxGuard) {
        const tpm = ticksPerMeasureAtTick(cur);
        if (tpm <= 0) return cur;
        if (tick < cur + tpm) return cur;
        cur += tpm;
    }
    return cur;
}

/** Zero-based index of the measure containing `tick`. */
function measureIndexAtTick(tick) {
    if (tick <= 0) return 0;
    let idx = 0;
    let cur = 0;
    let guard = 0;
    const maxGuard = 2000000;
    while (guard++ < maxGuard) {
        const tpm = ticksPerMeasureAtTick(cur);
        if (tpm <= 0) return idx;
        if (tick < cur + tpm) return idx;
        cur += tpm;
        idx++;
    }
    return idx;
}

function getEndMeasureTick() {
    const endTick = getEndTick();
    if (endTick === 0) return 0;
    const start = measureStartTickContaining(endTick);
    const tpm = ticksPerMeasureAtTick(start);
    return start + tpm;
}

function sortTempoChanges() {
    state.tempoChanges.sort((a, b) => a.tick - b.tick || 0);
}
function sortTimeSigChanges() {
    state.timeSigChanges.sort((a, b) => a.tick - b.tick || 0);
}

/** Wall-clock seconds from tick 0 to absTick (editor timeline; respects tempo map). */
function wallSecondsFromTick(absTick) {
    if (absTick <= 0) return 0;
    let sec = 0;
    let pos = 0;
    let bpm = state.bpm;
    let i = 0;
    const changes = state.tempoChanges;
    while (pos < absTick) {
        let next = absTick;
        if (i < changes.length && changes[i].tick > pos) {
            next = Math.min(next, changes[i].tick);
        }
        const dur = next - pos;
        const tps = (bpm / 60) * MIDI_TPQN;
        if (tps > 0) sec += dur / tps;
        pos = next;
        if (pos >= absTick) break;
        while (i < changes.length && changes[i].tick <= pos) {
            bpm = changes[i].bpm;
            i++;
        }
    }
    return sec;
}

/** Inverse of wallSecondsFromTick for monotonic timeline (binary search); returns fractional tick. */
function tickFromWallSeconds(wallSec) {
    if (wallSec <= 0) return 0;
    let hi = Math.max(MIDI_TPQN * 4, getEndTick() + MIDI_TPQN);
    let guard = 0;
    while (wallSecondsFromTick(hi) < wallSec && hi < 1e12 && guard++ < 64) {
        hi *= 2;
    }
    let lo = 0;
    for (let iter = 0; iter < 80; iter++) {
        const mid = (lo + hi) / 2;
        if (wallSecondsFromTick(mid) < wallSec) lo = mid;
        else hi = mid;
    }
    return hi;
}

/**
 * Hit test conductor markers on the playback header (uses Y to separate BPM vs TS when both share a tick).
 * @param {number} localX X within the playback header canvas (horizontal mode: add scroll via caller)
 * @param {number} localY Y within the playback header canvas (0 = top)
 * @returns {{ kind: 'bpm' | 'ts', tick: number } | null}
 */
function pickConductorMarkerAtPlaybackHeader(localX, localY) {
    if (!conductorTrackVisible()) return null;
    const thresholdPx = 8;
    let best = null;
    let bestPri = Infinity;
    if (state.verticalPianoRoll) {
        const h = state.gridHeight;
        const seamY = h - 1;
        const pan = state.verticalTimePanPx;
        const pb = state.playbackTick;
        const half = VERTICAL_PLAYBACK_STRIP_WIDTH / 2;
        for (const e of state.tempoChanges) {
            const yMark = seamY - (e.tick - pb) * SNAP_WIDTH + pan;
            const d = Math.abs(yMark - localY);
            if (d > thresholdPx) continue;
            let pri = d;
            if (localX >= half) pri += 5;
            if (pri < bestPri) {
                bestPri = pri;
                best = { kind: 'bpm', tick: e.tick };
            }
        }
        for (const e of state.timeSigChanges) {
            const yMark = seamY - (e.tick - pb) * SNAP_WIDTH + pan;
            const d = Math.abs(yMark - localY);
            if (d > thresholdPx) continue;
            let pri = d;
            if (localX < half) pri += 5;
            if (pri < bestPri) {
                bestPri = pri;
                best = { kind: 'ts', tick: e.tick };
            }
        }
        return best;
    }
    const gx = localX + getPlaybackHeaderScrollPx();
    for (const e of state.tempoChanges) {
        const d = Math.abs(e.tick * SNAP_WIDTH - gx);
        if (d > thresholdPx) continue;
        let pri = d;
        if (localY >= 11) pri += 5;
        if (pri < bestPri) {
            bestPri = pri;
            best = { kind: 'bpm', tick: e.tick };
        }
    }
    for (const e of state.timeSigChanges) {
        const d = Math.abs(e.tick * SNAP_WIDTH - gx);
        if (d > thresholdPx) continue;
        let pri = d;
        if (localY < 11) pri += 5;
        if (pri < bestPri) {
            bestPri = pri;
            best = { kind: 'ts', tick: e.tick };
        }
    }
    return best;
}

setSnapGridPower(state.snapGridPower);
