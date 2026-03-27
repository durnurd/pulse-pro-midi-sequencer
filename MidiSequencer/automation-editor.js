// automation-editor.js — Visual automation curve editor
(function() {
const aeCanvas = document.getElementById('automation-editor-canvas');
const aeCtx = aeCanvas.getContext('2d');
const aeWrap = document.getElementById('automation-editor-canvas-wrap');
const aePanel = document.getElementById('automation-editor-panel');
const aeStrip = document.getElementById('automation-expanded-strip');
const channelList = document.getElementById('channel-list');
const channelListRows = document.getElementById('channel-list-rows');
const automationOverlayPanel = document.getElementById('automation-overlay-panel');
const sequencerContainer = document.getElementById('sequencer-container');
const mainContainer = document.getElementById('main-container');
const aeToggleExpand = document.getElementById('ae-toggle-expand');
const aeStripResizeHandle = document.getElementById('ae-strip-resize-handle');

const AE_EXPANDED_H_MIN = 80;
const AE_EXPANDED_H_GRID_MIN = 120; // minimum space left for piano roll

let aeStripResizing = false;
let aeStripResizeStartY = 0;
let aeStripResizeStartH = 0;

let aeW = 0, aeH = 0; // canvas logical size
let aeTool = 'line'; // 'line', 'freehand', 'curve', 'erase'
let aeDrawing = false;
let aeLineStart = null; // {tick, value} for line tool first click
let aeFreehandPoints = []; // [{tick, value}, ...] accumulated during freehand drag

// Quadratic Bezier curve tool: stage 0 → p0, stage 1 → p2 (ordered), stage 2 → control p1 then commit
let aeCurveStage = 0;
let aeCurveP0 = null; // {tick, value}
let aeCurveP2 = null;
let aeCurveMouse = null; // {tick, value} preview control while stage === 2

// Select tool: horizontal range drag (when no notes selected) or range from selected notes
let aeSelectDragging = false;
let aeSelectAnchorTick = 0;
let aeSelectHoverTick = 0;

// Wave tools (sine / square / saw / triangle): stage 0 → p0, 1 → p1 + pivot, 2 → mouse adjusts cycles/amp, click commits
let aeWaveStage = 0;
let aeWaveP0 = null; // { tick, value }
let aeWaveP1 = null;
let aeWavePivotPx = null; // canvas px after second tap (reference for amplitude on Y)
let aeWaveMousePxX = 0; // canvas X while stage 2 (frequency read from left edge = 1 cycle … right = max cycles)
let aeWaveCycles = 1;
let aeWaveAmp = 0.2;
let aeWaveMouseEnd = null; // { tick, value } preview while stage === 1

// --- Independent scroll/zoom for the automation editor (collapsed mode only) ---
let aeScrollX = 0;          // scroll offset in pixels (in AE's own coordinate space)
let aePixelsPerTick = SNAP_WIDTH; // independent zoom level
let aeLastTrack = -1;       // track active track changes
let aeLastSelectionKey = ''; // track selection changes

// --- Helpers ---
function aeType() {
    const ov = state.automationOverlay;
    if (ov === null || ov === undefined) return null;
    if (ov === 'pitchBend') return { kind: 'pb', min: 0, max: 16383, def: 8192 };
    return { kind: 'cc', cc: ov, min: 0, max: 127, def: automationCcDefaultMidi(ov) };
}

// Convert canvas x to tick using AE's own scroll/zoom
function aeXToTick(x) {
    return (aeScrollX + x) / aePixelsPerTick;
}
function aeTickToX(tick) {
    return tick * aePixelsPerTick - aeScrollX;
}

/** Snap a tick to the editor grid (same as note placement). */
function aeSnapTick(tick) {
    return snapTickToGrid(Math.round(tick));
}

/**
 * Collapse freehand samples to one control point per tick (same snap time).
 * Later samples win when the stroke revisits a tick.
 */
function aeTrimFreehandPointsSameTick(points) {
    const byTick = new Map();
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const t = Math.round(p.tick);
        byTick.set(t, p.normValue);
    }
    const out = [];
    for (const [tick, normValue] of byTick) {
        out.push({ tick, normValue });
    }
    out.sort(function(a, b) { return a.tick - b.tick; });
    return out;
}

function aeYToValue(y) {
    return Math.max(0, Math.min(1, 1 - y / aeH));
}
function aeValueToY(v) {
    return (1 - v) * aeH;
}

// Build a key representing the current selection for change detection
function aeSelectionKey() {
    if (state.selectedNoteIds.size === 0) return '';
    const ids = Array.from(state.selectedNoteIds).sort((a, b) => a - b);
    return ids.join(',');
}

// Zoom/scroll the AE to fit a tick range with padding
function aeZoomToRange(startTick, endTick) {
    const range = endTick - startTick;
    if (range <= 0 || aeW <= 0) return;
    const padding = range * 0.05; // 5% padding on each side
    const totalRange = range + padding * 2;
    aePixelsPerTick = aeW / totalRange;
    aeScrollX = (startTick - padding) * aePixelsPerTick;
}

// Keep playback head visible in AE during playback
function aeFollowPlayback() {
    const pbX = aeTickToX(state.playbackTick);
    const margin = aeW * 0.15;
    if (pbX > aeW - margin) {
        aeScrollX = state.playbackTick * aePixelsPerTick - aeW + margin;
    } else if (pbX < margin) {
        aeScrollX = Math.max(0, state.playbackTick * aePixelsPerTick - margin);
    }
}

function aeClearCurveDraft() {
    aeCurveStage = 0;
    aeCurveP0 = null;
    aeCurveP2 = null;
    aeCurveMouse = null;
}

function aeWaveShapeFromTool() {
    if (aeTool === 'wave-sine') return 'sine';
    if (aeTool === 'wave-square') return 'square';
    if (aeTool === 'wave-saw') return 'saw';
    if (aeTool === 'wave-triangle') return 'triangle';
    return null;
}

function aeIsWaveTool() {
    return aeWaveShapeFromTool() !== null;
}

function aeClearWaveDraft() {
    aeWaveStage = 0;
    aeWaveP0 = null;
    aeWaveP1 = null;
    aeWavePivotPx = null;
    aeWaveMousePxX = 0;
    aeWaveCycles = 1;
    aeWaveAmp = 0.2;
    aeWaveMouseEnd = null;
}

/** Max cycles that fit in span with at least one snap per half-period (finest resolution at canvas right edge). */
function aeWaveMaxCyclesForSpan(spanTicks) {
    if (spanTicks <= 0) return 1;
    const maxC = Math.floor(spanTicks / (2 * TICKS_PER_SNAP));
    return Math.max(1, Math.min(512, maxC));
}

/** Map canvas X: left = 1 full cycle over the segment, right = aeWaveMaxCyclesForSpan. */
function aeCyclesFromMouseX(mouseCanvasX, spanTicks) {
    const maxC = aeWaveMaxCyclesForSpan(spanTicks);
    if (aeW <= 0) return 1;
    const u = Math.max(0, Math.min(1, mouseCanvasX / aeW));
    if (maxC <= 1) return 1;
    return 1 + u * (maxC - 1);
}

/**
 * Unit wave in [-1, 1]; phaseRuns = (unwrapped) number of cycles into the wave (phi * cycles over segment).
 */
function aeWaveUnit(shape, phaseRuns) {
    if (shape === 'sine') {
        return Math.sin(phaseRuns * 2 * Math.PI);
    }
    if (shape === 'square') {
        return Math.sin(phaseRuns * 2 * Math.PI) >= 0 ? 1 : -1;
    }
    const frac = phaseRuns - Math.floor(phaseRuns);
    if (shape === 'saw') {
        return 2 * frac - 1;
    }
    if (shape === 'triangle') {
        return frac < 0.5 ? 4 * frac - 1 : 3 - 4 * frac;
    }
    return 0;
}

function aeWaveOrderedEnds() {
    if (!aeWaveP0 || !aeWaveP1) return null;
    if (aeWaveP0.tick <= aeWaveP1.tick) {
        return { tMin: aeWaveP0.tick, vMin: aeWaveP0.value, tMax: aeWaveP1.tick, vMax: aeWaveP1.value };
    }
    return { tMin: aeWaveP1.tick, vMin: aeWaveP1.value, tMax: aeWaveP0.tick, vMax: aeWaveP0.value };
}

function aeBuildWavePoints(shape, tMin, tMax, vMin, vMax, cycles, amp) {
    tMin = aeSnapTick(tMin);
    tMax = aeSnapTick(tMax);
    if (tMax < tMin) {
        const s = tMin;
        tMin = tMax;
        tMax = s;
        const vs = vMin;
        vMin = vMax;
        vMax = vs;
    }
    const span = tMax - tMin;
    if (span <= 0) return [];
    const step = Math.max(1, TICKS_PER_SNAP);
    const pts = [];
    for (let t = tMin; t < tMax; t += step) {
        const phi = (t - tMin) / span;
        const center = vMin + phi * (vMax - vMin);
        const w = aeWaveUnit(shape, phi * cycles);
        pts.push({ tick: t, normValue: Math.max(0, Math.min(1, center + amp * w)) });
    }
    const phiEnd = 1;
    const centerEnd = vMax;
    const wEnd = aeWaveUnit(shape, phiEnd * cycles);
    pts.push({ tick: tMax, normValue: Math.max(0, Math.min(1, centerEnd + amp * wEnd)) });
    return pts;
}

function aeBezierPoint(t, p0, p1, p2) {
    const u = 1 - t;
    return {
        tick: u * u * p0.tick + 2 * u * t * p1.tick + t * t * p2.tick,
        value: u * u * p0.value + 2 * u * t * p1.value + t * t * p2.value
    };
}

function aeSampleQuadraticBezier(p0, p1, p2) {
    const t0 = p0.tick;
    const t2 = p2.tick;
    const tickRange = Math.abs(t2 - t0);
    const step = Math.max(1, TICKS_PER_SNAP);
    const numSteps = Math.max(2, Math.ceil(tickRange / step) + 1);
    const points = [];
    for (let i = 0; i <= numSteps; i++) {
        const t = i / numSteps;
        const p = aeBezierPoint(t, p0, p1, p2);
        points.push({
            tick: aeSnapTick(p.tick),
            normValue: Math.max(0, Math.min(1, p.value))
        });
    }
    points.sort((a, b) => a.tick - b.tick);
    const deduped = [];
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (deduped.length > 0 && deduped[deduped.length - 1].tick === p.tick) {
            deduped[deduped.length - 1] = p;
        } else {
            deduped.push(p);
        }
    }
    return deduped;
}

