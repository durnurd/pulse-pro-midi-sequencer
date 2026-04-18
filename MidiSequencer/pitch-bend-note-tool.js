// pitch-bend-note-tool.js — Piano-roll pitch bend when automation overlay is Pitch bend (Pointer/Pencil).

/** Full pitch wheel (0–16383) maps to this many semitones up/down from center for edit + display. */
const PB_EDIT_SEMITONE_RANGE = 2;
/** Horizontal width (px) of start/end hit targets at note edges. */
const PITCH_BEND_HANDLE_PX = 10;
/** Radius (px) of the center Bezier control handle hit target. */
const PITCH_BEND_CENTER_HANDLE_R = 9;
/** Min / max pitch-bend events written along a note when rewriting (MIDI holds until next event). */
const PB_DENSE_MIN = 128;
const PB_DENSE_MAX = 512;

function isPitchBendOverlay() {
    return state.automationOverlay === 'pitchBend';
}

/**
 * Normalized time (0–1) along the note where the center pitch handle is drawn.
 * Matches Bezier u_c while dragging; 0.5 when idle so the diamond snaps back to the middle after release.
 * @param {object} note
 */
function pitchBendCenterHandleTimeFractionForNote(note) {
    if (!note) return 0.5;
    if (state.mode === 'pb-drag-center' && state.interactionNote && state.interactionNote.id === note.id
        && state.interactionData && typeof state.interactionData.pbUc === 'number') {
        return Math.max(0.02, Math.min(0.98, state.interactionData.pbUc));
    }
    return 0.5;
}

/**
 * Tick used for pitch offset at the center handle’s horizontal position along the note.
 * @param {object} note
 */
function pitchBendCenterHandleAnchorTick(note) {
    const u = pitchBendCenterHandleTimeFractionForNote(note);
    const t0 = note.startTick | 0;
    const t1 = t0 + (note.durationTicks | 0);
    const dur = Math.max(1, t1 - t0);
    if (dur <= 1) return t0;
    return Math.min(t1 - 1, Math.max(t0, Math.round(t0 + u * (dur - 1))));
}

function semitonesFromValue14(v) {
    return ((v | 0) - 8192) * PB_EDIT_SEMITONE_RANGE / 8192;
}

function value14FromSemitones(st) {
    const x = 8192 + st * 8192 / PB_EDIT_SEMITONE_RANGE;
    return Math.max(0, Math.min(16383, Math.round(x)));
}

function snapValue14ToHalfStep(v) {
    const st = semitonesFromValue14(v);
    const snapped = Math.round(st * 2) / 2;
    return value14FromSemitones(snapped);
}

/** Snap 14-bit pitch wheel to whole semitone steps (edit UI default). */
function snapValue14ToWholeStep(v) {
    const st = semitonesFromValue14(v);
    const snapped = Math.round(st);
    return value14FromSemitones(snapped);
}

function pitchBendVisualOffsetPxFromValue14(v) {
    const st = semitonesFromValue14(v);
    return -st * NOTE_HEIGHT;
}

function samplePitchBendValue14(ch, tick) {
    const t = tick | 0;
    const pb = state.pitchBends;
    let lo = 0;
    let hi = pb.length - 1;
    let best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (pb[mid].tick <= t) {
            best = mid;
            lo = mid + 1;
        } else hi = mid - 1;
    }
    let val = 8192;
    for (let j = best; j >= 0; j--) {
        if (pb[j].channel === ch) return pb[j].value | 0;
    }
    return val;
}

function pitchBendVisualOffsetPxAtTick(ch, tick) {
    return pitchBendVisualOffsetPxFromValue14(samplePitchBendValue14(ch, tick));
}

/** Max |vertical offset| (px) used when drawing / hit-testing pitch-bend overlay vs MIDI row. */
function pitchBendMaxVisualOffsetPx() {
    return PB_EDIT_SEMITONE_RANGE * NOTE_HEIGHT;
}

function sortPitchBendsInPlace() {
    state.pitchBends.sort((a, b) => a.tick - b.tick || a.channel - b.channel);
}

