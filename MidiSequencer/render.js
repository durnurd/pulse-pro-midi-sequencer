// render.js - Canvas rendering
const gridCanvas = document.getElementById('grid-canvas');
const gridCtx = gridCanvas.getContext('2d');
const keyCanvas = document.getElementById('keyboard-canvas');
const keyCtx = keyCanvas.getContext('2d');
const pbCanvas = document.getElementById('playback-canvas');
const pbCtx = pbCanvas.getContext('2d');

/**
 * Inner height for layout/scroll (clientHeight minus vertical padding).
 * When the automation strip is docked, panels use padding-bottom to reserve space;
 * canvases must use only the content box so the strip does not cover the piano roll.
 */
function getElementContentHeight(el) {
    if (!el) return 0;
    const st = getComputedStyle(el);
    const pt = parseFloat(st.paddingTop) || 0;
    const pb = parseFloat(st.paddingBottom) || 0;
    return Math.max(0, el.clientHeight - pt - pb);
}

function resizeCanvases() {
    const gridPanel = document.getElementById('grid-panel');
    const keyPanel = document.getElementById('keyboard-panel');

    const w = gridPanel.clientWidth;
    const gh = getElementContentHeight(gridPanel);
    const kh = getElementContentHeight(keyPanel);
    const h = Math.min(gh, kh);
    state.gridWidth = w;
    state.gridHeight = h;

    gridCanvas.width = w * devicePixelRatio;
    gridCanvas.height = h * devicePixelRatio;
    gridCanvas.style.width = w + 'px';
    gridCanvas.style.height = h + 'px';
    gridCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    keyCanvas.width = KEYBOARD_WIDTH * devicePixelRatio;
    keyCanvas.height = h * devicePixelRatio;
    keyCanvas.style.width = KEYBOARD_WIDTH + 'px';
    keyCanvas.style.height = h + 'px';
    keyCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    pbCanvas.width = w * devicePixelRatio;
    pbCanvas.height = PLAYBACK_HEADER_HEIGHT * devicePixelRatio;
    pbCanvas.style.width = w + 'px';
    pbCanvas.style.height = PLAYBACK_HEADER_HEIGHT + 'px';
    pbCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    clampScrollToViewport();
    if (window.aeResize) window.aeResize();
}