// Get sorted events for the active channel and current overlay type, normalized 0-1
function aeGetEvents() {
    const info = aeType();
    if (!info) return [];
    const ch = state.activeChannel;
    if (info.kind === 'pb') {
        return state.pitchBends
            .filter(e => e.channel === ch)
            .sort((a, b) => a.tick - b.tick)
            .map(e => ({ tick: e.tick, value: e.value / 16383 }));
    } else {
        return state.controllerChanges
            .filter(e => e.channel === ch && e.controller === info.cc)
            .sort((a, b) => a.tick - b.tick)
            .map(e => ({ tick: e.tick, value: e.value / 127 }));
    }
}

// Get the default normalized value for the current overlay type
function aeDefaultNorm() {
    const info = aeType();
    if (!info) return 0.5;
    if (info.kind === 'pb') return info.def / 16383;
    return info.def / 127;
}

/** Step-held automation value at tick (normalized 0–1) for the active channel/overlay. */
function aeEvalAtTick(tick) {
    const events = aeGetEvents();
    const def = aeDefaultNorm();
    let cur = def;
    for (let i = 0; i < events.length; i++) {
        if (events[i].tick > tick) break;
        cur = events[i].value;
    }
    return cur;
}

/** Tick range for copy/paste: from selected notes, or manual drag when no notes are selected. */
function aeGetEffectiveSelectRange() {
    if (state.selectedNoteIds.size > 0) {
        const selNotes = state.notes.filter(function(n) { return state.selectedNoteIds.has(n.id); });
        if (selNotes.length === 0) return null;
        const startTick = Math.min.apply(null, selNotes.map(function(n) { return n.startTick; }));
        const endTick = Math.max.apply(null, selNotes.map(function(n) { return n.startTick + n.durationTicks; }));
        return { startTick: startTick, endTick: endTick };
    }
    return state.automationSelectTicks;
}

