// interactions2.js - Keyboard panel, playback header, tool switching
(function() {
const kc = document.getElementById('keyboard-canvas');
const pb = document.getElementById('playback-canvas');
let pbDrag = false, kcDragging = false, kcLastNote = -1;
/** @type {null | { kind: string, origTick: number, bpm?: number, numerator?: number, denominator?: number, startClientX: number, moved: boolean }} */
let conductorPbDrag = null;
function noteFromY(gy) { return TOTAL_MIDI_NOTES - 1 - Math.floor(gy / NOTE_HEIGHT); }

// --- Keyboard panel: click and drag to preview notes ---
kc.addEventListener('mousedown', function(e) {
    audioEngine.init(); kcDragging = true;
    const y = e.clientY - kc.getBoundingClientRect().top + state.scrollY;
    const nn = noteFromY(y);
    if (nn >= 0 && nn <= 127) { kcLastNote = nn; audioEngine.noteOn(nn, state.activeChannel); state.highlightedKeys.clear(); state.highlightedKeys.add(nn); renderAll(); }
});
document.addEventListener('mousemove', function(e) {
    if (!kcDragging) return;
    const y = e.clientY - kc.getBoundingClientRect().top + state.scrollY;
    const nn = noteFromY(y);
    if (nn >= 0 && nn <= 127 && nn !== kcLastNote) {
        if (kcLastNote >= 0) audioEngine.noteOff(kcLastNote, state.activeChannel);
        kcLastNote = nn; audioEngine.noteOn(nn, state.activeChannel);
        state.highlightedKeys.clear(); state.highlightedKeys.add(nn); renderAll();
    }
});
document.addEventListener('mouseup', function(e) {
    if (kcDragging) { kcDragging = false; if (kcLastNote >= 0) { audioEngine.noteOff(kcLastNote, state.activeChannel); kcLastNote = -1; } state.highlightedKeys.clear(); renderAll(); }
});
kc.addEventListener('wheel', function(e) {
    e.preventDefault();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        zoomHorizontal(e.deltaY, undefined);
        return;
    }
    if (e.ctrlKey || e.metaKey) {
        const mouseYInGrid = e.clientY - kc.getBoundingClientRect().top;
        zoomVertical(e.deltaY, mouseYInGrid);
        return;
    }
    state.scrollY = Math.max(0, Math.min(TOTAL_HEIGHT - state.gridHeight, state.scrollY + e.deltaY));
    renderAll();
}, { passive: false });

// --- Playback header ---
function setPbTick(e) {
    const r = pb.getBoundingClientRect();
    state.playbackTick = Math.max(0, snapTick(e.clientX - r.left + state.scrollX));
    state.lastMousePlaybackTick = state.playbackTick;
    if (!state.isPlaying) state.playbackStartTick = state.playbackTick;
}
function playAtPb() {
    for (const n of state.notes) {
        if (!isTrackAudible(n.track)) continue;
        if (n.startTick <= state.playbackTick && n.startTick + n.durationTicks > state.playbackTick
            && !audioEngine.activeNotes.has(`${n.channel}-${n.note}`))
            audioEngine.noteOn(n.note, n.channel);
    }
}
function stopOld() {
    for (const [k] of audioEngine.activeNotes) {
        const p = k.split('-'), ch = +p[0], nt = +p[1]; let s = false;
        for (const n of state.notes) {
            if (n.channel === ch && n.note === nt && n.startTick <= state.playbackTick
                && n.startTick + n.durationTicks > state.playbackTick) { s = true; break; }
        }
        if (!s) audioEngine.noteOff(nt, ch);
    }
}
pb.addEventListener('mousemove', function(e) {
    if (!state.conductorPlacementMode || state.conductor.locked) return;
    const gx = e.clientX - pb.getBoundingClientRect().left + state.scrollX;
    state.conductorPlacementHoverTick = Math.max(0, snapTick(gx));
    renderAll();
});

pb.addEventListener('mousedown', function(e) {
    audioEngine.init();
    const r = pb.getBoundingClientRect();
    const gx = e.clientX - r.left + state.scrollX;
    const py = e.clientY - r.top;

    if (e.button === 2) {
        e.preventDefault();
        if (!state.conductor.locked && conductorTrackVisible()) {
            const hit = pickConductorMarkerAtPlaybackHeader(gx, py);
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
        pbDrag = true;
        if (state.isPlaying) stopPlayback();
        setPbTick(e);
        playAtPb();
        renderAll();
        return;
    }

    if (e.button !== 0) return;

    if (state.conductorPlacementMode && !state.conductor.locked) {
        e.preventDefault();
        if (typeof window.openConductorValuePrompt === 'function') {
            window.openConductorValuePrompt(Math.max(0, snapTick(gx)));
        }
        return;
    }

    if (!state.conductor.locked && conductorTrackVisible()) {
        const hit = pickConductorMarkerAtPlaybackHeader(gx, py);
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
    pbDrag = true;
    if (state.isPlaying) stopPlayback();
    setPbTick(e);
    playAtPb();
    renderAll();
});
pb.addEventListener('contextmenu', function(e) { e.preventDefault(); });
document.addEventListener('mousemove', function(e) {
    if (conductorPbDrag) {
        e.preventDefault();
        const r = pb.getBoundingClientRect();
        const gx = e.clientX - r.left + state.scrollX;
        if (Math.abs(e.clientX - conductorPbDrag.startClientX) > 3) conductorPbDrag.moved = true;
        const nt = Math.max(1, snapTick(gx));
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
    setPbTick(e); stopOld(); playAtPb(); renderAll();
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
        audioEngine.allNotesOff(); state.playbackStartTick = state.playbackTick; renderAll();
    }
});
pb.addEventListener('wheel', function(e) {
    e.preventDefault();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        const mouseXInGrid = e.clientX - pb.getBoundingClientRect().left;
        zoomHorizontal(e.deltaY, mouseXInGrid);
        return;
    }
    if (e.ctrlKey || e.metaKey) {
        // Zoom vertically even when hovering the playback header
        zoomVertical(e.deltaY, undefined);
        return;
    }
    state.scrollX = Math.max(0, state.scrollX + e.deltaX + (e.shiftKey ? e.deltaY : 0));
    renderAll();
}, { passive: false });

// --- Tool switching ---
window.setTool = function(tool) {
    state.activeTool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tool-' + tool).classList.add('active');
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