function renderGrid() {
    const w = state.gridWidth;
    const h = state.gridHeight;
    const sx = state.scrollX;
    const sy = state.scrollY;
    const t = getTheme();

    gridCtx.clearRect(0, 0, w, h);

    // Row backgrounds
    const startRow = Math.floor(sy / NOTE_HEIGHT);
    const endRow = Math.min(TOTAL_MIDI_NOTES, Math.ceil((sy + h) / NOTE_HEIGHT));
    for (let row = startRow; row < endRow; row++) {
        const noteNum = TOTAL_MIDI_NOTES - 1 - row;
        const y = row * NOTE_HEIGHT - sy;
        gridCtx.fillStyle = isBlackKey(noteNum) ? t.gridBgBlackKey : t.gridBgWhiteKey;
        gridCtx.fillRect(0, y, w, NOTE_HEIGHT);
        // Row border
        gridCtx.strokeStyle = t.gridRowBorder;
        gridCtx.lineWidth = 0.5;
        gridCtx.beginPath();
        gridCtx.moveTo(0, y + NOTE_HEIGHT);
        gridCtx.lineTo(w, y + NOTE_HEIGHT);
        gridCtx.stroke();
    }

    // Vertical beat/bar lines (variable time signature); when snap is off, draw 16ths only (not every tick)
    const visualTicks = state.snapGridPower < 0 ? Math.round(MIDI_TPQN / 4) : TICKS_PER_SNAP;
    const startSnap = Math.floor(sx / (visualTicks * SNAP_WIDTH));
    const endSnap = Math.ceil((sx + w) / (visualTicks * SNAP_WIDTH));
    for (let s = startSnap; s <= endSnap; s++) {
        const tk = s * visualTicks;
        const x = tk * SNAP_WIDTH - sx;
        const measureStart = measureStartTickContaining(tk);
        const isBar = tk === measureStart;
        if (isBar) {
            gridCtx.strokeStyle = t.gridBarLine;
            gridCtx.lineWidth = 2;
        } else if (tk % MIDI_TPQN === 0) {
            gridCtx.strokeStyle = t.gridBeatLine;
            gridCtx.lineWidth = 1;
        } else {
            gridCtx.strokeStyle = t.gridSubLine;
            gridCtx.lineWidth = 0.5;
        }
        gridCtx.beginPath();
        gridCtx.moveTo(x, 0);
        gridCtx.lineTo(x, h);
        gridCtx.stroke();
    }

    // Pre-sort automation data for overlay rendering (only when overlay is active)
    let overlayEvents = null; // sorted array of {tick, value} for the selected automation type, per channel
    if (state.automationOverlay != null) {
        overlayEvents = new Array(16);
        for (let ch = 0; ch < 16; ch++) overlayEvents[ch] = [];
        if (state.automationOverlay === 'pitchBend') {
            for (const ev of state.pitchBends) {
                overlayEvents[ev.channel].push({ tick: ev.tick, value: ev.value / 16383 }); // normalize to 0-1
            }
        } else {
            const ccNum = state.automationOverlay;
            for (const ev of state.controllerChanges) {
                if (ev.controller === ccNum) {
                    overlayEvents[ev.channel].push({ tick: ev.tick, value: ev.value / 127 }); // normalize to 0-1
                }
            }
        }
        for (let ch = 0; ch < 16; ch++) {
            overlayEvents[ch].sort((a, b) => a.tick - b.tick);
        }
    }

    // Notes — brightness reflects velocity; locked = cross-hatch; muted = hollow
    const NOTE_RADIUS = 3; // corner radius for rounded note rectangles
    const isVelocityEditing = state.interactionData && state.interactionData.velocityEditing;
    for (const n of state.notes) {
        // Skip hidden tracks
        const trk = state.tracks[n.track];
        if (trk && trk.hidden) continue;
        const row = TOTAL_MIDI_NOTES - 1 - n.note;
        const nx = n.startTick * SNAP_WIDTH - sx;
        const ny = row * NOTE_HEIGHT - sy;
        const nw = n.durationTicks * SNAP_WIDTH;
        if (nx + nw < 0 || nx > w || ny + NOTE_HEIGHT < 0 || ny > h) continue;

        const selected = state.selectedNoteIds.has(n.id);
        const vel = n.velocity ?? 100;
        const velAlpha = 0.2 + 0.8 * (vel / 127);
        const baseAlpha = selected ? 1.0 : 0.8;
        const color = getTrackColor(n.track);
        const isMuted = trk && !isTrackAudible(n.track);
        const isLocked = trk && trk.locked;

        // Clamp radius so it doesn't exceed half the note width or height (and never negative)
        const r = Math.max(0, Math.min(NOTE_RADIUS, (nw - 2) / 2, (NOTE_HEIGHT - 2) / 2));

        if (isMuted) {
            // Hollow: outline only, no fill
            gridCtx.globalAlpha = baseAlpha * velAlpha * 0.6;
            gridCtx.strokeStyle = color;
            gridCtx.lineWidth = 1.5;
            gridCtx.beginPath();
            gridCtx.roundRect(nx + 1.5, ny + 1.5, nw - 3, NOTE_HEIGHT - 3, r);
            gridCtx.stroke();
        } else {
            // Filled note
            gridCtx.fillStyle = color;
            gridCtx.globalAlpha = baseAlpha * velAlpha;
            gridCtx.beginPath();
            gridCtx.roundRect(nx + 1, ny + 1, nw - 2, NOTE_HEIGHT - 2, r);
            gridCtx.fill();
        }

        // Cross-hatch overlay for locked channels
        if (isLocked && !isMuted) {
            gridCtx.save();
            gridCtx.beginPath();
            gridCtx.roundRect(nx + 1, ny + 1, nw - 2, NOTE_HEIGHT - 2, r);
            gridCtx.clip();
            gridCtx.globalAlpha = 0.35;
            gridCtx.strokeStyle = t.gridBgWhiteKey;
            gridCtx.lineWidth = 1;
            const step = 5;
            for (let d = -NOTE_HEIGHT; d < nw + NOTE_HEIGHT; d += step) {
                gridCtx.beginPath();
                gridCtx.moveTo(nx + 1 + d, ny + 1);
                gridCtx.lineTo(nx + 1 + d + NOTE_HEIGHT, ny + 1 + NOTE_HEIGHT - 2);
                gridCtx.stroke();
            }
            gridCtx.restore();
        }

        // Automation overlay line inside note
        if (overlayEvents) {
            const evts = overlayEvents[n.channel];
            const pad = 2;
            const innerLeft = nx + pad;
            const innerRight = nx + nw - pad;
            const innerTop = ny + pad;
            const innerBot = ny + NOTE_HEIGHT - pad;
            const innerH = innerBot - innerTop;
            const innerW = innerRight - innerLeft;
            if (evts.length > 0 && innerW > 0 && innerH > 0) {
                const startTick = n.startTick;
                const endTick = n.startTick + n.durationTicks;

                // Default values per automation type (match AUTOMATION_CC_DEFAULT_MIDI / pitch center)
                let initVal = automationOverlayDefaultNorm(state.automationOverlay);
                // Binary search for last event at or before startTick
                let lo = 0, hi = evts.length - 1, lastBefore = -1;
                while (lo <= hi) {
                    const mid = (lo + hi) >> 1;
                    if (evts[mid].tick <= startTick) { lastBefore = mid; lo = mid + 1; }
                    else hi = mid - 1;
                }
                if (lastBefore >= 0) initVal = evts[lastBefore].value;

                // Build polyline points
                const valToY = (v) => innerBot - v * innerH; // 0→bottom, 1→top
                const tickToX = (tk) => innerLeft + ((tk - startTick) / n.durationTicks) * innerW;
                const points = [{ x: innerLeft, y: valToY(initVal) }];

                let idx = lastBefore >= 0 ? lastBefore + 1 : 0;
                while (idx < evts.length && evts[idx].tick <= startTick) idx++;

                let prevVal = initVal;
                while (idx < evts.length && evts[idx].tick < endTick) {
                    const ev = evts[idx];
                    const ex = tickToX(ev.tick);
                    points.push({ x: ex, y: valToY(prevVal) });
                    points.push({ x: ex, y: valToY(ev.value) });
                    prevVal = ev.value;
                    idx++;
                }
                points.push({ x: innerRight, y: valToY(prevVal) });

                // Draw clipped to note rect
                gridCtx.save();
                gridCtx.beginPath();
                gridCtx.roundRect(nx + 1, ny + 1, nw - 2, NOTE_HEIGHT - 2, r);
                gridCtx.clip();
                gridCtx.globalAlpha = 1.0;
                gridCtx.strokeStyle = currentTheme === 'dark' ? '#ffffff' : '#000000';
                gridCtx.lineWidth = 1.5;
                gridCtx.beginPath();
                gridCtx.moveTo(points[0].x, points[0].y);
                for (let pi = 1; pi < points.length; pi++) {
                    gridCtx.lineTo(points[pi].x, points[pi].y);
                }
                gridCtx.stroke();
                gridCtx.restore();
            }
        }

        if (selected) {
            gridCtx.globalAlpha = 1.0;
            gridCtx.strokeStyle = t.noteSelectionStroke;
            gridCtx.lineWidth = 1.5;
            gridCtx.beginPath();
            gridCtx.roundRect(nx + 0.5, ny + 0.5, nw - 1, NOTE_HEIGHT - 1, r + 0.5);
            gridCtx.stroke();
        }
        // Show numeric velocity during velocity editing for all notes
        if (isVelocityEditing) {
            gridCtx.globalAlpha = 1.0;
            gridCtx.fillStyle = t.velocityText;
            gridCtx.font = 'bold 9px monospace';
            gridCtx.textBaseline = 'middle';
            gridCtx.fillText(vel.toString(), nx + 3, ny + NOTE_HEIGHT / 2);
        }
        // Show note name label when no automation overlay and not editing velocity
        if (!overlayEvents && !isVelocityEditing && nw > 20 && NOTE_HEIGHT >= 10) {
            gridCtx.globalAlpha = 0.85;
            gridCtx.fillStyle = currentTheme === 'dark' ? '#ffffff' : '#000000';
            gridCtx.font = `${Math.min(10, NOTE_HEIGHT - 3)}px sans-serif`;
            gridCtx.textBaseline = 'middle';
            gridCtx.save();
            gridCtx.beginPath();
            gridCtx.roundRect(nx + 1, ny + 1, nw - 2, NOTE_HEIGHT - 2, r);
            gridCtx.clip();
            const noteIsDrum = trk && trk.channel === 9;
            gridCtx.fillText(midiNoteName(n.note, noteIsDrum), nx + 3, ny + NOTE_HEIGHT / 2);
            gridCtx.restore();
        }
        gridCtx.globalAlpha = 1.0;
    }

    if (typeof window.pulseProDrawMidiRecordLiveNotes === 'function') {
        window.pulseProDrawMidiRecordLiveNotes(gridCtx, sx, sy, w, h, NOTE_RADIUS, NOTE_HEIGHT);
    }

    // Selection rectangle
    if (state.mode === 'selecting' && state.interactionData) {
        const d = state.interactionData;
        const rx = Math.min(d.startX, d.currentX) - sx;
        const ry = Math.min(d.startY, d.currentY) - sy;
        const rw = Math.abs(d.currentX - d.startX);
        const rh = Math.abs(d.currentY - d.startY);
        gridCtx.strokeStyle = t.selectionStroke;
        gridCtx.lineWidth = 1;
        gridCtx.setLineDash([4, 4]);
        gridCtx.strokeRect(rx, ry, rw, rh);
        gridCtx.setLineDash([]);
        gridCtx.fillStyle = t.selectionFill;
        gridCtx.fillRect(rx, ry, rw, rh);
    }

    // Conductor insert placement preview
    if (state.conductorPlacementMode && state.conductorPlacementHoverTick != null) {
        const cx = state.conductorPlacementHoverTick * SNAP_WIDTH - sx;
        if (cx >= -2 && cx <= w + 2) {
            gridCtx.strokeStyle = '#000000';
            gridCtx.lineWidth = 1.5;
            gridCtx.beginPath();
            gridCtx.moveTo(cx, 0);
            gridCtx.lineTo(cx, h);
            gridCtx.stroke();
        }
    }

    // Playback line
    const pbX = state.playbackTick * SNAP_WIDTH - sx;
    if (pbX >= 0 && pbX <= w) {
        gridCtx.strokeStyle = t.playbackLine;
        gridCtx.lineWidth = 2;
        gridCtx.beginPath();
        gridCtx.moveTo(pbX, 0);
        gridCtx.lineTo(pbX, h);
        gridCtx.stroke();
    }
}