function aeSampleRangeForCopy(startTick, endTick) {
    const span = endTick - startTick;
    if (span <= 0) return [];
    const step = Math.max(1, TICKS_PER_SNAP);
    const pts = [];
    for (let t = startTick; t < endTick; t += step) {
        pts.push({ relTick: t - startTick, normValue: aeEvalAtTick(t) });
    }
    pts.push({ relTick: span, normValue: aeEvalAtTick(endTick) });
    return pts;
}

/**
 * Copy automation in the effective range. Returns true if the shortcut/menu should not fall through to note copy.
 */
function tryCopyAutomation() {
    if (state.automationEditorTool !== 'select') return false;
    if (!aeType()) return false;
    const r = aeGetEffectiveSelectRange();
    if (!r || r.endTick <= r.startTick) return true;
    const info = aeType();
    const payload = {
        kind: info.kind,
        cc: info.kind === 'cc' ? info.cc : undefined,
        spanTicks: r.endTick - r.startTick,
        points: aeSampleRangeForCopy(r.startTick, r.endTick)
    };
    state.automationClipboard = payload;
    return true;
}

/**
 * Paste automation at the playhead. Returns true if handled (select tool + overlay + clipboard).
 */
function tryPasteAutomation() {
    if (state.automationEditorTool !== 'select') return false;
    const info = aeType();
    if (!info) return false;
    if (!state.automationClipboard) return false;
    const clip = state.automationClipboard;
    if (clip.kind !== info.kind || (clip.kind === 'cc' && clip.cc !== info.cc)) return true;
    if (!clip.points || clip.points.length === 0) return true;
    const dest0 = Math.round(state.playbackTick);
    const mapped = clip.points.map(function(p) {
        return { tick: dest0 + p.relTick, normValue: p.normValue };
    });
    mapped.sort(function(a, b) { return a.tick - b.tick; });
    pushUndoState('paste automation');
    aeWriteEvents(mapped);
    if (typeof renderAll === 'function') renderAll();
    return true;
}

// Write automation events into state arrays for a range of ticks
// points: [{tick, normValue}, ...] sorted by tick
function aeWriteEvents(points) {
    if (points.length === 0) return;
    const info = aeType();
    if (!info) return;
    const ch = state.activeChannel;
    const minTick = points[0].tick;
    const maxTick = points[points.length - 1].tick;

    if (info.kind === 'pb') {
        // Remove existing events in range for this channel
        state.pitchBends = state.pitchBends.filter(e =>
            !(e.channel === ch && e.tick >= minTick && e.tick <= maxTick)
        );
        for (const p of points) {
            state.pitchBends.push({
                tick: Math.round(p.tick),
                channel: ch,
                value: Math.round(p.normValue * 16383)
            });
        }
        state.pitchBends.sort((a, b) => a.tick - b.tick || a.channel - b.channel);
    } else {
        state.controllerChanges = state.controllerChanges.filter(e =>
            !(e.channel === ch && e.controller === info.cc && e.tick >= minTick && e.tick <= maxTick)
        );
        for (const p of points) {
            state.controllerChanges.push({
                tick: Math.round(p.tick),
                channel: ch,
                controller: info.cc,
                value: Math.round(p.normValue * 127)
            });
        }
        state.controllerChanges.sort((a, b) => a.tick - b.tick);
    }
}

// Erase events in a tick range for the active channel/overlay
function aeEraseEvents(tickMin, tickMax) {
    const info = aeType();
    if (!info) return;
    const ch = state.activeChannel;
    if (info.kind === 'pb') {
        state.pitchBends = state.pitchBends.filter(e =>
            !(e.channel === ch && e.tick >= tickMin && e.tick <= tickMax)
        );
    } else {
        state.controllerChanges = state.controllerChanges.filter(e =>
            !(e.channel === ch && e.controller === info.cc && e.tick >= tickMin && e.tick <= tickMax)
        );
    }
}

function aeClampExpandedHeightPx(h) {
    if (!sequencerContainer) return Math.max(AE_EXPANDED_H_MIN, Math.round(h));
    const maxH = Math.max(
        AE_EXPANDED_H_MIN,
        sequencerContainer.clientHeight - PLAYBACK_HEADER_HEIGHT - 12 - AE_EXPANDED_H_GRID_MIN
    );
    return Math.max(AE_EXPANDED_H_MIN, Math.min(maxH, Math.round(h)));
}

/** Persist height in state and apply --ae-expanded-h when the strip is visible. */
function aeApplyExpandedHeightPx(h) {
    const ch = aeClampExpandedHeightPx(h);
    state.automationExpandedHeightPx = ch;
    if (state.automationEditorExpanded && sequencerContainer) {
        sequencerContainer.style.setProperty('--ae-expanded-h', ch + 'px');
    }
}

