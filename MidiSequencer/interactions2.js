// interactions2.js - Keyboard panel, playback header, tool switching
(function() {
const kc = document.getElementById('keyboard-canvas');
const pb = document.getElementById('playback-canvas');
let pbDrag = false, kcDragging = false, kcLastNote = -1;
/** @type {null | { kind: string, origTick: number, bpm?: number, numerator?: number, denominator?: number, startClientX: number, moved: boolean }} */
let conductorPbDrag = null;
function noteFromY(gy) { return TOTAL_MIDI_NOTES - 1 - Math.floor(gy / NOTE_HEIGHT); }
function noteFromKeyboardStripLocalX(lx) {
    return Math.max(0, Math.min(TOTAL_MIDI_NOTES - 1, Math.floor((lx + state.scrollX) / NOTE_HEIGHT)));
}

// --- Keyboard panel: click and drag to preview notes ---
kc.addEventListener('mousedown', function(e) {
    audioEngine.init();
    const r = kc.getBoundingClientRect();
    const nn = state.verticalPianoRoll
        ? noteFromKeyboardStripLocalX(e.clientX - r.left)
        : noteFromY(e.clientY - r.top + state.scrollY);
    if (nn < 0 || nn > 127) return;
    if (!keyLockAllowsKeyboardPitch(nn, e.shiftKey, state.keySignature)) return;
    if (typeof window.pulseProFoolsShouldBlockMiddleC === 'function' && window.pulseProFoolsShouldBlockMiddleC(nn)) {
        if (typeof window.pulseProFoolsShowUpgradeDialog === 'function') window.pulseProFoolsShowUpgradeDialog('middleC');
        return;
    }
    if (typeof window.pulseProFoolsShouldBlockBlackKey === 'function' && window.pulseProFoolsShouldBlockBlackKey(nn)) {
        if (typeof window.pulseProFoolsShowUpgradeDialog === 'function') window.pulseProFoolsShowUpgradeDialog('blackKeys');
        return;
    }
    kcDragging = true;
    kcLastNote = nn;
    audioEngine.noteOn(nn, state.activeChannel);
    if (typeof window.pulseProMidiOutNoteOn === 'function') {
        window.pulseProMidiOutNoteOn(nn, state.activeChannel, 100);
    }
    state.highlightedKeys.clear(); state.highlightedKeys.add(nn); renderAll();
});
document.addEventListener('mousemove', function(e) {
    if (!kcDragging) return;
    const r = kc.getBoundingClientRect();
    const nn = state.verticalPianoRoll
        ? noteFromKeyboardStripLocalX(e.clientX - r.left)
        : noteFromY(e.clientY - r.top + state.scrollY);
    if (nn < 0 || nn > 127) return;
    if (!keyLockAllowsKeyboardPitch(nn, e.shiftKey, state.keySignature)) {
        if (kcLastNote >= 0) {
            audioEngine.noteOff(kcLastNote, state.activeChannel);
            if (typeof window.pulseProMidiOutNoteOff === 'function') {
                window.pulseProMidiOutNoteOff(kcLastNote, state.activeChannel);
            }
            kcLastNote = -1;
        }
        state.highlightedKeys.clear();
        renderAll();
        return;
    }
    const foolsPitchBlocked = (typeof window.pulseProFoolsShouldBlockMiddleC === 'function' && window.pulseProFoolsShouldBlockMiddleC(nn))
        || (typeof window.pulseProFoolsShouldBlockBlackKey === 'function' && window.pulseProFoolsShouldBlockBlackKey(nn));
    if (foolsPitchBlocked) {
        if (kcLastNote >= 0) {
            audioEngine.noteOff(kcLastNote, state.activeChannel);
            if (typeof window.pulseProMidiOutNoteOff === 'function') {
                window.pulseProMidiOutNoteOff(kcLastNote, state.activeChannel);
            }
            kcLastNote = -1;
        }
        state.highlightedKeys.clear();
        renderAll();
        return;
    }
    if (nn === kcLastNote) return;
    if (kcLastNote >= 0) {
        audioEngine.noteOff(kcLastNote, state.activeChannel);
        if (typeof window.pulseProMidiOutNoteOff === 'function') {
            window.pulseProMidiOutNoteOff(kcLastNote, state.activeChannel);
        }
    }
    kcLastNote = nn;
    audioEngine.noteOn(nn, state.activeChannel);
    if (typeof window.pulseProMidiOutNoteOn === 'function') {
        window.pulseProMidiOutNoteOn(nn, state.activeChannel, 100);
    }
    state.highlightedKeys.clear(); state.highlightedKeys.add(nn); renderAll();
});
document.addEventListener('mouseup', function(e) {
    if (kcDragging) {
        kcDragging = false;
        if (kcLastNote >= 0) {
            audioEngine.noteOff(kcLastNote, state.activeChannel);
            if (typeof window.pulseProMidiOutNoteOff === 'function') {
                window.pulseProMidiOutNoteOff(kcLastNote, state.activeChannel);
            }
            kcLastNote = -1;
        }
        state.highlightedKeys.clear(); renderAll();
    }
});
kc.addEventListener('wheel', function(e) {
    e.preventDefault();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        zoomHorizontal(e.deltaY, undefined);
        return;
    }
    if (e.ctrlKey || e.metaKey) {
        const r = kc.getBoundingClientRect();
        const mouseAlongPitch = state.verticalPianoRoll ? (e.clientX - r.left) : (e.clientY - r.top);
        zoomVertical(e.deltaY, mouseAlongPitch);
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
        state.scrollY = Math.max(0, Math.min(TOTAL_HEIGHT - state.gridHeight, state.scrollY + e.deltaY));
    }
    renderAll();
}, { passive: false });

// --- Playback header ---
function setPbTick(e) {
    const r = pb.getBoundingClientRect();
    let rawTick;
    if (state.verticalPianoRoll) {
        rawTick = playbackVerticalStripYToTick(e.clientY - r.top);
    } else {
        rawTick = (e.clientX - r.left + getPlaybackHeaderScrollPx()) / SNAP_WIDTH;
    }
    state.playbackTick = Math.max(0, snapTickToGrid(Math.round(rawTick)));
    state.lastMousePlaybackTick = state.playbackTick;
    if (!state.isPlaying) state.playbackStartTick = state.playbackTick;
}
function syncPlayheadPreviewNotes() {
    if (typeof window.pulseProSyncPlayheadPreviewNotes === 'function') {
        window.pulseProSyncPlayheadPreviewNotes();
    }
}
pb.addEventListener('mousemove', function(e) {
    if (!state.conductorPlacementMode || state.conductor.locked) return;
    const r = pb.getBoundingClientRect();
    if (state.verticalPianoRoll) {
        const raw = playbackVerticalStripYToTick(e.clientY - r.top);
        state.conductorPlacementHoverTick = Math.max(0, snapTickToGrid(Math.round(raw)));
    } else {
        const gx = e.clientX - r.left + getPlaybackHeaderScrollPx();
        state.conductorPlacementHoverTick = Math.max(0, snapTick(gx));
    }
    renderAll();
});

pb.addEventListener('mousedown', function(e) {
    audioEngine.init();
    const r = pb.getBoundingClientRect();
    const localX = e.clientX - r.left;
    const localY = e.clientY - r.top;

    if (e.button === 2) {
        e.preventDefault();
        if (!state.conductor.locked && conductorTrackVisible()) {
            const hit = pickConductorMarkerAtPlaybackHeader(localX, localY);
            if (hit) {
                pushUndoState('delete conductor marker');
                if (hit.kind === 'bpm') {
                    state.tempoChanges = state.tempoChanges.filter(function(ev) { return ev.tick !== hit.tick; });
                } else {
                    state.timeSigChanges = state.timeSigChanges.filter(function(ev) { return ev.tick !== hit.tick; });
                }
                if (window.updateChannelListUI) window.updateChannelListUI();
                if (typeof window.reanchorPlaybackClockIfPlaying === 'function') {
                    window.reanchorPlaybackClockIfPlaying();
                }
                renderAll();
                return;
            }
        }
        if (typeof window.getSelection === 'function') window.getSelection().removeAllRanges();
        if (state.verticalPianoRoll) return;
        pbDrag = true;
        if (state.isPlaying) stopPlayback();
        setPbTick(e);
        syncPlayheadPreviewNotes();
        renderAll();
        return;
    }

    if (e.button !== 0) return;

    if (state.conductorPlacementMode && !state.conductor.locked) {
        e.preventDefault();
        if (typeof window.openConductorValuePrompt === 'function') {
            const raw = state.verticalPianoRoll
                ? playbackVerticalStripYToTick(localY)
                : (localX + getPlaybackHeaderScrollPx()) / SNAP_WIDTH;
            window.openConductorValuePrompt(Math.max(0, snapTickToGrid(Math.round(raw))));
        }
        return;
    }

    if (!state.conductor.locked && conductorTrackVisible()) {
        const hit = pickConductorMarkerAtPlaybackHeader(localX, localY);
        if (hit) {
            const ev = hit.kind === 'bpm'
                ? state.tempoChanges.find(function(x) { return x.tick === hit.tick; })
                : state.timeSigChanges.find(function(x) { return x.tick === hit.tick; });
            if (ev) {
                e.preventDefault();
                conductorPbDrag = {
                    kind: hit.kind,
                    origTick: hit.tick,
                    bpm: hit.kind === 'bpm' ? ev.bpm : undefined,
                    numerator: hit.kind === 'ts' ? ev.numerator : undefined,
                    denominator: hit.kind === 'ts' ? ev.denominator : undefined,
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    moved: false,
                };
                state.conductorMarkerDragPreview = {
                    kind: hit.kind,
                    origTick: hit.tick,
                    previewTick: hit.tick,
                };
                renderAll();
                return;
            }
        }
    }

    e.preventDefault();
    if (typeof window.getSelection === 'function') window.getSelection().removeAllRanges();
    if (state.verticalPianoRoll) return;
    pbDrag = true;
    if (state.isPlaying) stopPlayback();
    setPbTick(e);
    syncPlayheadPreviewNotes();
    renderAll();
});
pb.addEventListener('contextmenu', function(e) { e.preventDefault(); });
document.addEventListener('mousemove', function(e) {
    if (conductorPbDrag) {
        e.preventDefault();
        const r = pb.getBoundingClientRect();
        const dx = e.clientX - conductorPbDrag.startClientX;
        const dy = e.clientY - conductorPbDrag.startClientY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) conductorPbDrag.moved = true;
        let nt;
        if (state.verticalPianoRoll) {
            const raw = playbackVerticalStripYToTick(e.clientY - r.top);
            nt = Math.max(1, snapTickToGrid(Math.round(raw)));
        } else {
            const gx = e.clientX - r.left + getPlaybackHeaderScrollPx();
            nt = Math.max(1, snapTick(gx));
        }
        state.conductorMarkerDragPreview = {
            kind: conductorPbDrag.kind,
            origTick: conductorPbDrag.origTick,
            previewTick: nt,
        };
        renderAll();
        return;
    }
    if (!pbDrag) return;
    e.preventDefault();
    setPbTick(e);
    syncPlayheadPreviewNotes();
    renderAll();
});
document.addEventListener('mouseup', function(e) {
    if (conductorPbDrag) {
        const d = conductorPbDrag;
        const preview = state.conductorMarkerDragPreview;
        conductorPbDrag = null;
        state.conductorMarkerDragPreview = null;
        if (d.moved && preview && preview.previewTick !== d.origTick) {
            pushUndoState('move conductor marker');
            if (d.kind === 'bpm') {
                state.tempoChanges = state.tempoChanges.filter(function(ev) { return ev.tick !== d.origTick; });
                state.tempoChanges = state.tempoChanges.filter(function(ev) { return ev.tick !== preview.previewTick; });
                state.tempoChanges.push({ tick: preview.previewTick, bpm: d.bpm });
                sortTempoChanges();
            } else {
                state.timeSigChanges = state.timeSigChanges.filter(function(ev) { return ev.tick !== d.origTick; });
                state.timeSigChanges = state.timeSigChanges.filter(function(ev) { return ev.tick !== preview.previewTick; });
                state.timeSigChanges.push({
                    tick: preview.previewTick,
                    numerator: d.numerator,
                    denominator: d.denominator,
                });
                sortTimeSigChanges();
            }
            if (window.updateChannelListUI) window.updateChannelListUI();
            if (typeof window.reanchorPlaybackClockIfPlaying === 'function') {
                window.reanchorPlaybackClockIfPlaying();
            }
        } else if (!d.moved && typeof window.openConductorMarkerEdit === 'function') {
            window.openConductorMarkerEdit(d.kind, d.origTick);
        }
        renderAll();
        return;
    }
    if (pbDrag) {
        pbDrag = false;
        if (typeof window.getSelection === 'function') window.getSelection().removeAllRanges();
        audioEngine.allNotesOff();
        if (typeof window.pulseProMidiOutAllNotesOff === 'function') {
            window.pulseProMidiOutAllNotesOff();
        }
        state.playbackStartTick = state.playbackTick; renderAll();
    }
});
pb.addEventListener('wheel', function(e) {
    e.preventDefault();
    const r = pb.getBoundingClientRect();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        const mouseAnchor = state.verticalPianoRoll ? (e.clientY - r.top) : (e.clientX - r.left);
        zoomHorizontal(e.deltaY, mouseAnchor);
        return;
    }
    if (e.ctrlKey || e.metaKey) {
        zoomVertical(e.deltaY, undefined);
        return;
    }
    if (state.verticalPianoRoll) {
        state.timelineHeaderScrollPx = Math.max(0, Math.min(
            Math.max(0, typeof getMaxScrollX === 'function' ? getMaxScrollX() : 0),
            state.timelineHeaderScrollPx + e.deltaX + (e.shiftKey ? e.deltaY : 0)));
        if (typeof window.applyVerticalRollWheelToPlayhead === 'function') {
            window.applyVerticalRollWheelToPlayhead(e.deltaY, e.shiftKey);
        }
        if (typeof clampScrollToViewport === 'function') clampScrollToViewport();
    } else {
        state.scrollX = Math.max(0, state.scrollX + e.deltaX + (e.shiftKey ? e.deltaY : 0));
    }
    renderAll();
}, { passive: false });

// --- Tool switching ---
window.setTool = function(tool) {
    state.activeTool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tool-' + tool).classList.add('active');
    if (typeof window.updateEditModeMenuChecks === 'function') window.updateEditModeMenuChecks();
};
document.getElementById('tool-cursor').addEventListener('click', function() { setTool('cursor'); this.blur(); });
document.getElementById('tool-pencil').addEventListener('click', function() { setTool('pencil'); this.blur(); });
document.getElementById('tool-eraser').addEventListener('click', function() { setTool('eraser'); this.blur(); });

window.cancelConductorHeaderInteraction = function() {
    if (conductorPbDrag) {
        conductorPbDrag = null;
        state.conductorMarkerDragPreview = null;
        renderAll();
    }
};
})();