/**
 * Remove pitch bend events for one channel in [t0, t1) (half-open).
 * @param {number} ch
 * @param {number} t0
 * @param {number} t1
 */
function removePitchBendsInRange(ch, t0, t1) {
    state.pitchBends = state.pitchBends.filter(e =>
        !(e.channel === ch && e.tick >= t0 && e.tick < t1)
    );
}

/**
 * Value of channel bend strictly before tick (tick exclusive). Center if none.
 * @param {number} ch
 * @param {number} tick
 */
function samplePitchBendValue14BeforeTick(ch, tick) {
    if (tick <= 0) return 8192;
    return samplePitchBendValue14(ch, tick - 1);
}

/**
 * Topmost note under pointer accounting for pitch-bend vertical offset (overlay PB only).
 * @param {number} gx
 * @param {number} gy
 * @returns {object|null}
 */
function getNoteAtPitchBendVisual(gx, gy) {
    const tick = gx / SNAP_WIDTH;
    const expand = pitchBendMaxVisualOffsetPx();
    for (let i = state.notes.length - 1; i >= 0; i--) {
        const n = state.notes[i];
        const trk = state.tracks[n.track];
        if (trk && (trk.hidden || trk.locked)) continue;
        const nx = n.startTick * SNAP_WIDTH;
        const nw = n.durationTicks * SNAP_WIDTH;
        if (gx < nx || gx >= nx + nw) continue;
        const row = TOTAL_MIDI_NOTES - 1 - n.note;
        const rowTop = row * NOTE_HEIGHT;
        if (gy >= rowTop && gy < rowTop + NOTE_HEIGHT) return n;
        if (gy >= rowTop - expand && gy < rowTop + NOTE_HEIGHT + expand) {
            const tk = Math.max(n.startTick, Math.min(n.startTick + n.durationTicks - 1, tick));
            const off = pitchBendVisualOffsetPxAtTick(n.channel, tk);
            const ny = rowTop + off;
            if (gy >= ny && gy < ny + NOTE_HEIGHT) return n;
        }
    }
    return null;
}

/**
 * Hit test for pitch handles when overlay is pitch bend and tool is cursor or pencil (horizontal roll).
 * @param {number} gx
 * @param {number} gy
 * @returns {{ type: string, note: object } | null}
 */
function pitchBendHandleHitTest(gx, gy) {
    if (!isPitchBendOverlay()) return null;
    if (state.activeTool !== 'cursor' && state.activeTool !== 'pencil') return null;
    const note = getNoteAtPitchBendVisual(gx, gy);
    if (!note) return null;
    const nx = note.startTick * SNAP_WIDTH;
    const nw = note.durationTicks * SNAP_WIDTH;
    const rx = gx - nx;
    const hw = Math.min(PITCH_BEND_HANDLE_PX, Math.max(4, nw / 4));
    const offL = pitchBendVisualOffsetPxAtTick(note.channel, note.startTick);
    const offR = pitchBendVisualOffsetPxAtTick(note.channel, Math.max(note.startTick, note.startTick + note.durationTicks - 1));
    const row = TOTAL_MIDI_NOTES - 1 - note.note;
    const baseY = row * NOTE_HEIGHT;
    if (rx < hw && gy >= baseY + offL && gy < baseY + NOTE_HEIGHT + offL) {
        return { type: 'pb-handle-left', note };
    }
    if (rx > nw - hw && gy >= baseY + offR && gy < baseY + NOTE_HEIGHT + offR) {
        return { type: 'pb-handle-right', note };
    }
    if (rx >= hw && rx <= nw - hw) {
        const uC = pitchBendCenterHandleTimeFractionForNote(note);
        const tickM = pitchBendCenterHandleAnchorTick(note);
        const cx = nx + nw * uC;
        const offM = pitchBendVisualOffsetPxAtTick(note.channel, tickM);
        const cy = baseY + offM + NOTE_HEIGHT / 2;
        const rr = Math.min(PITCH_BEND_CENTER_HANDLE_R + 4, Math.max(PITCH_BEND_CENTER_HANDLE_R, nw * 0.12));
        const dx = gx - cx;
        const dy = gy - cy;
        if (dx * dx + dy * dy <= rr * rr) {
            return { type: 'pb-handle-center', note };
        }
    }
    return null;
}