function aeSyncOverlayTabs() {
    const tabs = document.querySelectorAll('#automation-overlay-tabs .ae-overlay-tab');
    const cur = state.automationOverlay === null || state.automationOverlay === undefined
        ? ''
        : (state.automationOverlay === 'pitchBend' ? 'pitchBend' : String(state.automationOverlay));
    tabs.forEach(function(tab) {
        const v = tab.getAttribute('data-overlay-value') ?? '';
        const active = v === cur;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
}

function aeSetAutomationEditorExpanded(expanded) {
    state.automationEditorExpanded = !!expanded;
    if (!sequencerContainer || !aeStrip || !channelList || !channelListRows || !aePanel || !automationOverlayPanel) return;
    if (state.automationEditorExpanded) {
        sequencerContainer.classList.add('sequencer-ae-expanded');
        if (mainContainer) mainContainer.classList.add('sequencer-ae-expanded');
        aeStrip.appendChild(aePanel);
        aeApplyExpandedHeightPx(state.automationExpandedHeightPx);
    } else {
        sequencerContainer.classList.remove('sequencer-ae-expanded');
        sequencerContainer.style.removeProperty('--ae-expanded-h');
        if (mainContainer) mainContainer.classList.remove('sequencer-ae-expanded');
        channelList.insertBefore(aePanel, automationOverlayPanel);
    }
    if (aeToggleExpand) {
        aeToggleExpand.textContent = state.automationEditorExpanded ? '⤓' : '⤢';
        aeToggleExpand.title = state.automationEditorExpanded
            ? 'Collapse automation editor to track list'
            : 'Expand automation editor below piano roll';
    }
    aePixelsPerTick = SNAP_WIDTH;
    aeScrollX = state.scrollX;
    aeClearCurveDraft();
    aeLineStart = null;
    aeLineEnd = null;
    aeSyncOverlayTabs();
    if (typeof resizeCanvases === 'function') resizeCanvases();
    if (typeof renderAll === 'function') renderAll();
}

// --- Resize ---
function aeResize() {
    const w = aeWrap.clientWidth;
    const h = aeWrap.clientHeight;
    if (w <= 0 || h <= 0) return;
    aeW = w; aeH = h;
    aeCanvas.width = w * devicePixelRatio;
    aeCanvas.height = h * devicePixelRatio;
    aeCanvas.style.width = w + 'px';
    aeCanvas.style.height = h + 'px';
    aeCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

// --- Render ---
function renderAutomationEditor() {
    if (aeW <= 0 || aeH <= 0) { aeResize(); if (aeW <= 0 || aeH <= 0) return; }

    // Detect track change → re-render immediately
    if (state.activeTrack !== aeLastTrack) {
        aeLastTrack = state.activeTrack;
        aeLineStart = null; aeLineEnd = null;
        aeClearCurveDraft();
        aeClearWaveDraft();
        aeSelectDragging = false;
    }

    // Context-dependent scroll/zoom
    if (state.automationEditorExpanded) {
        aePixelsPerTick = SNAP_WIDTH;
        aeScrollX = state.scrollX;
    } else if (state.isPlaying) {
        aeFollowPlayback();
    } else if (!aeDrawing) {
        const selKey = aeSelectionKey();
        if (selKey !== '' && selKey !== aeLastSelectionKey) {
            aeLastSelectionKey = selKey;
            const selNotes = state.notes.filter(n => state.selectedNoteIds.has(n.id));
            if (selNotes.length > 0) {
                const minTick = Math.min(...selNotes.map(n => n.startTick));
                const maxTick = Math.max(...selNotes.map(n => n.startTick + n.durationTicks));
                aeZoomToRange(minTick, maxTick);
            }
        } else if (selKey === '' && aeLastSelectionKey !== '') {
            aeLastSelectionKey = '';
            aePixelsPerTick = SNAP_WIDTH;
            aeScrollX = state.scrollX * (aePixelsPerTick / SNAP_WIDTH);
        }
    }

    const t = getTheme();
    const isDark = currentTheme === 'dark';
    aeCtx.clearRect(0, 0, aeW, aeH);

    // Background
    aeCtx.fillStyle = isDark ? '#0e0e1c' : '#d8d8e4';
    aeCtx.fillRect(0, 0, aeW, aeH);

    const info = aeType();
    if (!info) {
        aeCtx.fillStyle = isDark ? '#555' : '#999';
        aeCtx.font = '11px sans-serif';
        aeCtx.textAlign = 'center'; aeCtx.textBaseline = 'middle';
        aeCtx.fillText('Select an automation overlay to edit', aeW / 2, aeH / 2);
        aeCtx.textAlign = 'left';
        return;
    }

    // Draw horizontal grid lines (value markers)
    aeCtx.strokeStyle = isDark ? '#222244' : '#b8b8cc';
    aeCtx.lineWidth = 0.5;
    for (let v = 0; v <= 1; v += 0.25) {
        const y = aeValueToY(v);
        aeCtx.beginPath(); aeCtx.moveTo(0, y); aeCtx.lineTo(aeW, y); aeCtx.stroke();
    }
    // Default value line (dashed)
    const defY = aeValueToY(aeDefaultNorm());
    aeCtx.strokeStyle = isDark ? '#444488' : '#8888aa';
    aeCtx.lineWidth = 1;
    aeCtx.setLineDash([4, 4]);
    aeCtx.beginPath(); aeCtx.moveTo(0, defY); aeCtx.lineTo(aeW, defY); aeCtx.stroke();
    aeCtx.setLineDash([]);

    // Draw vertical beat/bar lines (using AE's own zoom; variable time signature)
    const beatPx = MIDI_TPQN * aePixelsPerTick;
    const startBeat = Math.floor(aeScrollX / beatPx);
    const endBeat = Math.ceil((aeScrollX + aeW) / beatPx);
    for (let b = startBeat; b <= endBeat; b++) {
        const tk = b * MIDI_TPQN;
        const x = aeTickToX(tk);
        if (x < 0 || x > aeW) continue;
        const measureStart = measureStartTickContaining(tk);
        if (tk === measureStart) {
            aeCtx.strokeStyle = isDark ? '#444488' : '#8888aa';
            aeCtx.lineWidth = 1;
        } else {
            aeCtx.strokeStyle = isDark ? '#222244' : '#b8b8cc';
            aeCtx.lineWidth = 0.5;
        }
        aeCtx.beginPath(); aeCtx.moveTo(x, 0); aeCtx.lineTo(x, aeH); aeCtx.stroke();
    }

    // Draw the automation curve
    const events = aeGetEvents();
    const defNorm = aeDefaultNorm();
    aeCtx.strokeStyle = getTrackColor(state.activeTrack);
    aeCtx.lineWidth = 1.5;
    aeCtx.beginPath();
    let curVal = defNorm;
    for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].tick <= aeXToTick(0)) { curVal = events[i].value; break; }
    }
    aeCtx.moveTo(0, aeValueToY(curVal));
    for (const ev of events) {
        const x = aeTickToX(ev.tick);
        if (x < -10) { curVal = ev.value; continue; }
        if (x > aeW + 10) break;
        aeCtx.lineTo(x, aeValueToY(curVal));
        aeCtx.lineTo(x, aeValueToY(ev.value));
        curVal = ev.value;
    }
    aeCtx.lineTo(aeW, aeValueToY(curVal));
    aeCtx.stroke();

    // Draw event dots
    aeCtx.fillStyle = getTrackColor(state.activeTrack);
    for (const ev of events) {
        const x = aeTickToX(ev.tick);
        if (x < -5 || x > aeW + 5) continue;
        const y = aeValueToY(ev.value);
        aeCtx.beginPath(); aeCtx.arc(x, y, 2.5, 0, Math.PI * 2); aeCtx.fill();
    }

    // Draw line-tool preview (start point + line to mouse)
    if (aeLineStart && aeTool === 'line') {
        const sx = aeTickToX(aeLineStart.tick);
        const sy = aeValueToY(aeLineStart.value);
        aeCtx.fillStyle = '#ffffff';
        aeCtx.beginPath(); aeCtx.arc(sx, sy, 4, 0, Math.PI * 2); aeCtx.fill();
        if (aeLineEnd) {
            const ex = aeTickToX(aeLineEnd.tick);
            const ey = aeValueToY(aeLineEnd.value);
            aeCtx.strokeStyle = '#ffffff';
            aeCtx.lineWidth = 1;
            aeCtx.setLineDash([3, 3]);
            aeCtx.beginPath(); aeCtx.moveTo(sx, sy); aeCtx.lineTo(ex, ey); aeCtx.stroke();
            aeCtx.setLineDash([]);
        }
    }

    // Curve tool preview
    if (aeTool === 'curve' && aeCurveP0) {
        aeCtx.fillStyle = '#ffffff';
        const x0 = aeTickToX(aeCurveP0.tick);
        const y0 = aeValueToY(aeCurveP0.value);
        aeCtx.beginPath(); aeCtx.arc(x0, y0, 4, 0, Math.PI * 2); aeCtx.fill();
        if (aeCurveStage >= 2 && aeCurveP2) {
            const x2 = aeTickToX(aeCurveP2.tick);
            const y2 = aeValueToY(aeCurveP2.value);
            aeCtx.beginPath(); aeCtx.arc(x2, y2, 4, 0, Math.PI * 2); aeCtx.fill();
            const p1 = aeCurveMouse || {
                tick: (aeCurveP0.tick + aeCurveP2.tick) / 2,
                value: (aeCurveP0.value + aeCurveP2.value) / 2
            };
            aeCtx.strokeStyle = '#ffffff';
            aeCtx.lineWidth = 1;
            aeCtx.setLineDash([3, 3]);
            aeCtx.beginPath();
            const samples = aeSampleQuadraticBezier(aeCurveP0, p1, aeCurveP2);
            if (samples.length > 0) {
                aeCtx.moveTo(aeTickToX(samples[0].tick), aeValueToY(samples[0].normValue));
                for (let i = 1; i < samples.length; i++) {
                    aeCtx.lineTo(aeTickToX(samples[i].tick), aeValueToY(samples[i].normValue));
                }
            }
            aeCtx.stroke();
            aeCtx.setLineDash([]);
        }
    }

    // Wave tools: stage 1 = first point + line to mouse; stage 2 = preview wave
    if (aeIsWaveTool() && info) {
        const shape = aeWaveShapeFromTool();
        if (aeWaveStage === 1 && aeWaveP0) {
            const sx = aeTickToX(aeWaveP0.tick);
            const sy = aeValueToY(aeWaveP0.value);
            aeCtx.fillStyle = '#ffffff';
            aeCtx.beginPath(); aeCtx.arc(sx, sy, 4, 0, Math.PI * 2); aeCtx.fill();
            if (aeWaveMouseEnd) {
                const ex = aeTickToX(aeWaveMouseEnd.tick);
                const ey = aeValueToY(aeWaveMouseEnd.value);
                aeCtx.strokeStyle = '#ffffff';
                aeCtx.lineWidth = 1;
                aeCtx.setLineDash([3, 3]);
                aeCtx.beginPath(); aeCtx.moveTo(sx, sy); aeCtx.lineTo(ex, ey); aeCtx.stroke();
                aeCtx.setLineDash([]);
            }
        } else if (aeWaveStage === 2 && aeWaveP0 && aeWaveP1) {
            const ends = aeWaveOrderedEnds();
            if (ends && ends.tMax > ends.tMin) {
                const pts = aeBuildWavePoints(shape, ends.tMin, ends.tMax, ends.vMin, ends.vMax, aeWaveCycles, aeWaveAmp);
                if (pts.length > 0) {
                    aeCtx.strokeStyle = isDark ? 'rgba(250, 250, 250, 0.85)' : 'rgba(40, 40, 60, 0.9)';
                    aeCtx.lineWidth = 1.5;
                    aeCtx.setLineDash([4, 3]);
                    aeCtx.beginPath();
                    aeCtx.moveTo(aeTickToX(pts[0].tick), aeValueToY(pts[0].normValue));
                    for (let i = 1; i < pts.length; i++) {
                        aeCtx.lineTo(aeTickToX(pts[i].tick), aeValueToY(pts[i].normValue));
                    }
                    aeCtx.stroke();
                    aeCtx.setLineDash([]);
                }
                const sx0 = aeTickToX(ends.tMin);
                const sy0 = aeValueToY(ends.vMin);
                const sx1 = aeTickToX(ends.tMax);
                const sy1 = aeValueToY(ends.vMax);
                aeCtx.fillStyle = '#ffffff';
                aeCtx.beginPath(); aeCtx.arc(sx0, sy0, 3.5, 0, Math.PI * 2); aeCtx.fill();
                aeCtx.beginPath(); aeCtx.arc(sx1, sy1, 3.5, 0, Math.PI * 2); aeCtx.fill();
                if (aeWaveStage === 2 && aeWavePivotPx) {
                    aeCtx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.5)' : 'rgba(100, 100, 120, 0.55)';
                    aeCtx.lineWidth = 1;
                    aeCtx.setLineDash([2, 4]);
                    aeCtx.beginPath();
                    const fx = Math.max(0, Math.min(aeW, aeWaveMousePxX));
                    aeCtx.moveTo(fx, 0);
                    aeCtx.lineTo(fx, aeH);
                    aeCtx.moveTo(0, aeWavePivotPx.y);
                    aeCtx.lineTo(aeW, aeWavePivotPx.y);
                    aeCtx.stroke();
                    aeCtx.setLineDash([]);
                }
            }
        }
    }

    // Playback line
    const pbX = aeTickToX(state.playbackTick);
    if (pbX >= 0 && pbX <= aeW) {
        aeCtx.strokeStyle = t.playbackLine;
        aeCtx.lineWidth = 1.5;
        aeCtx.beginPath(); aeCtx.moveTo(pbX, 0); aeCtx.lineTo(pbX, aeH); aeCtx.stroke();
    }

    // Value labels on left edge
    aeCtx.fillStyle = isDark ? '#888' : '#666';
    aeCtx.font = '9px monospace';
    aeCtx.textBaseline = 'middle';
    const labelInfo = info.kind === 'pb'
        ? [{v:1, t:'Max'}, {v:0.5, t:'Ctr'}, {v:0, t:'Min'}]
        : [{v:1, t:'127'}, {v:0.5, t:'64'}, {v:0, t:'0'}];
    for (const l of labelInfo) {
        aeCtx.fillText(l.t, 2, aeValueToY(l.v));
    }

    // Erase tool: draw full-height selection indicator while dragging
    if (aeTool === 'erase' && aeDrawing && aeFreehandPoints.length > 0) {
        const ticks = aeFreehandPoints.map(p => p.tick);
        const tMin = Math.min(...ticks);
        const tMax = Math.max(...ticks);
        const xLeft = aeTickToX(tMin);
        const xRight = aeTickToX(tMax);
        const selW = Math.max(2, xRight - xLeft);
        aeCtx.fillStyle = isDark ? 'rgba(233, 69, 96, 0.2)' : 'rgba(214, 48, 74, 0.2)';
        aeCtx.fillRect(xLeft, 0, selW, aeH);
        aeCtx.strokeStyle = isDark ? 'rgba(233, 69, 96, 0.6)' : 'rgba(214, 48, 74, 0.6)';
        aeCtx.lineWidth = 1;
        aeCtx.strokeRect(xLeft, 0, selW, aeH);
    }

    // Select tool: range from notes or manual drag (copy/paste region)
    if (aeTool === 'select' && info) {
        let t0;
        let t1;
        if (aeSelectDragging) {
            t0 = Math.min(aeSelectAnchorTick, aeSelectHoverTick);
            t1 = Math.max(aeSelectAnchorTick, aeSelectHoverTick);
        } else {
            const r = aeGetEffectiveSelectRange();
            if (r && r.endTick > r.startTick) {
                t0 = r.startTick;
                t1 = r.endTick;
            }
        }
        if (t0 !== undefined && t1 > t0) {
            const xLeft = aeTickToX(t0);
            const xRight = aeTickToX(t1);
            const selW = Math.max(2, xRight - xLeft);
            aeCtx.fillStyle = isDark ? 'rgba(14, 165, 233, 0.15)' : 'rgba(2, 132, 199, 0.18)';
            aeCtx.fillRect(xLeft, 0, selW, aeH);
            aeCtx.strokeStyle = isDark ? 'rgba(14, 165, 233, 0.55)' : 'rgba(2, 132, 199, 0.65)';
            aeCtx.lineWidth = 1;
            aeCtx.strokeRect(xLeft, 0, selW, aeH);
        }
    }
}