function renderKeyboard() {
    const w = KEYBOARD_WIDTH;
    const h = state.gridHeight;
    const sy = state.scrollY;
    const th = getTheme();
    keyCtx.clearRect(0, 0, w, h);

    // Build a map of noteNum → track color for notes currently playing
    const playingKeys = new Map(); // noteNum → color
    if (state.isPlaying) {
        for (const n of state.notes) {
            if (!isTrackAudible(n.track)) continue;
            const trk = state.tracks[n.track];
            if (trk && trk.hidden) continue;
            if (n.startTick <= state.playbackTick &&
                n.startTick + n.durationTicks > state.playbackTick) {
                playingKeys.set(n.note, getTrackColor(n.track));
            }
        }
        if (typeof window.pulseProMidiRecordMergePlayingKeys === 'function') {
            window.pulseProMidiRecordMergePlayingKeys(playingKeys);
        }
    }

    const startRow = Math.floor(sy / NOTE_HEIGHT);
    const endRow = Math.min(TOTAL_MIDI_NOTES, Math.ceil((sy + h) / NOTE_HEIGHT));
    for (let row = startRow; row < endRow; row++) {
        const noteNum = TOTAL_MIDI_NOTES - 1 - row;
        const y = row * NOTE_HEIGHT - sy;
        const black = isBlackKey(noteNum);
        const highlighted = state.highlightedKeys.has(noteNum);
        const playingColor = playingKeys.get(noteNum);
        if (highlighted) {
            keyCtx.fillStyle = th.keyHighlight;
        } else if (playingColor) {
            keyCtx.fillStyle = playingColor;
        } else {
            keyCtx.fillStyle = black ? th.keyBlack : th.keyWhite;
        }
        keyCtx.fillRect(0, y, w, NOTE_HEIGHT);
        keyCtx.strokeStyle = th.keyBorder;
        keyCtx.lineWidth = 0.5;
        keyCtx.strokeRect(0, y, w, NOTE_HEIGHT);
        // Label
        const isLit = highlighted || !!playingColor;
        keyCtx.fillStyle = isLit ? th.keyLabelHighlight : (black ? th.keyLabelBlack : th.keyLabelWhite);
        keyCtx.font = '10px monospace';
        keyCtx.textBaseline = 'middle';
        const activeIsDrum = state.tracks[state.activeTrack] && state.tracks[state.activeTrack].channel === 9;
        keyCtx.fillText(midiNoteName(noteNum, activeIsDrum), 4, y + NOTE_HEIGHT / 2);
    }
}

