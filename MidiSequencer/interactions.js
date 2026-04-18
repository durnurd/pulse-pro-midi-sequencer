// interactions.js - Grid mouse interactions
(function() {
const canvas = document.getElementById('grid-canvas');

// Custom eraser cursor (data URI)
const ERASER_CURSOR = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'%3E%3Crect x=\'4\' y=\'8\' width=\'16\' height=\'12\' rx=\'2\' fill=\'%23e94560\' stroke=\'%23fff\' stroke-width=\'1.5\'/%3E%3Crect x=\'4\' y=\'8\' width=\'16\' height=\'5\' rx=\'1\' fill=\'%23ff6b81\' stroke=\'%23fff\' stroke-width=\'1.5\'/%3E%3C/svg%3E") 12 16, pointer';

function updateHighlightedKeys() {
    state.highlightedKeys.clear();
    if (state.mode === 'placing' && state.interactionNote) {
        state.highlightedKeys.add(state.interactionNote.note);
    } else if (state.mode === 'moving' && state.interactionData) {
        for (const id of state.selectedNoteIds) {
            const n = state.notes.find(nn => nn.id === id);
            if (n) state.highlightedKeys.add(n.note);
        }
    } else if ((state.mode === 'resizing-left' || state.mode === 'resizing-right') && state.interactionNote) {
        state.highlightedKeys.add(state.interactionNote.note);
    } else if ((state.mode === 'pb-drag-left' || state.mode === 'pb-drag-right' || state.mode === 'pb-drag-center') && state.interactionNote) {
        state.highlightedKeys.add(state.interactionNote.note);
    }
}
function gc(e) {
    const r = canvas.getBoundingClientRect();
    return gridPointerToWorld(e.clientX - r.left, e.clientY - r.top);
}
function ht(gx, gy) {
    const note = getNoteAt(gx, gy); if (!note) return { type: 'empty', note: null };
    const nx = note.startTick * SNAP_WIDTH, nw = note.durationTicks * SNAP_WIDTH, rx = gx - nx;
    if (rx < EDGE_THRESHOLD) return { type: 'edge-left', note };
    if (rx > nw - EDGE_THRESHOLD) return { type: 'edge-right', note };
    return { type: 'body', note };
}

function htGridFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    const lx = e.clientX - r.left;
    const ly = e.clientY - r.top;
    const gx = lx + state.scrollX;
    const gy = ly + state.scrollY;
    if (typeof pitchBendHandleHitTestUnified === 'function') {
        const pbh = pitchBendHandleHitTestUnified(lx, ly);
        if (pbh) return pbh;
    }
    const h = ht(gx, gy);
    if (typeof isPitchBendOverlay === 'function' && isPitchBendOverlay()
        && (state.activeTool === 'cursor' || state.activeTool === 'pencil')
        && h.note && (h.type === 'edge-left' || h.type === 'edge-right')) {
        return { type: 'body', note: h.note };
    }
    return h;
}

function noteFromY(gy) { return TOTAL_MIDI_NOTES - 1 - Math.floor(gy / NOTE_HEIGHT); }

function foolsBlockPlacedPitchIfNeeded(midiNote) {
    if (typeof window.pulseProFoolsShouldBlockMiddleC === 'function' && window.pulseProFoolsShouldBlockMiddleC(midiNote)) {
        if (typeof window.pulseProFoolsShowUpgradeDialog === 'function') window.pulseProFoolsShowUpgradeDialog('middleC');
        return true;
    }
    if (typeof window.pulseProFoolsShouldBlockBlackKey === 'function' && window.pulseProFoolsShouldBlockBlackKey(midiNote)) {
        if (typeof window.pulseProFoolsShowUpgradeDialog === 'function') window.pulseProFoolsShowUpgradeDialog('blackKeys');
        return true;
    }
    return false;
}

// Hover cursor
canvas.addEventListener('mousemove', function(e) {
    const { x, y } = gc(e);
    if (state.conductorPlacementMode && !state.conductor.locked) {
        state.conductorPlacementHoverTick = Math.max(0, snapTick(x));
        renderAll();
    }
    if (state.mode !== 'idle') return;
    if (state.activeTool === 'eraser') { canvas.style.cursor = ERASER_CURSOR; return; }
    // Both cursor and pencil show resize/move cursors on existing notes
    const h = htGridFromEvent(e);
    if ((state.activeTool === 'cursor' || state.activeTool === 'pencil') && typeof isPitchBendOverlay === 'function' && isPitchBendOverlay()
        && (h.type === 'pb-handle-left' || h.type === 'pb-handle-right')) {
        canvas.style.cursor = 'ns-resize';
        return;
    }
    if ((state.activeTool === 'cursor' || state.activeTool === 'pencil') && typeof isPitchBendOverlay === 'function' && isPitchBendOverlay()
        && h.type === 'pb-handle-center') {
        canvas.style.cursor = 'move';
        return;
    }
    if (h.type === 'edge-left' || h.type === 'edge-right') canvas.style.cursor = 'ew-resize';
    else if (h.type === 'body') canvas.style.cursor = 'move';
    else canvas.style.cursor = state.activeTool === 'pencil' ? 'crosshair' : 'default';
});

// Find the last velocity used for a given MIDI note number (for new note placement)
function lastVelocityForNote(midiNote) {
    for (let i = state.notes.length - 1; i >= 0; i--) {
        if (state.notes[i].note === midiNote) return state.notes[i].velocity ?? 100;
    }
    return 100;
}

// Dblclick place (cursor only)
canvas.addEventListener('dblclick', function(e) {
    if (state.conductorPlacementMode) return;
    if (e.button !== 0 || state.activeTool !== 'cursor') return;
    audioEngine.init(); const { x, y } = gc(e);
    const tick = Math.max(0, snapTick(x)), nnRaw = noteFromY(y);
    if (nnRaw < 0 || nnRaw > 127) return;
    const nn = keyLockPlacementPitchOrNull(nnRaw, e.shiftKey, state.keySignature);
    if (nn === null) return;
    if (foolsBlockPlacedPitchIfNeeded(nn)) return;
    pushUndoState('add note');
    const n = addNote(nn, state.activeChannel, tick, TICKS_PER_SNAP, lastVelocityForNote(nn));
    state.mode = 'placing'; state.interactionNote = n;
    state.interactionData = { originTick: tick };
    state.selectedNoteIds.clear(); state.selectedNoteIds.add(n.id);
    audioEngine.noteOn(nn, state.activeChannel); updateHighlightedKeys(); renderAll();
});

// Update selection for a clicked note based on modifier keys.
// Ctrl+click toggles the note; Shift+click adds; plain click selects exclusively.
// Returns false if Ctrl+click deselected the note (caller should skip the edit).
function updateSelectionForClick(noteId, e) {
    if (e.ctrlKey || e.metaKey) {
        // Toggle
        if (state.selectedNoteIds.has(noteId)) {
            state.selectedNoteIds.delete(noteId);
            return false; // deselected — don't start an edit
        }
        state.selectedNoteIds.add(noteId);
        return true;
    }
    if (e.shiftKey) {
        state.selectedNoteIds.add(noteId);
        return true;
    }
    // Plain click: if already selected keep group, otherwise select exclusively
    if (!state.selectedNoteIds.has(noteId)) {
        state.selectedNoteIds.clear();
        state.selectedNoteIds.add(noteId);
    }
    return true;
}

// Switch active track to match a clicked note
function switchToNoteTrack(note) {
    if (note.track === state.activeTrack) return;
    setActiveTrack(note.track);
    if (window.updateChannelListUI) window.updateChannelListUI();
}

// Shared logic for initiating resize/move on an existing note (used by both cursor and pencil)
function beginNoteEdit(h, x, y, e) {
    switchToNoteTrack(h.note);
    if (h.type === 'edge-left') {
        if (!updateSelectionForClick(h.note.id, e)) { renderAll(); return; }
        pushUndoState('resize note');
        state.mode = 'resizing-left'; state.interactionNote = h.note;
        // Store originals for ALL selected notes
        const origNotes = new Map();
        for (const id of state.selectedNoteIds) {
            const n = state.notes.find(nn => nn.id === id);
            if (n) origNotes.set(id, { origStart: n.startTick, origDuration: n.durationTicks });
        }
        state.interactionData = {
            origStart: h.note.startTick, origDuration: h.note.durationTicks,
            origNotes: origNotes
        };
        canvas.style.cursor = 'ew-resize'; audioEngine.noteOn(h.note.note, h.note.channel); updateHighlightedKeys();
    } else if (h.type === 'edge-right') {
        if (!updateSelectionForClick(h.note.id, e)) { renderAll(); return; }
        pushUndoState('resize note');
        state.mode = 'resizing-right'; state.interactionNote = h.note;
        const origNotes = new Map();
        for (const id of state.selectedNoteIds) {
            const n = state.notes.find(nn => nn.id === id);
            if (n) origNotes.set(id, { origStart: n.startTick, origDuration: n.durationTicks });
        }
        state.interactionData = {
            origStart: h.note.startTick, origDuration: h.note.durationTicks,
            origNotes: origNotes
        };
        canvas.style.cursor = 'ew-resize'; audioEngine.noteOn(h.note.note, h.note.channel); updateHighlightedKeys();
    } else if (h.type === 'body') {
        if (!updateSelectionForClick(h.note.id, e)) { renderAll(); return; }
        pushUndoState('move note');
        state.mode = 'moving'; state.interactionNote = h.note;
        state.interactionData = { startMouseX: x, startMouseY: y, origPositions: new Map(), lockedAxis: null, lastPreviewNote: h.note.note };
        for (const id of state.selectedNoteIds) { const n = state.notes.find(nn => nn.id === id); if (n) state.interactionData.origPositions.set(id, { startTick: n.startTick, note: n.note }); }
        const pbPay = buildPitchBendMovePayload(state.interactionData.origPositions);
        if (pbPay) {
            state.interactionData.pbMoveSnapshot = pbPay.snapshot;
            state.interactionData.pbMoveOwner = pbPay.owner;
        }
        canvas.style.cursor = 'move'; audioEngine.noteOn(h.note.note, h.note.channel); updateHighlightedKeys();
    }
}

// Mousedown
canvas.addEventListener('mousedown', function(e) {
    audioEngine.init(); const { x, y } = gc(e); const nn = noteFromY(y);
    if (e.button === 2) {
        const h = htGridFromEvent(e);
        if (typeof isPitchBendOverlay === 'function' && isPitchBendOverlay()
            && (state.activeTool === 'cursor' || state.activeTool === 'pencil')
            && h.note && (h.type === 'pb-handle-left' || h.type === 'pb-handle-right' || h.type === 'pb-handle-center')) {
            pushUndoState('pitch bend');
            if (typeof window.pitchBendRightClickHandle === 'function') {
                window.pitchBendRightClickHandle(h);
            }
            if (typeof window.playbackResyncAutomationIndicesAfterRecord === 'function') {
                window.playbackResyncAutomationIndicesAfterRecord();
            }
            renderAll();
            return;
        }
        if (h.note) { pushUndoState('delete note'); removeNote(h.note.id); renderAll(); }
        return;
    }
    if (e.button !== 0) return;
    if (state.conductorPlacementMode && !state.conductor.locked) {
        const tick = Math.max(0, snapTick(x));
        if (typeof window.openConductorValuePrompt === 'function') window.openConductorValuePrompt(tick);
        return;
    }
    // Eraser
    if (state.activeTool === 'eraser') {
        if (typeof window.pulseProFoolsShouldBlockEraser === 'function' && window.pulseProFoolsShouldBlockEraser()) {
            if (typeof window.pulseProFoolsShowUpgradeDialog === 'function') window.pulseProFoolsShowUpgradeDialog('eraser');
            return;
        }
        pushUndoState('erase notes');
        state.mode = 'erasing'; state.interactionData = { erasedIds: new Set() };
        const h = htGridFromEvent(e);
        if (h.note) { state.interactionData.erasedIds.add(h.note.id); removeNote(h.note.id); renderAll(); }
        return;
    }
    // Pencil: if clicking on an existing note, behave like cursor (resize/move)
    if (state.activeTool === 'pencil') {
        const h = htGridFromEvent(e);
        if (h.type === 'pb-handle-left' || h.type === 'pb-handle-right') {
            switchToNoteTrack(h.note);
            if (!updateSelectionForClick(h.note.id, e)) { renderAll(); return; }
            pushUndoState('pitch bend');
            state.mode = h.type === 'pb-handle-left' ? 'pb-drag-left' : 'pb-drag-right';
            state.interactionNote = h.note;
            const r0 = canvas.getBoundingClientRect();
            const gy0 = e.clientY - r0.top + state.scrollY;
            state.interactionData = pitchBendBuildHandleDragState(h.note, h.type === 'pb-handle-left' ? 'left' : 'right', gy0);
            canvas.style.cursor = 'ns-resize';
            updateHighlightedKeys(); renderAll(); return;
        }
        if (h.type === 'pb-handle-center') {
            switchToNoteTrack(h.note);
            if (!updateSelectionForClick(h.note.id, e)) { renderAll(); return; }
            pushUndoState('pitch bend');
            state.mode = 'pb-drag-center';
            state.interactionNote = h.note;
            state.interactionData = pitchBendBuildCenterDragState(h.note, x, y);
            if (typeof window.pitchBendApplyCenterHandleDrag === 'function') {
                window.pitchBendApplyCenterHandleDrag(state.interactionData, x, y);
            }
            if (typeof window.playbackResyncAutomationIndicesAfterRecord === 'function') {
                window.playbackResyncAutomationIndicesAfterRecord();
            }
            canvas.style.cursor = 'move';
            updateHighlightedKeys(); renderAll(); return;
        }
        if (h.type !== 'empty') {
            beginNoteEdit(h, x, y, e);
            renderAll(); return;
        }
        // Empty space: create a new note
        const tick = Math.max(0, snapTick(x));
        if (nn < 0 || nn > 127) return;
        const nnPlace = keyLockPlacementPitchOrNull(nn, e.shiftKey, state.keySignature);
        if (nnPlace === null) return;
        if (foolsBlockPlacedPitchIfNeeded(nnPlace)) return;
        pushUndoState('add note');
        const n = addNote(nnPlace, state.activeChannel, tick, TICKS_PER_SNAP, lastVelocityForNote(nnPlace));
        state.mode = 'placing'; state.interactionNote = n;
        state.interactionData = { originTick: tick };
        if (typeof isPitchBendOverlay === 'function' && isPitchBendOverlay()) {
            const rPl = canvas.getBoundingClientRect();
            state.interactionData.placeBendStartGy = e.clientY - rPl.top + state.scrollY;
            state.interactionData.placeBendAccDy = 0;
            state.interactionData.placeBendVPre = samplePitchBendValue14BeforeTick(n.channel, n.startTick);
            state.interactionData.placeBendTailBackup = state.pitchBends
                .filter(e => e.channel === n.channel && e.tick >= n.startTick)
                .map(e => ({ tick: e.tick, channel: e.channel, value: e.value }));
            state.interactionData.placeBendLastPreviewValue14 = null;
            if (typeof window.pitchBendSyncPlacementRamp === 'function') {
                window.pitchBendSyncPlacementRamp(n, state.interactionData);
            }
            if (typeof window.playbackResyncAutomationIndicesAfterRecord === 'function') {
                window.playbackResyncAutomationIndicesAfterRecord();
            }
        }
        state.selectedNoteIds.clear(); state.selectedNoteIds.add(n.id);
        audioEngine.noteOn(nnPlace, state.activeChannel); updateHighlightedKeys(); renderAll(); return;
    }
    // Cursor
    const h = htGridFromEvent(e);
    if (h.type === 'pb-handle-left' || h.type === 'pb-handle-right') {
        switchToNoteTrack(h.note);
        if (!updateSelectionForClick(h.note.id, e)) { renderAll(); return; }
        pushUndoState('pitch bend');
        state.mode = h.type === 'pb-handle-left' ? 'pb-drag-left' : 'pb-drag-right';
        state.interactionNote = h.note;
        const r1 = canvas.getBoundingClientRect();
        const gy1 = e.clientY - r1.top + state.scrollY;
        state.interactionData = pitchBendBuildHandleDragState(h.note, h.type === 'pb-handle-left' ? 'left' : 'right', gy1);
        canvas.style.cursor = 'ns-resize';
        updateHighlightedKeys(); renderAll(); return;
    }
    if (h.type === 'pb-handle-center') {
        switchToNoteTrack(h.note);
        if (!updateSelectionForClick(h.note.id, e)) { renderAll(); return; }
        pushUndoState('pitch bend');
        state.mode = 'pb-drag-center';
        state.interactionNote = h.note;
        state.interactionData = pitchBendBuildCenterDragState(h.note, x, y);
        if (typeof window.pitchBendApplyCenterHandleDrag === 'function') {
            window.pitchBendApplyCenterHandleDrag(state.interactionData, x, y);
        }
        if (typeof window.playbackResyncAutomationIndicesAfterRecord === 'function') {
            window.playbackResyncAutomationIndicesAfterRecord();
        }
        canvas.style.cursor = 'move';
        updateHighlightedKeys(); renderAll(); return;
    }
    if (h.type !== 'empty') {
        beginNoteEdit(h, x, y, e);
    } else {
        const additive = e.shiftKey || e.ctrlKey || e.metaKey;
        const toggleMode = e.ctrlKey || e.metaKey; // Ctrl+drag toggles items in rect
        const priorSelection = additive ? new Set(state.selectedNoteIds) : new Set();
        if (!additive) state.selectedNoteIds.clear();
        state.mode = 'selecting'; state.interactionData = { startX: x, startY: y, currentX: x, currentY: y, priorSelection, toggleMode };
    }
    renderAll();
});

/** When pitch bend note mode is on, capture pitch-bend events under selected notes for live tick shifts during move. */
function buildPitchBendMovePayload(origPositions) {
    if (!state.pitchBendNoteMode || !origPositions || origPositions.size === 0) return null;
    const owner = new Map();
    for (const [id, orig] of origPositions) {
        const n = state.notes.find(nn => nn.id === id);
        if (!n) continue;
        const t0 = orig.startTick | 0;
        const dur = n.durationTicks | 0;
        const tEnd = t0 + dur; // [t0, tEnd) interior; restore event sits at tEnd (see ensurePitchRestoreAfterNote)
        const ch = n.channel | 0;
        for (const e of state.pitchBends) {
            const ec = e.channel | 0;
            if (ec !== ch) continue;
            const et = e.tick | 0;
            const inSpan = (et >= t0 && et < tEnd) || et === tEnd;
            if (!inSpan) continue;
            const k = ec + ':' + et;
            if (!owner.has(k)) owner.set(k, id);
        }
    }
    return {
        snapshot: state.pitchBends.map(e => ({ tick: e.tick | 0, channel: e.channel | 0, value: e.value | 0 })),
        owner,
    };
}

/** Rebuild state.pitchBends from mousedown snapshot, shifting ticks for bends owned by moved notes. */
function applyPitchBendsAfterNoteMove(d) {
    if (!d.pbMoveSnapshot) return;
    const snap = d.pbMoveSnapshot;
    const owner = d.pbMoveOwner;
    const out = snap.map(function(e) {
        const k = (e.channel | 0) + ':' + (e.tick | 0);
        if (!owner || !owner.has(k)) {
            return { tick: e.tick | 0, channel: e.channel | 0, value: e.value | 0 };
        }
        const nid = owner.get(k);
        const orig = d.origPositions.get(nid);
        const n = state.notes.find(nn => nn.id === nid);
        if (!orig || !n) {
            return { tick: e.tick | 0, channel: e.channel | 0, value: e.value | 0 };
        }
        const dt = (n.startTick | 0) - (orig.startTick | 0);
        return { tick: Math.max(0, (e.tick | 0) + dt), channel: e.channel | 0, value: e.value | 0 };
    });
    out.sort((a, b) => a.tick - b.tick || a.channel - b.channel);
    state.pitchBends = out;
}

/**
 * After a pitch-bend-aware move, remove stray pitch bends inside each moved note's new time span
 * on that channel that were not produced from the moved snapshot (e.g. different tick resolution).
 */
function discardLeftoverPitchBendsAfterMoveComplete(d) {
    if (!d.pbMoveSnapshot || !d.pbMoveOwner || !d.origPositions) return;
    const snap = d.pbMoveSnapshot;
    const owner = d.pbMoveOwner;
    const expectedCounts = new Map();
    for (let i = 0; i < snap.length; i++) {
        const e = snap[i];
        const kOrig = (e.channel | 0) + ':' + (e.tick | 0);
        if (!owner.has(kOrig)) continue;
        const nid = owner.get(kOrig);
        const orig = d.origPositions.get(nid);
        const n = state.notes.find(nn => nn.id === nid);
        if (!orig || !n) continue;
        const dt = (n.startTick | 0) - (orig.startTick | 0);
        const newTick = Math.max(0, (e.tick | 0) + dt);
        const ec = e.channel | 0;
        const ev = e.value | 0;
        const key3 = ec + ':' + newTick + ':' + ev;
        expectedCounts.set(key3, (expectedCounts.get(key3) || 0) + 1);
    }
    function tickInsideMovedNoteSpan(ec, et) {
        for (const id of d.origPositions.keys()) {
            const n = state.notes.find(nn => nn.id === id);
            if (!n) continue;
            if ((n.channel | 0) !== (ec | 0)) continue;
            const t0 = n.startTick | 0;
            const tEnd = t0 + (n.durationTicks | 0);
            if ((et >= t0 && et < tEnd) || et === tEnd) return true;
        }
        return false;
    }
    state.pitchBends = state.pitchBends.filter(function(e) {
        const ec = e.channel | 0;
        const et = e.tick | 0;
        const ev = e.value | 0;
        const key3 = ec + ':' + et + ':' + ev;
        const need = expectedCounts.get(key3) || 0;
        if (need > 0) {
            expectedCounts.set(key3, need - 1);
            return true;
        }
        if (tickInsideMovedNoteSpan(ec, et)) return false;
        return true;
    });
    state.pitchBends.sort((a, b) => a.tick - b.tick || a.channel - b.channel);
}

// Move drag: free X+Y by default; hold Shift to lock to horizontal or vertical (dominant axis after 5px).
// While Shift-locked, the suppressed axis stays at mousedown values (orig), not the in-progress drag position.
// Alt bypasses key-signature pitch snap while dragging (Shift is reserved for axis lock).
function moveDrag(gx, gy, shiftHeld, altHeld) {
    const d = state.interactionData, dx = gx - d.startMouseX, dy = gy - d.startMouseY;
    if (shiftHeld) {
        if (!d.lockedAxis) {
            if (Math.abs(dx) <= 5 && Math.abs(dy) <= 5) return;
            d.lockedAxis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
        }
    } else {
        d.lockedAxis = null;
    }
    const dySteps = Math.round(dy / NOTE_HEIGHT);
    for (const [id, orig] of d.origPositions) {
        const n = state.notes.find(nn => nn.id === id);
        if (!n) continue;
        if (!shiftHeld) {
            n.startTick = Math.max(0, orig.startTick + snapTick(dx));
            n.note = Math.max(0, Math.min(127, orig.note - dySteps));
        } else if (d.lockedAxis === 'h') {
            n.startTick = Math.max(0, orig.startTick + snapTick(dx));
            n.note = orig.note;
        } else if (d.lockedAxis === 'v') {
            n.startTick = Math.max(0, orig.startTick);
            n.note = Math.max(0, Math.min(127, orig.note - dySteps));
        }
    }
    const verticalDragActive = !shiftHeld || d.lockedAxis === 'v';
    const applyKeySnap = verticalDragActive && isKeySignatureActive(state.keySignature) && !altHeld
        && ((shiftHeld && d.lockedAxis === 'v') || (!shiftHeld && dySteps !== 0));
    if (applyKeySnap) {
        for (const id of d.origPositions.keys()) {
            const n = state.notes.find(nn => nn.id === id);
            if (n) n.note = snapMidiNoteToKey(n.note, state.keySignature);
        }
    }
    if (typeof window.pulseProFoolsShouldBlockMiddleC === 'function') {
        let dialogFeature = null;
        for (const [id, orig] of d.origPositions) {
            const n = state.notes.find(nn => nn.id === id);
            if (!n) continue;
            let revert = false;
            if (window.pulseProFoolsShouldBlockMiddleC(n.note)) {
                revert = true;
                dialogFeature = dialogFeature || 'middleC';
            } else if (typeof window.pulseProFoolsShouldBlockBlackKey === 'function' && window.pulseProFoolsShouldBlockBlackKey(n.note)) {
                revert = true;
                dialogFeature = dialogFeature || 'blackKeys';
            }
            if (revert) {
                n.startTick = orig.startTick;
                n.note = orig.note;
            }
        }
        if (dialogFeature && typeof window.pulseProFoolsShowUpgradeDialog === 'function') {
            window.pulseProFoolsShowUpgradeDialog(dialogFeature);
        }
    }
    if (d.pbMoveSnapshot) {
        applyPitchBendsAfterNoteMove(d);
    }
    const mn = state.interactionNote;
    if (mn.note !== d.lastPreviewNote) {
        audioEngine.noteOff(d.lastPreviewNote, mn.channel);
        audioEngine.noteOn(mn.note, mn.channel);
        d.lastPreviewNote = mn.note;
    }
    renderAll();
}

// Global mousemove
document.addEventListener('mousemove', function(e) {
    if (state.mode === 'idle') return;
    const r = canvas.getBoundingClientRect(), gx = e.clientX - r.left + state.scrollX, gy = e.clientY - r.top + state.scrollY;
    if (state.mode === 'placing') {
        const n = state.interactionNote;
        n.durationTicks = Math.max(TICKS_PER_SNAP, Math.max(state.interactionData.originTick, snapTick(gx)) - n.startTick + TICKS_PER_SNAP);
        if (typeof isPitchBendOverlay === 'function' && isPitchBendOverlay() && state.activeTool === 'pencil'
            && state.interactionData && state.interactionData.placeBendStartGy != null) {
            state.interactionData.placeBendAccDy = gy - state.interactionData.placeBendStartGy;
            if (typeof window.pitchBendSyncPlacementRamp === 'function') {
                window.pitchBendSyncPlacementRamp(n, state.interactionData);
            }
            if (typeof window.playbackResyncAutomationIndicesAfterRecord === 'function') {
                window.playbackResyncAutomationIndicesAfterRecord();
            }
        }
        updateHighlightedKeys(); renderAll();
    }
    else if (state.mode === 'resizing-right') {
        // Compute delta from the primary (clicked) note's original end
        const d = state.interactionData;
        const newEnd = snapTick(gx);
        const delta = newEnd - (d.origStart + d.origDuration);
        // Apply delta to all selected notes, allowing virtual negative durations
        for (const [id, orig] of d.origNotes) {
            const n = state.notes.find(nn => nn.id === id);
            if (!n) continue;
            n.durationTicks = Math.max(0, orig.origDuration + delta);
        }
        updateHighlightedKeys(); renderAll();
    }
    else if (state.mode === 'resizing-left') {
        const d = state.interactionData;
        const newStart = snapTick(gx);
        const delta = newStart - d.origStart;
        for (const [id, orig] of d.origNotes) {
            const n = state.notes.find(nn => nn.id === id);
            if (!n) continue;
            const newS = Math.max(0, orig.origStart + delta);
            const actualDelta = newS - orig.origStart;
            n.startTick = newS;
            n.durationTicks = Math.max(0, orig.origDuration - actualDelta);
        }
        updateHighlightedKeys(); renderAll();
    }
    else if (state.mode === 'moving') { moveDrag(gx, gy, e.shiftKey, e.altKey); updateHighlightedKeys(); }
    else if (state.mode === 'selecting') {
        state.interactionData.currentX = gx; state.interactionData.currentY = gy;
        const d = state.interactionData;
        const rectNotes = getNotesInRect(d.startX, d.startY, d.currentX, d.currentY);
        const rectIds = new Set(rectNotes.map(n => n.id));
        state.selectedNoteIds.clear();
        for (const id of d.priorSelection) {
            if (d.toggleMode && rectIds.has(id)) continue; // toggle off: was selected, now in rect
            state.selectedNoteIds.add(id);
        }
        for (const n of rectNotes) {
            if (d.toggleMode && d.priorSelection.has(n.id)) continue; // already handled above
            state.selectedNoteIds.add(n.id);
        }
        renderAll();
    }
    else if (state.mode === 'erasing') { const h = htGridFromEvent(e); if (h.note && !state.interactionData.erasedIds.has(h.note.id)) { state.interactionData.erasedIds.add(h.note.id); removeNote(h.note.id); renderAll(); } }
    else if (state.mode === 'pb-drag-left' || state.mode === 'pb-drag-right') {
        pitchBendApplyHandleDragFromMouseGy(state.interactionData, gy);
        if (typeof window.playbackResyncAutomationIndicesAfterRecord === 'function') {
            window.playbackResyncAutomationIndicesAfterRecord();
        }
        renderAll();
    }
    else if (state.mode === 'pb-drag-center' && state.interactionData) {
        const wp = gridPointerToWorld(e.clientX - r.left, e.clientY - r.top);
        if (typeof window.pitchBendApplyCenterHandleDrag === 'function') {
            window.pitchBendApplyCenterHandleDrag(state.interactionData, wp.x, wp.y);
        }
        if (typeof window.playbackResyncAutomationIndicesAfterRecord === 'function') {
            window.playbackResyncAutomationIndicesAfterRecord();
        }
        renderAll();
    }
});

// Finalize velocity: clamp virtual velocities to 0-127 on edit completion
function finalizeVelocity() {
    if (state.interactionData && state.interactionData.velocityEditing) {
        for (const id of state.selectedNoteIds) {
            const n = state.notes.find(nn => nn.id === id);
            if (n) n.velocity = Math.max(0, Math.min(127, n.velocity));
        }
    }
}

// Mouseup
document.addEventListener('mouseup', function(e) {
    if (state.mode === 'placing') {
        if (typeof isPitchBendOverlay === 'function' && isPitchBendOverlay() && state.activeTool === 'pencil'
            && state.interactionNote && state.interactionData
            && state.interactionData.placeBendStartGy != null) {
            const n = state.interactionNote;
            if (typeof window.pitchBendSyncPlacementRamp === 'function') {
                window.pitchBendSyncPlacementRamp(n, state.interactionData);
            }
            if (typeof window.playbackResyncAutomationIndicesAfterRecord === 'function') {
                window.playbackResyncAutomationIndicesAfterRecord();
            }
        }
        if (state.interactionNote) {
            if (state.interactionData && state.interactionData.placeBendVPre != null
                && state.interactionData.placeBendStartGy != null) {
                const v = Math.max(0, Math.min(16383, state.interactionData.placeBendVPre | 0));
                audioEngine.pitchWheel(state.interactionNote.channel, v);
            }
            audioEngine.noteOff(state.interactionNote.note, state.interactionNote.channel);
        }
        finalizeVelocity();
        state.highlightedKeys.clear();
        state.mode = 'idle'; state.interactionNote = null; state.interactionData = null; canvas.style.cursor = 'default'; renderAll();
    } else if (state.mode === 'resizing-left' || state.mode === 'resizing-right') {
        if (state.interactionNote) audioEngine.noteOff(state.interactionNote.note, state.interactionNote.channel);
        finalizeVelocity();
        // Clamp all selected notes that ended up with 0 duration to minimum 1 sixteenth note
        for (const id of state.selectedNoteIds) {
            const n = state.notes.find(nn => nn.id === id);
            if (n && n.durationTicks < TICKS_PER_SNAP) n.durationTicks = TICKS_PER_SNAP;
        }
        state.highlightedKeys.clear();
        state.mode = 'idle'; state.interactionNote = null; state.interactionData = null; canvas.style.cursor = 'default'; renderAll();
    } else if (state.mode === 'moving') {
        const dMove = state.interactionData;
        const hadPbMove = !!(dMove && dMove.pbMoveSnapshot);
        if (state.interactionNote) { audioEngine.noteOff(state.interactionNote.note, state.interactionNote.channel); if (state.interactionData && state.interactionData.lastPreviewNote !== undefined) audioEngine.noteOff(state.interactionData.lastPreviewNote, state.interactionNote.channel); }
        finalizeVelocity();
        state.highlightedKeys.clear();
        if (hadPbMove && dMove) {
            discardLeftoverPitchBendsAfterMoveComplete(dMove);
        }
        state.mode = 'idle'; state.interactionNote = null; state.interactionData = null; canvas.style.cursor = 'default';
        if (hadPbMove && typeof window.playbackResyncAutomationIndicesAfterRecord === 'function') {
            window.playbackResyncAutomationIndicesAfterRecord();
        }
        renderAll();
    } else if (state.mode === 'pb-drag-left' || state.mode === 'pb-drag-right' || state.mode === 'pb-drag-center') {
        if (state.interactionNote) {
            audioEngine.noteOff(state.interactionNote.note, state.interactionNote.channel);
        }
        if (typeof window.playbackResyncAutomationIndicesAfterRecord === 'function') {
            window.playbackResyncAutomationIndicesAfterRecord();
        }
        state.highlightedKeys.clear();
        state.mode = 'idle'; state.interactionNote = null; state.interactionData = null; canvas.style.cursor = 'default'; renderAll();
    } else if (state.mode === 'selecting' || state.mode === 'erasing') {
        state.mode = 'idle'; state.interactionNote = null; state.interactionData = null; canvas.style.cursor = 'default'; renderAll();
    }
});

canvas.addEventListener('contextmenu', function(e) { e.preventDefault(); });

/**
 * Shared grid / expanded-automation horizontal scroll and zoom (mouse X/Y relative to grid canvas coordinates).
 */
function handleSequencerWheelEvent(e, mouseXInGrid, mouseYInGrid) {
    e.preventDefault();
    // During note drag operations, scroll wheel adjusts velocity
    if (state.mode === 'moving' || state.mode === 'placing' || state.mode === 'resizing-left' || state.mode === 'resizing-right') {
        const d = state.interactionData;
        if (!d.velocityEditing) {
            d.velocityEditing = true;
            d.origVelocities = new Map();
            d.virtualVelocities = new Map();
            for (const id of state.selectedNoteIds) {
                const n = state.notes.find(nn => nn.id === id);
                if (n) {
                    d.origVelocities.set(id, n.velocity ?? 100);
                    d.virtualVelocities.set(id, n.velocity ?? 100);
                }
            }
        }
        const step = e.deltaY < 0 ? 5 : -5;
        for (const [id, vv] of d.virtualVelocities) {
            const newVirtual = vv + step;
            d.virtualVelocities.set(id, newVirtual);
            const n = state.notes.find(nn => nn.id === id);
            if (n) n.velocity = Math.max(0, Math.min(127, newVirtual));
        }
        renderAll();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        zoomHorizontal(e.deltaY, mouseXInGrid);
        return;
    }
    if (e.ctrlKey || e.metaKey) {
        zoomVertical(e.deltaY, mouseYInGrid);
        return;
    }
    if (state.verticalPianoRoll) {
        const maxPX = typeof getMaxPitchScrollPx === 'function' ? getMaxPitchScrollPx() : 0;
        state.scrollX = Math.max(0, Math.min(maxPX, state.scrollX + e.deltaX + (e.shiftKey ? e.deltaY : 0)));
        if (typeof window.applyVerticalRollWheelToPlayhead === 'function') {
            window.applyVerticalRollWheelToPlayhead(e.deltaY, e.shiftKey);
        }
        if (typeof clampScrollToViewport === 'function') clampScrollToViewport();
    } else {
        state.scrollX = Math.max(0, state.scrollX + e.deltaX + (e.shiftKey ? e.deltaY : 0));
        state.scrollY = Math.max(0, Math.min(TOTAL_HEIGHT - state.gridHeight, state.scrollY + (e.shiftKey ? 0 : e.deltaY)));
    }
    renderAll();
}
window.handleSequencerWheelEvent = handleSequencerWheelEvent;

canvas.addEventListener('wheel', function(e) {
    const r = canvas.getBoundingClientRect();
    handleSequencerWheelEvent(e, e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'Escape') {
        if (state.conductorPlacementMode) {
            e.preventDefault();
            if (typeof window.cancelConductorInsertUi === 'function') window.cancelConductorInsertUi();
            return;
        }
        state.selectedNoteIds.clear();
        renderAll();
        return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (state.selectedNoteIds.size > 0) { pushUndoState('delete notes'); removeSelectedNotes(); renderAll(); } }
    if (e.key === ' ') { e.preventDefault(); togglePlayPause(); }
    // Arrow keys: Left/Right move playhead by beat, Ctrl+Left/Right by measure, Up/Down scroll
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = (e.ctrlKey || e.metaKey) ? ticksPerMeasureAtTick(Math.max(0, Math.floor(state.playbackTick))) : MIDI_TPQN;
        if (e.key === 'ArrowLeft') {
            // If within the first few ticks of a beat/measure, jump to the start of the previous one
            const nearestBoundary = Math.round(state.playbackTick / step) * step;
            const distFromBoundary = state.playbackTick - nearestBoundary;
            if (distFromBoundary >= 0 && distFromBoundary <= TICKS_PER_SNAP) {
                // On or just past a boundary — go to previous
                state.playbackTick = Math.max(0, nearestBoundary - step);
            } else {
                // Mid-beat — snap back to start of current beat/measure
                state.playbackTick = Math.max(0, Math.floor(state.playbackTick / step) * step);
            }
        } else {
            state.playbackTick = Math.ceil((state.playbackTick + 0.001) / step) * step;
        }
        // Reset playback anchor so playback continues from new position
        state.playbackStartTick = state.playbackTick;
        state.playbackStartTime = performance.now();
        // Auto-scroll to keep playhead in view (horizontal timeline only; vertical ruler is tied to grid pan)
        if (!state.verticalPianoRoll) {
            const pbX = state.playbackTick * SNAP_WIDTH;
            const margin = TICKS_PER_SNAP * SNAP_WIDTH * 2;
            if (pbX < state.scrollX + margin) {
                state.scrollX = Math.max(0, pbX - margin);
            } else if (pbX > state.scrollX + state.gridWidth - margin) {
                state.scrollX = pbX - state.gridWidth + margin;
            }
        }
        renderAll(); return;
    }
    if (e.key === 'Home') {
        e.preventDefault();
        state.playbackTick = 0;
        state.playbackStartTick = 0;
        state.lastMousePlaybackTick = 0;
        state.playbackStartTime = performance.now();
        if (state.verticalPianoRoll) {
            state.verticalTimePanPx = 0;
            state.timelineHeaderScrollPx = 0;
        } else {
            state.scrollX = 0;
        }
        renderAll(); return;
    }
    if (e.key === 'End') {
        e.preventDefault();
        const endTick = getEndMeasureTick();
        state.playbackTick = endTick;
        state.playbackStartTick = endTick;
        state.lastMousePlaybackTick = endTick;
        state.playbackStartTime = performance.now();
        if (state.verticalPianoRoll) {
            state.verticalTimePanPx = 0;
            state.timelineHeaderScrollPx = 0;
        } else {
            const pbX = endTick * SNAP_WIDTH;
            const m = TICKS_PER_SNAP * SNAP_WIDTH * 2;
            state.scrollX = Math.max(0, pbX - state.gridWidth + m);
        }
        renderAll(); return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const scrollStep = NOTE_HEIGHT * 4;
        if (state.verticalPianoRoll) {
            if (!state.isPlaying && typeof window.applyVerticalRollWheelToPlayhead === 'function') {
                const fakeDelta = e.key === 'ArrowDown' ? 120 : -120;
                window.applyVerticalRollWheelToPlayhead(fakeDelta, false);
            }
        } else {
            state.scrollY = Math.max(0, Math.min(TOTAL_HEIGHT - state.gridHeight,
                state.scrollY + (e.key === 'ArrowDown' ? scrollStep : -scrollStep)));
        }
        renderAll(); return;
    }
    if (!(e.ctrlKey || e.metaKey)) {
        if (e.key === 'v' || e.key === 'V') setTool('cursor');
        if (e.key === 'p' || e.key === 'P') setTool('pencil');
        if (e.key === 'e' || e.key === 'E') setTool('eraser');
        if (e.key === 'b' || e.key === 'B') {
            if (typeof window.togglePitchBendNoteModeFromShortcut === 'function') {
                window.togglePitchBendNoteModeFromShortcut();
            }
        }
    }
    if (e.key === '1') setTool('cursor');
    if (e.key === '2') setTool('pencil');
    if (e.key === '3') setTool('eraser');
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
    else if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); redo(); }
    if ((e.ctrlKey || e.metaKey) && key === 'c') {
        e.preventDefault();
        if (typeof tryCopyAutomation === 'function' && tryCopyAutomation()) return;
        void copySelectedNotes();
    }
    if ((e.ctrlKey || e.metaKey) && key === 'v') {
        e.preventDefault();
        if (typeof tryPasteAutomation === 'function' && tryPasteAutomation()) return;
        void pasteNotes();
    }
    if ((e.ctrlKey || e.metaKey) && key === 'a') { e.preventDefault(); state.selectedNoteIds.clear(); for (const n of state.notes) state.selectedNoteIds.add(n.id); renderAll(); }
});
})();