// Track mouse position for line preview
let aeLineEnd = null;

// --- Tool switching ---
function aeSetTool(tool) {
    aeTool = tool;
    state.automationEditorTool = tool;
    aeLineStart = null; aeLineEnd = null;
    aeClearCurveDraft();
    aeClearWaveDraft();
    aeSelectDragging = false;
    document.querySelectorAll('#automation-editor-toolbar .ae-tool-btn').forEach(function(b) { b.classList.remove('active'); });
    const btn = document.getElementById('ae-tool-' + tool);
    if (btn) btn.classList.add('active');
    renderAutomationEditor();
}
document.getElementById('ae-tool-line').addEventListener('click', function() { aeSetTool('line'); });
document.getElementById('ae-tool-freehand').addEventListener('click', function() { aeSetTool('freehand'); });
document.getElementById('ae-tool-curve').addEventListener('click', function() { aeSetTool('curve'); });
document.getElementById('ae-tool-wave-sine').addEventListener('click', function() { aeSetTool('wave-sine'); });
document.getElementById('ae-tool-wave-square').addEventListener('click', function() { aeSetTool('wave-square'); });
document.getElementById('ae-tool-wave-saw').addEventListener('click', function() { aeSetTool('wave-saw'); });
document.getElementById('ae-tool-wave-triangle').addEventListener('click', function() { aeSetTool('wave-triangle'); });
document.getElementById('ae-tool-erase').addEventListener('click', function() { aeSetTool('erase'); });
document.getElementById('ae-tool-select').addEventListener('click', function() { aeSetTool('select'); });