function renderPlaybackHeader() {
    const w = state.gridWidth;
    const h = PLAYBACK_HEADER_HEIGHT;
    const sx = state.scrollX;
    const th = getTheme();
    pbCtx.clearRect(0, 0, w, h);

    const beatPx = MIDI_TPQN * SNAP_WIDTH;
    const startBeat = Math.floor(sx / beatPx);
    const endBeat = Math.ceil((sx + w) / beatPx);
    for (let b = startBeat; b <= endBeat; b++) {
        const tk = b * MIDI_TPQN;
        const x = tk * SNAP_WIDTH - sx;
        const measureStart = measureStartTickContaining(tk);
        if (tk === measureStart) {
            const barNum = measureIndexAtTick(tk) + 1;
            pbCtx.fillStyle = th.pbText;
            pbCtx.font = '10px monospace';
            pbCtx.fillText(barNum.toString(), x + 3, 12);
            pbCtx.strokeStyle = th.pbBarLine;
            pbCtx.lineWidth = 1;
        } else {
            pbCtx.strokeStyle = th.pbBeatLine;
            pbCtx.lineWidth = 0.5;
        }
        pbCtx.beginPath();
        pbCtx.moveTo(x, 16);
        pbCtx.lineTo(x, h);
        pbCtx.stroke();
    }

    const visStartTk = sx / SNAP_WIDTH;
    const visEndTk = (sx + w) / SNAP_WIDTH;
    if (conductorTrackVisible()) {
        const prev = state.conductorMarkerDragPreview;
        for (const e of state.tempoChanges) {
            let drawTick = e.tick;
            if (prev && prev.kind === 'bpm' && prev.origTick === e.tick) drawTick = prev.previewTick;
            if (drawTick < visStartTk || drawTick > visEndTk) continue;
            const mx = drawTick * SNAP_WIDTH - sx;
            pbCtx.strokeStyle = '#6c9eff';
            pbCtx.lineWidth = 2;
            pbCtx.beginPath();
            pbCtx.moveTo(mx, 0);
            pbCtx.lineTo(mx, 10);
            pbCtx.stroke();
            pbCtx.fillStyle = '#6c9eff';
            pbCtx.font = '9px monospace';
            pbCtx.textBaseline = 'alphabetic';
            pbCtx.fillText(String(e.bpm), mx + 2, 9);
        }
        for (const e of state.timeSigChanges) {
            let drawTick = e.tick;
            if (prev && prev.kind === 'ts' && prev.origTick === e.tick) drawTick = prev.previewTick;
            if (drawTick < visStartTk || drawTick > visEndTk) continue;
            const mx = drawTick * SNAP_WIDTH - sx;
            pbCtx.strokeStyle = '#c9a227';
            pbCtx.lineWidth = 2;
            pbCtx.beginPath();
            pbCtx.moveTo(mx, 10);
            pbCtx.lineTo(mx, h);
            pbCtx.stroke();
            pbCtx.fillStyle = '#c9a227';
            pbCtx.font = '9px monospace';
            pbCtx.textBaseline = 'alphabetic';
            pbCtx.fillText(e.numerator + '/' + e.denominator, mx + 2, 22);
        }
    }

    if (state.conductorPlacementMode && state.conductorPlacementHoverTick != null) {
        const cx = state.conductorPlacementHoverTick * SNAP_WIDTH - sx;
        if (cx >= -2 && cx <= w + 2) {
            pbCtx.strokeStyle = '#000000';
            pbCtx.lineWidth = 2;
            pbCtx.beginPath();
            pbCtx.moveTo(cx, 0);
            pbCtx.lineTo(cx, h);
            pbCtx.stroke();
        }
    }

    // Playback handle
    const pbX = state.playbackTick * SNAP_WIDTH - sx;
    if (pbX >= -10 && pbX <= w + 10) {
        pbCtx.fillStyle = th.pbHandle;
        pbCtx.beginPath();
        pbCtx.moveTo(pbX - 6, 0);
        pbCtx.lineTo(pbX + 6, 0);
        pbCtx.lineTo(pbX + 6, 16);
        pbCtx.lineTo(pbX, h);
        pbCtx.lineTo(pbX - 6, 16);
        pbCtx.closePath();
        pbCtx.fill();
    }
}