/**
 * Pitch handle hit test when vertical piano roll is on (canvas-local lx, ly).
 * @param {number} lx
 * @param {number} ly
 * @returns {{ type: string, note: object } | null}
 */
function pitchBendHandleHitTestVerticalCanvas(lx, ly) {
    if (!isPitchBendOverlay()) return null;
    if (state.activeTool !== 'cursor' && state.activeTool !== 'pencil') return null;
    const pb = state.playbackTick;
    const seamY = state.gridHeight - 1;
    const pan = state.verticalTimePanPx;
    const tickAt = pb + (seamY - ly + pan) / SNAP_WIDTH;
    const gwX = tickAt * SNAP_WIDTH;
    const pitchWorld = lx + state.scrollX;
    for (let i = state.notes.length - 1; i >= 0; i--) {
        const n = state.notes[i];
        const trk = state.tracks[n.track];
        if (trk && (trk.hidden || trk.locked)) continue;
        const t0 = n.startTick * SNAP_WIDTH;
        const t1 = (n.startTick + n.durationTicks) * SNAP_WIDTH;
        if (gwX < t0 || gwX >= t1) continue;
        const tk = Math.max(n.startTick, Math.min(n.startTick + n.durationTicks - 1, Math.floor(tickAt)));
        const off = -pitchBendVisualOffsetPxAtTick(n.channel, tk);
        const baseX = n.note * NOTE_HEIGHT;
        if (pitchWorld < baseX + off || pitchWorld >= baseX + NOTE_HEIGHT + off) continue;
        const yBottom = seamY - (n.startTick - pb) * SNAP_WIDTH + pan;
        const yTop = seamY - (n.startTick + n.durationTicks - pb) * SNAP_WIDTH + pan;
        const nh = Math.abs(yBottom - yTop);
        const hw = Math.min(PITCH_BEND_HANDLE_PX, Math.max(4, nh / 4));
        if (nh <= 0) continue;
        if (Math.abs(ly - yBottom) <= hw) return { type: 'pb-handle-left', note: n };
        if (Math.abs(ly - yTop) <= hw) return { type: 'pb-handle-right', note: n };
        const dur = Math.max(1, n.durationTicks);
        const uC = pitchBendCenterHandleTimeFractionForNote(n);
        const tickM = pitchBendCenterHandleAnchorTick(n);
        const frac = dur <= 1 ? 0 : uC;
        const py = yBottom - frac * (yBottom - yTop);
        const offM = -pitchBendVisualOffsetPxAtTick(n.channel, tickM);
        const nwV = NOTE_HEIGHT;
        const cx = n.note * NOTE_HEIGHT + offM + nwV / 2;
        const pxHit = pitchWorld;
        const rr = Math.min(PITCH_BEND_CENTER_HANDLE_R + 4, Math.max(PITCH_BEND_CENTER_HANDLE_R, Math.abs(nh) * 0.12));
        const dx = pxHit - cx;
        const dy = ly - py;
        if (dx * dx + dy * dy <= rr * rr) {
            return { type: 'pb-handle-center', note: n };
        }
    }
    return null;
}

function pitchBendHandleHitTestUnified(lx, ly) {
    if (!isPitchBendOverlay()) return null;
    if (state.activeTool !== 'cursor' && state.activeTool !== 'pencil') return null;
    if (state.verticalPianoRoll) return pitchBendHandleHitTestVerticalCanvas(lx, ly);
    return pitchBendHandleHitTest(lx + state.scrollX, ly + state.scrollY);
}

/**
 * Build deviation map from linear spine for events in [T0, T1).
 * @param {number} ch
 * @param {number} t0
 * @param {number} t1
 * @param {number} vStart0
 * @param {number} vEnd0
 * @returns {Map<number, number>} tick -> deviation in raw value units (before snap)
 */