if (aeToggleExpand) {
    aeToggleExpand.addEventListener('click', function() {
        aeSetAutomationEditorExpanded(!state.automationEditorExpanded);
    });
}

document.querySelectorAll('#automation-overlay-tabs .ae-overlay-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
        if (typeof window.setAutomationOverlayFromUi === 'function') {
            window.setAutomationOverlayFromUi(tab.getAttribute('data-overlay-value'));
        }
    });
});
aeSyncOverlayTabs();

// --- Expanded strip vertical resize (drag top edge) ---
if (aeStripResizeHandle) {
    aeStripResizeHandle.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        aeStripResizing = true;
        aeStripResizeStartY = e.clientY;
        aeStripResizeStartH = state.automationExpandedHeightPx;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    });
    aeStripResizeHandle.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            aeApplyExpandedHeightPx(state.automationExpandedHeightPx + 6);
            if (typeof resizeCanvases === 'function') resizeCanvases();
            if (typeof renderAll === 'function') renderAll();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            aeApplyExpandedHeightPx(state.automationExpandedHeightPx - 6);
            if (typeof resizeCanvases === 'function') resizeCanvases();
            if (typeof renderAll === 'function') renderAll();
        }
    });
}

document.addEventListener('mousemove', function(e) {
    if (!aeStripResizing) return;
    const dy = e.clientY - aeStripResizeStartY;
    aeApplyExpandedHeightPx(aeStripResizeStartH - dy);
    if (typeof resizeCanvases === 'function') resizeCanvases();
    if (typeof renderAll === 'function') renderAll();
});