// --- Scrollbars ---
const sbThumbV = document.getElementById('sb-thumb-v');
const sbThumbH = document.getElementById('sb-thumb-h');
const sbTrackV = document.getElementById('scrollbar-v');
const sbTrackH = document.getElementById('scrollbar-h');

function getMaxScrollX() {
    const endTick = getEndTick();
    const tpmEnd = ticksPerMeasureAtTick(Math.max(0, endTick));
    const pad = tpmEnd * 4;
    const contentTicks = Math.max(pad, endTick + tpmEnd * 2);
    return Math.max(0, contentTicks * SNAP_WIDTH - state.gridWidth);
}

function clampScrollToViewport() {
    const maxSY = Math.max(0, TOTAL_HEIGHT - state.gridHeight);
    state.scrollY = Math.max(0, Math.min(maxSY, state.scrollY));
    const maxSX = Math.max(0, getMaxScrollX());
    state.scrollX = Math.max(0, Math.min(maxSX, state.scrollX));
}

function updateScrollbars() {
    const maxSY = Math.max(1, TOTAL_HEIGHT - state.gridHeight);
    const maxSX = Math.max(1, getMaxScrollX());
    const trackH = Math.max(1, getElementContentHeight(sbTrackV));
    const trackW = sbTrackH.clientWidth;

    // Vertical thumb
    const vRatio = state.gridHeight / TOTAL_HEIGHT;
    const vThumbH = Math.max(20, trackH * vRatio);
    const vTop = (state.scrollY / maxSY) * (trackH - vThumbH);
    sbThumbV.style.height = vThumbH + 'px';
    sbThumbV.style.top = vTop + 'px';

    // Horizontal thumb
    const contentW = maxSX + state.gridWidth;
    const hRatio = state.gridWidth / contentW;
    const hThumbW = Math.max(20, trackW * hRatio);
    const hLeft = (state.scrollX / maxSX) * (trackW - hThumbW);
    sbThumbH.style.width = hThumbW + 'px';
    sbThumbH.style.left = hLeft + 'px';
}