function pitchBendSpineDeviations(ch, t0, t1, vStart0, vEnd0) {
    const span = Math.max(1, t1 - t0);
    const dev = new Map();
    for (const e of state.pitchBends) {
        if (e.channel !== ch || e.tick < t0 || e.tick >= t1) continue;
        const u = (e.tick - t0) / span;
        const spine = vStart0 + (vEnd0 - vStart0) * u;
        dev.set(e.tick, (e.value | 0) - spine);
    }
    const tLast = Math.max(t0, t1 - 1);
    if (!dev.has(tLast)) {
        const u = (tLast - t0) / span;
        const spine = vStart0 + (vEnd0 - vStart0) * u;
        dev.set(tLast, samplePitchBendValue14(ch, tLast) - spine);
    }
    if (!dev.has(t0)) {
        dev.set(t0, samplePitchBendValue14(ch, t0) - vStart0);
    }
    return dev;
}

/**
 * Evenly spaced ticks in [t0, t1) so MIDI has enough points to follow a ramp (hold-until-next semantics).
 * @param {number} t0
 * @param {number} t1
 * @returns {number[]}
 */
function pitchBendDenseTickList(t0, t1) {
    const span = Math.max(1, t1 - t0);
    const numPts = Math.min(PB_DENSE_MAX, Math.max(PB_DENSE_MIN, 1 + Math.ceil(span / 192)));
    const ticks = new Set();
    for (let i = 0; i < numPts; i++) {
        const tk = t0 + Math.round((i * (span - 1)) / Math.max(1, numPts - 1));
        if (tk >= t0 && tk < t1) ticks.add(tk);
    }
    ticks.add(t0);
    if (span > 1) ticks.add(t1 - 1);
    return Array.from(ticks).sort((a, b) => a - b);
}

/**
 * Linear interpolation of deviation (from snapshot spine) at tick tk using known keys.
 * @param {Map<number, number>} devByTick
 * @param {number[]} keysSorted
 * @param {number} t0
 * @param {number} t1
 * @param {number} tk
 */
function pitchBendInterpolatedDev(devByTick, keysSorted, t0, t1, tk) {
    if (keysSorted.length === 0) return 0;
    if (keysSorted.length === 1) return devByTick.get(keysSorted[0]) || 0;
    if (tk <= keysSorted[0]) return devByTick.get(keysSorted[0]) || 0;
    const kLast = keysSorted[keysSorted.length - 1];
    if (tk >= kLast) return devByTick.get(kLast) || 0;
    let lo = 0;
    let hi = keysSorted.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (keysSorted[mid] <= tk) lo = mid;
        else hi = mid;
    }
    const k0 = keysSorted[lo];
    const k1 = keysSorted[hi];
    const v0 = devByTick.get(k0) || 0;
    const v1 = devByTick.get(k1) || 0;
    if (k1 <= k0) return v0;
    const f = (tk - k0) / (k1 - k0);
    return v0 + (v1 - v0) * f;
}

/** Clamp to valid 14-bit pitch wheel (no half-step quantization). */
function clampPitchBend14(v) {
    return Math.max(0, Math.min(16383, Math.round(v)));
}

/**
 * Rewrite channel pitch bends on [t0, t1): endpoints snap to whole semitones; interior linearly interpolates in 14-bit.
 * @param {number} ch
 * @param {number} t0
 * @param {number} t1
 * @param {number} vStart raw anchor at note start (snapped inside this function)
 * @param {number} vEnd raw anchor at note end (last tick inside note; snapped inside)
 * @param {Map<number, number>} devByTick
 */
function rewritePitchBendRangeWithSpine(ch, t0, t1, vStart, vEnd, devByTick) {
    const span = Math.max(1, t1 - t0);
    const va = snapValue14ToWholeStep(vStart | 0);
    const vb = snapValue14ToWholeStep(vEnd | 0);
    removePitchBendsInRange(ch, t0, t1);
    const keysSorted = [...devByTick.keys()].filter(k => k >= t0 && k < t1).sort((a, b) => a - b);
    const sortedTicks = pitchBendDenseTickList(t0, t1);
    const tLastIn = t1 - 1;
    for (const tk of sortedTicks) {
        let raw;
        if (tk === t0) {
            raw = va;
        } else if (span > 1 && tk === tLastIn) {
            raw = vb;
        } else {
            const u = (tk - t0) / span;
            const spine = va + (vb - va) * u;
            const d = pitchBendInterpolatedDev(devByTick, keysSorted, t0, t1, tk);
            raw = spine + d;
        }
        state.pitchBends.push({
            tick: tk,
            channel: ch,
            value: clampPitchBend14(raw),
        });
    }
    sortPitchBendsInPlace();
}

