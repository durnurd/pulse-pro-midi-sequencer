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
function noteFromY(gy) { return TOTAL_MIDI_NOTES - 1 - Math.floor(gy / NOTE_HEIGHT); }

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
    const h = ht(x, y);
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
        canvas.style.cursor = 'move'; audioEngine.noteOn(h.note.note, h.note.channel); updateHighlightedKeys();
    }
}

// Mousedown
canvas.addEventListener('mousedown', function(e) {
    audioEngine.init(); const { x, y } = gc(e); const nn = noteFromY(y);
    if (e.button === 2) { const h = ht(x, y); if (h.note) { pushUndoState('delete note'); removeNote(h.note.id); renderAll(); } return; }
    if (e.button !== 0) return;
    if (state.conductorPlacementMode && !state.conductor.locked) {
        const tick = Math.max(0, snapTick(x));
        if (typeof window.openConductorValuePrompt === 'function') window.openConductorValuePrompt(tick);
        return;
    }
    // Eraser
    if (state.activeTool === 'eraser') {
        pushUndoState('erase notes');
        state.mode = 'erasing'; state.interactionData = { erasedIds: new Set() };
        const h = ht(x, y);
        if (h.note) { state.interactionData.erasedIds.add(h.note.id); removeNote(h.note.id); renderAll(); }
        return;
    }
    // Pencil: if clicking on an existing note, behave like cursor (resize/move)
    if (state.activeTool === 'pencil') {
        const h = ht(x, y);
        if (h.type !== 'empty') {
            beginNoteEdit(h, x, y, e);
            renderAll(); return;
        }
        // Empty space: create a new note
        const tick = Math.max(0, snapTick(x));
        if (nn < 0 || nn > 127) return;
        const nnPlace = keyLockPlacementPitchOrNull(nn, e.shiftKey, state.keySignature);
        if (nnPlace === null) return;
        pushUndoState('add note');
        const n = addNote(nnPlace, state.activeChannel, tick, TICKS_PER_SNAP, lastVelocityForNote(nnPlace));
        state.mode = 'placing'; state.interactionNote = n;
        state.interactionData = { originTick: tick };
        state.selectedNoteIds.clear(); state.selectedNoteIds.add(n.id);
        audioEngine.noteOn(nnPlace, state.activeChannel); updateHighlightedKeys(); renderAll(); return;
    }
    // Cursor
    const h = ht(x, y);
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

// Move drag
function moveDrag(gx, gy, shiftHeld) {
    const d = state.interactionData, dx = gx - d.startMouseX, dy = gy - d.startMouseY;
    if (!d.lockedAxis) { if (Math.abs(dx) > 5 || Math.abs(dy) > 5) d.lockedAxis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'; else return; }
    for (const [id, orig] of d.origPositions) { const n = state.notes.find(nn => nn.id === id); if (!n) continue; if (d.lockedAxis === 'h') n.startTick = Math.max(0, orig.startTick + snapTick(dx)); else n.note = Math.max(0, Math.min(127, orig.note - Math.round(dy / NOTE_HEIGHT))); }
    if (d.lockedAxis === 'v' && isKeySignatureActive(state.keySignature) && !shiftHeld) {
        for (const [id, orig] of d.origPositions) {
            const n = state.notes.find(nn => nn.id === id);
            if (n) n.note = snapMidiNoteToKey(n.note, state.keySignature);
        }
    }
    if (d.lockedAxis === 'v') { const mn = state.interactionNote; if (mn.note !== d.lastPreviewNote) { audioEngine.noteOff(d.lastPreviewNote, mn.channel); audioEngine.noteOn(mn.note, mn.channel); d.lastPreviewNote = mn.note; } }
    renderAll();
}

// Global mousemove
document.addEventListener('mousemove', function(e) {
    if (state.mode === 'idle') return;
    const r = canvas.getBoundingClientRect(), gx = e.clientX - r.left + state.scrollX, gy = e.clientY - r.top + state.scrollY;
    if (state.mode === 'placing') { const n = state.interactionNote; n.durationTicks = Math.max(TICKS_PER_SNAP, Math.max(state.interactionData.originTick, snapTick(gx)) - n.startTick + TICKS_PER_SNAP); updateHighlightedKeys(); renderAll(); }
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
    else if (state.mode === 'moving') { moveDrag(gx, gy, e.shiftKey); updateHighlightedKeys(); }
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
    else if (state.mode === 'erasing') { const h = ht(gx, gy); if (h.note && !state.interactionData.erasedIds.has(h.note.id)) { state.interactionData.erasedIds.add(h.note.id); removeNote(h.note.id); renderAll(); } }
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
        if (state.interactionNote) audioEngine.noteOff(state.interactionNote.note, state.interactionNote.channel);
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
        if (state.interactionNote) { audioEngine.noteOff(state.interactionNote.note, state.interactionNote.channel); if (state.interactionData && state.interactionData.lastPreviewNote !== undefined) audioEngine.noteOff(state.interactionData.lastPreviewNote, state.interactionNote.channel); }
        finalizeVelocity();
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