// Scrollbar drag handlers
(function() {
    let dragging = null; // { axis: 'v'|'h', startMouse, startScroll }

    function onMouseDown(axis, e) {
        e.preventDefault();
        const thumb = axis === 'v' ? sbThumbV : sbThumbH;
        thumb.classList.add('active');
        dragging = {
            axis,
            startMouse: axis === 'v' ? e.clientY : e.clientX,
            startScroll: axis === 'v' ? state.scrollY : state.scrollX,
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    function onMouseMove(e) {
        if (!dragging) return;
        const { axis, startMouse, startScroll } = dragging;
        const delta = (axis === 'v' ? e.clientY : e.clientX) - startMouse;
        if (axis === 'v') {
            const trackH = Math.max(1, getElementContentHeight(sbTrackV));
            const maxSY = Math.max(1, TOTAL_HEIGHT - state.gridHeight);
            const vRatio = state.gridHeight / TOTAL_HEIGHT;
            const thumbH = Math.max(20, trackH * vRatio);
            const scrollDelta = delta / (trackH - thumbH) * maxSY;
            state.scrollY = Math.max(0, Math.min(maxSY, startScroll + scrollDelta));
        } else {
            const trackW = sbTrackH.clientWidth;
            const maxSX = Math.max(1, getMaxScrollX());
            const contentW = maxSX + state.gridWidth;
            const hRatio = state.gridWidth / contentW;
            const thumbW = Math.max(20, trackW * hRatio);
            const scrollDelta = delta / (trackW - thumbW) * maxSX;
            state.scrollX = Math.max(0, startScroll + scrollDelta);
        }
        renderAll();
    }

    function onMouseUp() {
        if (dragging) {
            const thumb = dragging.axis === 'v' ? sbThumbV : sbThumbH;
            thumb.classList.remove('active');
        }
        dragging = null;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    sbThumbV.addEventListener('mousedown', function(e) { onMouseDown('v', e); });
    sbThumbH.addEventListener('mousedown', function(e) { onMouseDown('h', e); });

    // Click on track to jump
    sbTrackV.addEventListener('mousedown', function(e) {
        if (e.target === sbThumbV) return;
        const trackH = Math.max(1, getElementContentHeight(sbTrackV));
        const rect = sbTrackV.getBoundingClientRect();
        const padTop = parseFloat(getComputedStyle(sbTrackV).paddingTop) || 0;
        const yRaw = e.clientY - rect.top - padTop;
        const yInTrack = Math.max(0, Math.min(trackH, yRaw));
        const ratio = trackH > 0 ? yInTrack / trackH : 0;
        const maxSY = Math.max(1, TOTAL_HEIGHT - state.gridHeight);
        state.scrollY = Math.max(0, Math.min(maxSY, ratio * TOTAL_HEIGHT - state.gridHeight / 2));
        renderAll();
    });
    sbTrackH.addEventListener('mousedown', function(e) {
        if (e.target === sbThumbH) return;
        const rect = sbTrackH.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        const maxSX = Math.max(1, getMaxScrollX());
        const contentW = maxSX + state.gridWidth;
        state.scrollX = Math.max(0, ratio * contentW - state.gridWidth / 2);
        renderAll();
    });
})();

/** Apply automation overlay from UI string (dropdown value or tab data-overlay-value). */
function setAutomationOverlayFromUi(val) {
    if (val === '' || val === null || val === undefined) {
        state.automationOverlay = null;
    } else if (val === 'pitchBend') {
        state.automationOverlay = 'pitchBend';
    } else {
        state.automationOverlay = parseInt(String(val), 10);
    }
    const sel = document.getElementById('automation-overlay-select');
    if (sel) {
        if (state.automationOverlay === null) sel.value = '';
        else if (state.automationOverlay === 'pitchBend') sel.value = 'pitchBend';
        else sel.value = String(state.automationOverlay);
    }
    if (typeof window.aeSyncOverlayTabs === 'function') window.aeSyncOverlayTabs();
    renderAll();
}
window.setAutomationOverlayFromUi = setAutomationOverlayFromUi;

function renderAll() {
    renderGrid();
    renderKeyboard();
    renderPlaybackHeader();
    updateScrollbars();
    if (window.updateChannelListUI) window.updateChannelListUI();
    if (window.renderAutomationEditor) window.renderAutomationEditor();
    if (window.updatePlaybackTimeDisplay) window.updatePlaybackTimeDisplay();
    if (window.updateToolbarPlaybackTempoDisplay) window.updateToolbarPlaybackTempoDisplay();
    if (window.updateEditMenuUndoRedoLabels) window.updateEditMenuUndoRedoLabels();
}