/**
 * Ensure bend returns to vPre at note end tick (start + duration).
 * @param {object} note
 * @param {number} vPre
 */
function ensurePitchRestoreAfterNote(note, vPre) {
    const ch = note.channel | 0;
    const endTick = note.startTick + note.durationTicks;
    state.pitchBends = state.pitchBends.filter(e => !(e.channel === ch && e.tick === endTick));
    state.pitchBends.push({ tick: endTick, channel: ch, value: clampPitchBend14(vPre | 0) });
    sortPitchBendsInPlace();
}

/**
 * Bezier time axis x(u) for quadratic (0,0)-(uControl,s)-(1,1) in normalized time; x runs 0→1 as u runs 0→1.
 * @param {number} u
 * @param {number} uControl horizontal control (0,1), not at endpoints
 */
function pitchBendBezierTimeX(u, uControl) {
    const uc = uControl;
    return 2 * uc * u * (1 - u) + u * u;
}

/**
 * Given linear timeline position w in [0,1], find u in [0,1] with pitchBendBezierTimeX(u, uc) === w.
 */
function pitchBendSolveUFromLinearTime(w, uControl) {
    const wcl = Math.max(0, Math.min(1, w));
    const uc = Math.max(0.001, Math.min(0.999, uControl));
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 48; i++) {
        const mid = (lo + hi) * 0.5;
        if (pitchBendBezierTimeX(mid, uc) < wcl) lo = mid;
        else hi = mid;
    }
    return (lo + hi) * 0.5;
}

/** Quadratic Bezier scalar on u in [0,1]. */
function pitchBendQuadraticScalar(u, s0, s1, s2) {
    const om = 1 - u;
    return om * om * s0 + 2 * om * u * s1 + u * u * s2;
}

/**
 * Replace [t0, t1) pitch bends with a quadratic Bezier in semitone space.
 * Endpoints fixed at va14/vb14 (whole-step anchors); interior follows (time x(u), pitch y(u))
 * with one movable control (sc semitones, continuous; uc horizontal Bezier control).
 */
function rewritePitchBendRangeQuadraticBezier(ch, t0, t1, va14, vb14, sc, uc, note, vPre14) {
    const span = Math.max(1, t1 - t0);
    const s0 = semitonesFromValue14(va14 | 0);
    const s2 = semitonesFromValue14(vb14 | 0);
    removePitchBendsInRange(ch, t0, t1);
    const sortedTicks = pitchBendDenseTickList(t0, t1);
    const tLastIn = t1 - 1;
    for (const tk of sortedTicks) {
        const w = span <= 1 ? 0 : (tk - t0) / span;
        const u = pitchBendSolveUFromLinearTime(w, uc);
        const s = pitchBendQuadraticScalar(u, s0, sc, s2);
        let raw = clampPitchBend14(value14FromSemitones(s));
        if (tk === t0) raw = va14 | 0;
        else if (span > 1 && tk === tLastIn) raw = vb14 | 0;
        state.pitchBends.push({ tick: tk, channel: ch, value: raw });
    }
    sortPitchBendsInPlace();
    ensurePitchRestoreAfterNote(note, vPre14 | 0);
}

/**
 * Flat bend on [t0, t1) at value14, then restore vPre at t1.
 * @param {number} ch
 * @param {number} t0
 * @param {number} t1
 * @param {number} value14
 * @param {number} vPre
 */
function applyFlatPitchBendForNotePlacement(ch, t0, t1, value14, vPre) {
    removePitchBendsInRange(ch, t0, t1);
    const vSnapped = snapValue14ToWholeStep(value14 | 0);
    for (const tk of pitchBendDenseTickList(t0, t1)) {
        state.pitchBends.push({ tick: tk, channel: ch, value: clampPitchBend14(vSnapped) });
    }
    sortPitchBendsInPlace();
    const fake = { channel: ch, startTick: t0, durationTicks: t1 - t0 };
    ensurePitchRestoreAfterNote(fake, vPre);
}