document.addEventListener('mouseup', function() {
    if (!aeStripResizing) return;
    aeStripResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
});

window.addEventListener('resize', function() {
    if (state.automationEditorExpanded) aeApplyExpandedHeightPx(state.automationExpandedHeightPx);
});

// --- Mouse interactions ---
const aeValueDisplay = document.getElementById('ae-value-display');

function aeMousePos(e) {
    const r = aeCanvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function aeFormatValue(normVal) {
    const info = aeType();
    if (!info) return '';
    if (info.kind === 'pb') return Math.round(normVal * 16383).toString();
    return Math.round(normVal * 127).toString();
}

aeCanvas.addEventListener('mousedown', function(e) {
    if (!aeType()) return;
    e.preventDefault();
    const pos = aeMousePos(e);
    const tick = aeSnapTick(aeXToTick(pos.x));
    const val = aeYToValue(pos.y);

    if (aeTool === 'line') {
        if (!aeLineStart) {
            aeLineStart = { tick, value: val };
            aeLineEnd = null;
            renderAutomationEditor();
        } else {
            pushUndoState('draw automation line');
            const startTick = aeLineStart.tick;
            const startVal = aeLineStart.value;
            const endTick = tick;
            const endVal = val;
            const tickRange = Math.abs(endTick - startTick);
            const step = Math.max(1, TICKS_PER_SNAP);
            const points = [];
            const numSteps = Math.max(1, Math.ceil(tickRange / step));
            for (let i = 0; i <= numSteps; i++) {
                const tt = i / numSteps;
                points.push({
                    tick: aeSnapTick(startTick + (endTick - startTick) * tt),
                    normValue: startVal + (endVal - startVal) * tt
                });
            }
            points.sort((a, b) => a.tick - b.tick);
            const lineDeduped = [];
            for (let i = 0; i < points.length; i++) {
                const p = points[i];
                if (lineDeduped.length > 0 && lineDeduped[lineDeduped.length - 1].tick === p.tick) {
                    lineDeduped[lineDeduped.length - 1] = p;
                } else {
                    lineDeduped.push(p);
                }
            }
            aeWriteEvents(lineDeduped);
            aeLineStart = null; aeLineEnd = null;
            renderAll();
        }
    } else if (aeTool === 'curve') {
        if (aeCurveStage === 0) {
            aeCurveP0 = { tick, value: val };
            aeCurveStage = 1;
            renderAutomationEditor();
        } else if (aeCurveStage === 1) {
            const pA = aeCurveP0;
            const pB = { tick, value: val };
            if (pA.tick <= pB.tick) {
                aeCurveP0 = pA;
                aeCurveP2 = pB;
            } else {
                aeCurveP0 = pB;
                aeCurveP2 = pA;
            }
            aeCurveStage = 2;
            aeCurveMouse = {
                tick: (aeCurveP0.tick + aeCurveP2.tick) / 2,
                value: (aeCurveP0.value + aeCurveP2.value) / 2
            };
            renderAutomationEditor();
        } else {
            const p1 = { tick, value: val };
            pushUndoState('draw automation curve');
            const pts = aeSampleQuadraticBezier(aeCurveP0, p1, aeCurveP2);
            aeWriteEvents(pts);
            aeClearCurveDraft();
            renderAll();
        }
    } else if (aeIsWaveTool()) {
        if (aeWaveStage === 0) {
            aeWaveP0 = { tick: tick, value: val };
            aeWaveStage = 1;
            aeWaveMouseEnd = { tick: tick, value: val };
            renderAutomationEditor();
        } else if (aeWaveStage === 1) {
            aeWaveP1 = { tick: tick, value: val };
            aeWavePivotPx = { x: pos.x, y: pos.y };
            const endsTmp = aeWaveP0.tick <= aeWaveP1.tick
                ? { tMin: aeWaveP0.tick, tMax: aeWaveP1.tick }
                : { tMin: aeWaveP1.tick, tMax: aeWaveP0.tick };
            const spanTicks = endsTmp.tMax - endsTmp.tMin;
            aeWaveMousePxX = pos.x;
            aeWaveCycles = aeCyclesFromMouseX(pos.x, spanTicks);
            aeWaveAmp = Math.max(0.02, Math.min(0.5, 0.12 + (aeWavePivotPx.y - pos.y) / aeH * 0.45));
            aeWaveStage = 2;
            renderAutomationEditor();
        } else {
            const shape = aeWaveShapeFromTool();
            const ends = aeWaveOrderedEnds();
            if (!shape || !ends || ends.tMax <= ends.tMin) {
                aeClearWaveDraft();
                renderAutomationEditor();
            } else {
                pushUndoState('draw automation wave');
                const pts = aeBuildWavePoints(shape, ends.tMin, ends.tMax, ends.vMin, ends.vMax, aeWaveCycles, aeWaveAmp);
                aeWriteEvents(pts);
                aeClearWaveDraft();
                renderAll();
            }
        }
    } else if (aeTool === 'freehand') {
        pushUndoState('draw automation');
        aeDrawing = true;
        aeFreehandPoints = [{ tick, normValue: val }];
    } else if (aeTool === 'erase') {
        pushUndoState('erase automation');
        aeDrawing = true;
        aeFreehandPoints = [{ tick, normValue: val }];
    } else if (aeTool === 'select') {
        if (state.selectedNoteIds.size > 0) return;
        aeSelectDragging = true;
        aeSelectAnchorTick = tick;
        aeSelectHoverTick = tick;
        renderAutomationEditor();
    }
});

aeCanvas.addEventListener('mousemove', function(e) {
    if (!aeType()) return;
    const pos = aeMousePos(e);
    const tick = aeSnapTick(aeXToTick(pos.x));
    const val = aeYToValue(pos.y);

    if (aeIsWaveTool() && aeWaveStage === 2 && aeWavePivotPx) {
        const endsW = aeWaveOrderedEnds();
        const spanW = endsW ? endsW.tMax - endsW.tMin : 0;
        aeWaveMousePxX = pos.x;
        aeWaveCycles = aeCyclesFromMouseX(pos.x, spanW);
        aeWaveAmp = Math.max(0.02, Math.min(0.5, (aeWavePivotPx.y - pos.y) / aeH * 0.55 + 0.05));
        const maxC = aeWaveMaxCyclesForSpan(spanW);
        aeValueDisplay.textContent = 'cycles ' + aeWaveCycles.toFixed(2) + ' / max ' + maxC + '  amp ' + (aeWaveAmp * 100).toFixed(0) + '% — click to place';
    } else if (aeIsWaveTool() && aeWaveStage === 1) {
        aeWaveMouseEnd = { tick: tick, value: val };
        aeValueDisplay.textContent = aeFormatValue(val) + ' — second click end';
    } else if (aeIsWaveTool() && aeWaveStage === 0) {
        aeValueDisplay.textContent = aeFormatValue(val) + ' — first click start';
    } else {
        aeValueDisplay.textContent = aeFormatValue(val);
    }

    if (aeTool === 'line' && aeLineStart) {
        aeLineEnd = { tick, value: val };
        renderAutomationEditor();
    }

    if (aeTool === 'curve' && aeCurveStage === 2) {
        aeCurveMouse = { tick, value: val };
        renderAutomationEditor();
    }

    if (aeIsWaveTool() && aeWaveStage >= 1) {
        renderAutomationEditor();
    }

    if (aeTool === 'select' && aeSelectDragging) {
        aeSelectHoverTick = tick;
        renderAutomationEditor();
    }

    if (!aeDrawing) return;

    if (aeTool === 'freehand') {
        aeFreehandPoints.push({ tick, normValue: val });
        if (aeFreehandPoints.length >= 2) {
            const last2 = aeFreehandPoints.slice(-2);
            last2.sort((a, b) => a.tick - b.tick);
            aeWriteEvents(last2);
        }
        renderAll();
    } else if (aeTool === 'erase') {
        aeFreehandPoints.push({ tick, normValue: val });
        renderAutomationEditor();
    }
});

document.addEventListener('mouseup', function() {
    if (aeSelectDragging && aeTool === 'select') {
        aeSelectDragging = false;
        if (state.selectedNoteIds.size === 0) {
            const startTick = Math.min(aeSelectAnchorTick, aeSelectHoverTick);
            const endTick = Math.max(aeSelectAnchorTick, aeSelectHoverTick);
            if (endTick - startTick >= 1) {
                state.automationSelectTicks = { startTick: startTick, endTick: endTick };
            }
        }
        renderAll();
        return;
    }
    if (!aeDrawing) return;
    aeDrawing = false;

    if (aeTool === 'freehand') {
        if (aeFreehandPoints.length > 0) {
            const trimmed = aeTrimFreehandPointsSameTick(aeFreehandPoints);
            if (trimmed.length > 0) aeWriteEvents(trimmed);
        }
        aeFreehandPoints = [];
        renderAll();
    } else if (aeTool === 'erase') {
        if (aeFreehandPoints.length > 0) {
            const ticks = aeFreehandPoints.map(p => p.tick);
            const tMin = Math.min(...ticks);
            const tMax = Math.max(...ticks);
            aeEraseEvents(aeSnapTick(tMin), aeSnapTick(tMax));
        }
        aeFreehandPoints = [];
        renderAll();
    }
});

// Right-click cancels line / curve draft
aeCanvas.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    if (aeTool === 'line' && aeLineStart) {
        aeLineStart = null; aeLineEnd = null;
        renderAutomationEditor();
    }
    if (aeTool === 'curve' && aeCurveStage > 0) {
        aeClearCurveDraft();
        renderAutomationEditor();
    }
    if (aeTool === 'select' && aeSelectDragging) {
        aeSelectDragging = false;
        renderAutomationEditor();
    }
    if (aeIsWaveTool() && aeWaveStage > 0) {
        aeClearWaveDraft();
        renderAutomationEditor();
    }
});