/**
 * While placing a note with pitch-bend overlay + pencil, rewrite channel bends to a linear ramp
 * from the bend before note start (interactionData.placeBendVPre) to the end value from vertical drag.
 * Restores any pre-existing bends on this channel strictly after the current note end from placeBendTailBackup
 * (captured at mousedown) so extending then shrinking the placement scrubber does not erase later automation.
 * @param {object} note
 * @param {object} d state.interactionData
 */
function pitchBendSyncPlacementRamp(note, d) {
    if (!note || !d || d.placeBendStartGy == null || d.placeBendVPre === undefined) return;
    const ch = note.channel | 0;
    const t0 = note.startTick | 0;
    const t1 = t0 + (note.durationTicks | 0);
    const tail = d.placeBendTailBackup;
    state.pitchBends = state.pitchBends.filter(e => !(e.channel === ch && e.tick >= t0));
    if (Array.isArray(tail)) {
        for (const b of tail) {
            if ((b.channel | 0) === ch && (b.tick | 0) > t1) {
                state.pitchBends.push({ tick: b.tick | 0, channel: ch, value: clampPitchBend14(b.value | 0) });
            }
        }
    }
    const vStart = d.placeBendVPre | 0;
    const vEnd = placementDyToSnappedValue14(d.placeBendAccDy || 0);
    rewritePitchBendRangeWithSpine(ch, t0, t1, vStart, vEnd, new Map());
    ensurePitchRestoreAfterNote(note, d.placeBendVPre | 0);
    if (d.placeBendLastPreviewValue14 != null && d.placeBendLastPreviewValue14 !== vEnd
        && typeof audioEngine !== 'undefined' && audioEngine) {
        const nn = note.note | 0;
        audioEngine.noteOff(nn, ch);
        audioEngine.noteOn(nn, ch);
    }
    d.placeBendLastPreviewValue14 = vEnd;
    if (typeof audioEngine !== 'undefined' && audioEngine && typeof audioEngine.pitchWheel === 'function') {
        audioEngine.pitchWheel(ch, clampPitchBend14(placementDyToSnappedValue14(d.placeBendAccDy || 0)));
    }
}

/**
 * Map vertical pixel delta (grid space, positive = down) to whole-semitone-snapped bend value from center.
 * @param {number} dyPx
 */
function placementDyToSnappedValue14(dyPx) {
    const st = -dyPx / NOTE_HEIGHT;
    const snapped = Math.round(st);
    return value14FromSemitones(snapped);
}

window.isPitchBendOverlay = isPitchBendOverlay;
window.pitchBendCenterHandleTimeFractionForNote = pitchBendCenterHandleTimeFractionForNote;
window.pitchBendCenterHandleAnchorTick = pitchBendCenterHandleAnchorTick;
window.PITCH_BEND_HANDLE_PX = PITCH_BEND_HANDLE_PX;
window.PITCH_BEND_CENTER_HANDLE_R = PITCH_BEND_CENTER_HANDLE_R;
window.semitonesFromValue14 = semitonesFromValue14;
window.value14FromSemitones = value14FromSemitones;
window.snapValue14ToHalfStep = snapValue14ToHalfStep;
window.snapValue14ToWholeStep = snapValue14ToWholeStep;
window.pitchBendVisualOffsetPxFromValue14 = pitchBendVisualOffsetPxFromValue14;
window.samplePitchBendValue14 = samplePitchBendValue14;
window.pitchBendVisualOffsetPxAtTick = pitchBendVisualOffsetPxAtTick;
window.getNoteAtPitchBendVisual = getNoteAtPitchBendVisual;
window.pitchBendHandleHitTest = pitchBendHandleHitTest;
window.pitchBendHandleHitTestVerticalCanvas = pitchBendHandleHitTestVerticalCanvas;
window.pitchBendHandleHitTestUnified = pitchBendHandleHitTestUnified;
window.pitchBendSpineDeviations = pitchBendSpineDeviations;
window.rewritePitchBendRangeWithSpine = rewritePitchBendRangeWithSpine;
window.ensurePitchRestoreAfterNote = ensurePitchRestoreAfterNote;
window.applyFlatPitchBendForNotePlacement = applyFlatPitchBendForNotePlacement;
window.pitchBendSyncPlacementRamp = pitchBendSyncPlacementRamp;
window.placementDyToSnappedValue14 = placementDyToSnappedValue14;
window.samplePitchBendValue14BeforeTick = samplePitchBendValue14BeforeTick;
window.pitchBendMaxVisualOffsetPx = pitchBendMaxVisualOffsetPx;

function pitchBendBuildCenterDragState(note, gx, gy) {
    const ch = note.channel | 0;
    const t0 = note.startTick | 0;
    const t1 = note.startTick + note.durationTicks;
    const vPre = samplePitchBendValue14BeforeTick(ch, t0);
    const v0 = samplePitchBendValue14(ch, t0) | 0;
    const v2 = samplePitchBendValue14(ch, Math.max(t0, t1 - 1)) | 0;
    const va = snapValue14ToWholeStep(v0);
    const vb = snapValue14ToWholeStep(v2);
    const s0 = semitonesFromValue14(va);
    const s2 = semitonesFromValue14(vb);
    const dur = Math.max(1, t1 - t0);
    const midTick = Math.min(t1 - 1, Math.max(t0, t0 + Math.floor(dur / 2)));
    const sMid = semitonesFromValue14(samplePitchBendValue14(ch, midTick));
    const scInit = 2 * sMid - 0.5 * (s0 + s2);
    return {
        pbNote: note,
        pbT0: t0,
        pbT1: t1,
        pbVPre: vPre,
        pbVA: va,
        pbVB: vb,
        pbS0: s0,
        pbS2: s2,
        pbInitSc: scInit,
        pbSc: scInit,
        pbInitUc: 0.5,
        pbUc: 0.5,
        startGx: gx,
        startGy: gy,
    };
}

function pitchBendApplyCenterHandleDrag(d, gx, gy) {
    const note = d.pbNote;
    const nw = Math.max(32, note.durationTicks * SNAP_WIDTH);
    d.pbUc = Math.max(0.08, Math.min(0.92, d.pbInitUc + ((gx - d.startGx) / nw) * 1.35));
    d.pbSc = d.pbInitSc - (gy - d.startGy) / NOTE_HEIGHT;
    const ch = note.channel | 0;
    rewritePitchBendRangeQuadraticBezier(ch, d.pbT0, d.pbT1, d.pbVA, d.pbVB, d.pbSc, d.pbUc, note, d.pbVPre);
    if (typeof audioEngine !== 'undefined' && audioEngine && typeof audioEngine.pitchWheel === 'function') {
        const span = Math.max(1, d.pbT1 - d.pbT0);
        const midT = Math.min(d.pbT1 - 1, Math.max(d.pbT0, d.pbT0 + Math.floor(span / 2)));
        const w = span <= 1 ? 0 : (midT - d.pbT0) / span;
        const u = pitchBendSolveUFromLinearTime(w, d.pbUc);
        const s = pitchBendQuadraticScalar(u, d.pbS0, d.pbSc, d.pbS2);
        audioEngine.pitchWheel(ch, clampPitchBend14(value14FromSemitones(s)));
    }
}

function pitchBendBuildHandleDragState(note, handle, gy) {
    const ch = note.channel | 0;
    const t0 = note.startTick | 0;
    const t1 = note.startTick + note.durationTicks;
    const vStart0 = samplePitchBendValue14(ch, t0);
    const vEnd0 = samplePitchBendValue14(ch, Math.max(t0, t1 - 1));
    const dev = pitchBendSpineDeviations(ch, t0, t1, vStart0, vEnd0);
    const vPre = samplePitchBendValue14BeforeTick(ch, t0);
    const v0eff = snapValue14ToWholeStep(vStart0 | 0);
    const v1eff = snapValue14ToWholeStep(vEnd0 | 0);
    return {
        pbNote: note,
        pbHandle: handle,
        pbT0: t0,
        pbT1: t1,
        pbVStart0: vStart0,
        pbVEnd0: vEnd0,
        pbDevByTick: dev,
        pbVPre: vPre,
        startMouseGy: gy,
        pbLastPreviewValue14: handle === 'left' ? v0eff : v1eff,
    };
}