aeCanvas.addEventListener('wheel', function(e) {
    if (state.automationEditorExpanded && typeof window.handleSequencerWheelEvent === 'function') {
        const pos = aeMousePos(e);
        window.handleSequencerWheelEvent(e, pos.x, pos.y);
        return;
    }
    e.preventDefault();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        const mouseX = e.clientX - aeCanvas.getBoundingClientRect().left;
        const tickUnderMouse = aeXToTick(mouseX);
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        aePixelsPerTick = Math.max(0.01, Math.min(10, aePixelsPerTick * factor));
        aeScrollX = tickUnderMouse * aePixelsPerTick - mouseX;
        aeScrollX = Math.max(0, aeScrollX);
        renderAutomationEditor();
        return;
    }
    aeScrollX = Math.max(0, aeScrollX + e.deltaX + (e.shiftKey ? e.deltaY : 0));
    renderAutomationEditor();
}, { passive: false });

// --- Expose for renderAll ---
window.renderAutomationEditor = renderAutomationEditor;
window.aeResize = aeResize;
window.aeSyncOverlayTabs = aeSyncOverlayTabs;
window.aeSetAutomationEditorExpanded = aeSetAutomationEditorExpanded;
window.tryCopyAutomation = tryCopyAutomation;
window.tryPasteAutomation = tryPasteAutomation;
window.aeSetTool = aeSetTool;

state.automationEditorTool = aeTool;

})();