function pitchBendApplyHandleDragFromMouseGy(d, gy) {
    const ch = d.pbNote.channel | 0;
    const dSem = -(gy - d.startMouseGy) / NOTE_HEIGHT;
    let vEff;
    if (d.pbHandle === 'left') {
        const st = Math.round(semitonesFromValue14(d.pbVStart0) + dSem);
        const vStartNew = value14FromSemitones(st);
        rewritePitchBendRangeWithSpine(ch, d.pbT0, d.pbT1, vStartNew, d.pbVEnd0, d.pbDevByTick);
        vEff = snapValue14ToWholeStep(vStartNew | 0);
    } else {
        const st = Math.round(semitonesFromValue14(d.pbVEnd0) + dSem);
        const vEndNew = value14FromSemitones(st);
        rewritePitchBendRangeWithSpine(ch, d.pbT0, d.pbT1, d.pbVStart0, vEndNew, d.pbDevByTick);
        vEff = snapValue14ToWholeStep(vEndNew | 0);
    }
    ensurePitchRestoreAfterNote(d.pbNote, d.pbVPre);
    if (typeof d.pbLastPreviewValue14 === 'number' && d.pbLastPreviewValue14 !== vEff
        && typeof audioEngine !== 'undefined' && audioEngine) {
        const nn = d.pbNote.note | 0;
        audioEngine.noteOff(nn, ch);
        audioEngine.noteOn(nn, ch);
        if (typeof audioEngine.pitchWheel === 'function') {
            const tickWheel = d.pbHandle === 'left' ? d.pbT0 : Math.max(d.pbT0, d.pbT1 - 1);
            audioEngine.pitchWheel(ch, clampPitchBend14(samplePitchBendValue14(ch, tickWheel)));
        }
    }
    d.pbLastPreviewValue14 = vEff;
}

/**
 * Context menu on a pitch-bend overlay handle: left/right snaps that endpoint to wheel center (8192)
 * while preserving interior shape via spine deviations; center removes curve (linear start→end).
 * @param {{ type: string, note: object }} hit
 */
function pitchBendRightClickHandle(hit) {
    const note = hit.note;
    if (!note || !hit.type) return;
    const ch = note.channel | 0;
    const t0 = note.startTick | 0;
    const t1 = note.startTick + note.durationTicks;
    const vPre = samplePitchBendValue14BeforeTick(ch, t0);
    if (hit.type === 'pb-handle-center') {
        const v0 = samplePitchBendValue14(ch, t0);
        const v2 = samplePitchBendValue14(ch, Math.max(t0, t1 - 1));
        rewritePitchBendRangeWithSpine(ch, t0, t1, v0, v2, new Map());
        ensurePitchRestoreAfterNote(note, vPre);
        return;
    }
    if (hit.type !== 'pb-handle-left' && hit.type !== 'pb-handle-right') return;
    const v0 = samplePitchBendValue14(ch, t0);
    const v2 = samplePitchBendValue14(ch, Math.max(t0, t1 - 1));
    const dev = pitchBendSpineDeviations(ch, t0, t1, v0, v2);
    const center14 = 8192;
    if (hit.type === 'pb-handle-left') {
        rewritePitchBendRangeWithSpine(ch, t0, t1, center14, v2, dev);
    } else {
        rewritePitchBendRangeWithSpine(ch, t0, t1, v0, center14, dev);
    }
    ensurePitchRestoreAfterNote(note, vPre);
}

window.pitchBendBuildHandleDragState = pitchBendBuildHandleDragState;
window.pitchBendBuildCenterDragState = pitchBendBuildCenterDragState;
window.pitchBendApplyCenterHandleDrag = pitchBendApplyCenterHandleDrag;
window.pitchBendApplyHandleDragFromMouseGy = pitchBendApplyHandleDragFromMouseGy;
window.pitchBendRightClickHandle = pitchBendRightClickHandle;
