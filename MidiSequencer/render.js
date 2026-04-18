// render.js - Canvas rendering
const gridCanvas = document.getElementById('grid-canvas');
const gridCtx = gridCanvas.getContext('2d');
const keyCanvas = document.getElementById('keyboard-canvas');
const keyCtx = keyCanvas.getContext('2d');
const pbCanvas = document.getElementById('playback-canvas');
const pbCtx = pbCanvas.getContext('2d');

/** Per-note pitch-bend ribbon stroke (px); fixed so it does not scale with NOTE_HEIGHT / vertical zoom. */
const PITCH_BEND_NOTE_RIBBON_LINE_PX = 2;

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

function getMaxPitchScrollPx() {
    return Math.max(0, TOTAL_MIDI_NOTES * NOTE_HEIGHT - state.gridWidth);
}

function getVerticalTimePanMaxPx() {
    const spanTicks = typeof getTimelineSpanTicks === 'function' ? getTimelineSpanTicks() : Math.max(MIDI_TPQN * 4, getEndTick());
    return Math.max(0, spanTicks * SNAP_WIDTH - state.gridHeight);
}

function drawPitchBendRibbonSampleSteps(nwPx, nhPx, isVertical) {
    const len = isVertical ? Math.abs(nhPx || 0) : (nwPx || 0);
    return Math.min(2048, Math.max(160, Math.ceil(Math.max(len, 12))));
}

function drawPitchBendHorizontalNoteRibbon(gridCtx, n, nx, nw, row, sy) {
    if (typeof pitchBendVisualOffsetPxAtTick !== 'function') return;
    const baseRowY = row * NOTE_HEIGHT - sy;
    const steps = drawPitchBendRibbonSampleSteps(nw, 0, false);
    const dur = Math.max(1, n.durationTicks);
    gridCtx.save();
    gridCtx.globalAlpha = currentTheme === 'dark' ? 0.5 : 0.48;
    gridCtx.strokeStyle = currentTheme === 'dark' ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.85)';
    gridCtx.lineWidth = PITCH_BEND_NOTE_RIBBON_LINE_PX;
    gridCtx.lineJoin = 'round';
    gridCtx.lineCap = 'round';
    gridCtx.beginPath();
    for (let s = 0; s <= steps; s++) {
        const frac = s / steps;
        const px = nx + frac * nw;
        const tickR = dur <= 1 ? n.startTick
            : Math.min(n.startTick + n.durationTicks - 1, Math.round(n.startTick + frac * (dur - 1)));
        const off = pitchBendVisualOffsetPxAtTick(n.channel, tickR);
        const pyCenter = baseRowY + off + NOTE_HEIGHT / 2;
        if (s === 0) gridCtx.moveTo(px, pyCenter);
        else gridCtx.lineTo(px, pyCenter);
    }
    gridCtx.stroke();
    gridCtx.restore();
}

function drawPitchBendHorizontalHandles(gridCtx, n, nx, nw, row, sy) {
    if (typeof pitchBendVisualOffsetPxAtTick !== 'function' || typeof PITCH_BEND_HANDLE_PX !== 'number') return;
    const baseRowY = row * NOTE_HEIGHT - sy;
    const hw = Math.min(PITCH_BEND_HANDLE_PX, Math.max(4, nw / 4));
    const offL = pitchBendVisualOffsetPxAtTick(n.channel, n.startTick);
    const offR = pitchBendVisualOffsetPxAtTick(n.channel, Math.max(n.startTick, n.startTick + n.durationTicks - 1));
    const cyL = baseRowY + offL + NOTE_HEIGHT / 2;
    const cyR = baseRowY + offR + NOTE_HEIGHT / 2;
    gridCtx.save();
    gridCtx.globalAlpha = 0.92;
    gridCtx.fillStyle = currentTheme === 'dark' ? '#dde0ff' : '#2a2a38';
    gridCtx.strokeStyle = currentTheme === 'dark' ? '#ffffff' : '#111111';
    gridCtx.lineWidth = 1;
    gridCtx.beginPath();
    gridCtx.rect(nx - 0.5, cyL - 5, hw + 1, 10);
    gridCtx.fill();
    gridCtx.stroke();
    gridCtx.beginPath();
    gridCtx.rect(nx + nw - hw - 0.5, cyR - 5, hw + 1, 10);
    gridCtx.fill();
    gridCtx.stroke();
    if (typeof PITCH_BEND_CENTER_HANDLE_R === 'number') {
        const uC = typeof window.pitchBendCenterHandleTimeFractionForNote === 'function'
            ? window.pitchBendCenterHandleTimeFractionForNote(n) : 0.5;
        let tickM;
        if (typeof window.pitchBendCenterHandleAnchorTick === 'function') {
            tickM = window.pitchBendCenterHandleAnchorTick(n);
        } else {
            const t0a = n.startTick | 0;
            const t1a = t0a + (n.durationTicks | 0);
            const dura = Math.max(1, t1a - t0a);
            tickM = dura <= 1 ? t0a : Math.min(t1a - 1, Math.max(t0a, Math.round(t0a + uC * (dura - 1))));
        }
        const cx = nx + nw * uC;
        const offM = pitchBendVisualOffsetPxAtTick(n.channel, tickM);
        const cy = baseRowY + offM + NOTE_HEIGHT / 2;
        const rr = Math.min(PITCH_BEND_CENTER_HANDLE_R + 2, Math.max(5, nw * 0.08));
        gridCtx.beginPath();
        gridCtx.moveTo(cx, cy - rr);
        gridCtx.lineTo(cx + rr, cy);
        gridCtx.lineTo(cx, cy + rr);
        gridCtx.lineTo(cx - rr, cy);
        gridCtx.closePath();
        gridCtx.fillStyle = currentTheme === 'dark' ? '#a8e6cf' : '#1a6b4a';
        gridCtx.fill();
        gridCtx.strokeStyle = currentTheme === 'dark' ? '#ffffff' : '#111111';
        gridCtx.lineWidth = 1;
        gridCtx.stroke();
    }
    gridCtx.restore();
}

function drawPitchBendVerticalNoteRibbon(gridCtx, n, xLeftBase, yTop, yBottom, nw, nh) {
    if (typeof pitchBendVisualOffsetPxAtTick !== 'function') return;
    const steps = drawPitchBendRibbonSampleSteps(0, nh, true);
    const dur = Math.max(1, n.durationTicks);
    gridCtx.save();
    gridCtx.globalAlpha = currentTheme === 'dark' ? 0.5 : 0.48;
    gridCtx.strokeStyle = currentTheme === 'dark' ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.85)';
    gridCtx.lineWidth = PITCH_BEND_NOTE_RIBBON_LINE_PX;
    gridCtx.lineJoin = 'round';
    gridCtx.lineCap = 'round';
    gridCtx.beginPath();
    for (let s = 0; s <= steps; s++) {
        const frac = s / steps;
        const tickR = dur <= 1 ? n.startTick
            : Math.min(n.startTick + n.durationTicks - 1, Math.round(n.startTick + frac * (dur - 1)));
        const py = yBottom - frac * (yBottom - yTop);
        const off = -pitchBendVisualOffsetPxAtTick(n.channel, tickR);
        const pxCenter = xLeftBase + off + nw / 2;
        if (s === 0) gridCtx.moveTo(pxCenter, py);
        else gridCtx.lineTo(pxCenter, py);
    }
    gridCtx.stroke();
    gridCtx.restore();
}

function drawPitchBendVerticalHandles(gridCtx, n, xLeftBase, yTop, yBottom, nw, nh) {
    if (typeof pitchBendVisualOffsetPxAtTick !== 'function' || typeof PITCH_BEND_HANDLE_PX !== 'number') return;
    const hw = Math.min(PITCH_BEND_HANDLE_PX, Math.max(4, Math.abs(nh) / 4));
    const offL = -pitchBendVisualOffsetPxAtTick(n.channel, n.startTick);
    const offR = -pitchBendVisualOffsetPxAtTick(n.channel, Math.max(n.startTick, n.startTick + n.durationTicks - 1));
    const cxL = xLeftBase + offL + nw / 2;
    const cxR = xLeftBase + offR + nw / 2;
    gridCtx.save();
    gridCtx.globalAlpha = 0.92;
    gridCtx.fillStyle = currentTheme === 'dark' ? '#dde0ff' : '#2a2a38';
    gridCtx.strokeStyle = currentTheme === 'dark' ? '#ffffff' : '#111111';
    gridCtx.lineWidth = 1;
    gridCtx.beginPath();
    gridCtx.rect(cxL - 5, yBottom - hw - 0.5, 10, hw + 1);
    gridCtx.fill();
    gridCtx.stroke();
    gridCtx.beginPath();
    gridCtx.rect(cxR - 5, yTop - 0.5, 10, hw + 1);
    gridCtx.fill();
    gridCtx.stroke();
    if (typeof PITCH_BEND_CENTER_HANDLE_R === 'number') {
        const dur = Math.max(1, n.durationTicks);
        const uC = typeof window.pitchBendCenterHandleTimeFractionForNote === 'function'
            ? window.pitchBendCenterHandleTimeFractionForNote(n) : 0.5;
        const tickM = typeof window.pitchBendCenterHandleAnchorTick === 'function'
            ? window.pitchBendCenterHandleAnchorTick(n)
            : Math.min(n.startTick + dur - 1, Math.max(n.startTick, Math.round(n.startTick + uC * (dur - 1))));
        const frac = dur <= 1 ? 0 : uC;
        const py = yBottom - frac * (yBottom - yTop);
        const offM = -pitchBendVisualOffsetPxAtTick(n.channel, tickM);
        const cx = xLeftBase + offM + nw / 2;
        const rr = Math.min(PITCH_BEND_CENTER_HANDLE_R + 2, Math.max(5, Math.abs(nh) * 0.08));
        gridCtx.beginPath();
        gridCtx.moveTo(cx, py - rr);
        gridCtx.lineTo(cx + rr, py);
        gridCtx.lineTo(cx, py + rr);
        gridCtx.lineTo(cx - rr, py);
        gridCtx.closePath();
        gridCtx.fillStyle = currentTheme === 'dark' ? '#a8e6cf' : '#1a6b4a';
        gridCtx.fill();
        gridCtx.strokeStyle = currentTheme === 'dark' ? '#ffffff' : '#111111';
        gridCtx.lineWidth = 1;
        gridCtx.stroke();
    }
    gridCtx.restore();
}

/** Tint + diagonal hatch so out-of-key rows read clearly vs black/white keys. */
function drawKeyLockRowDim(ctx, x, y, rw, rh, midiNote, th) {
    if (!isKeySignatureActive(state.keySignature)) return;
    if (midiNoteInKeySignature(midiNote, state.keySignature)) return;
    const overlay = th.keyLockRowOverlay;
    const hatch = th.keyLockRowHatch;
    if (!overlay) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, rw, rh);
    ctx.clip();
    ctx.fillStyle = overlay;
    ctx.fillRect(x, y, rw, rh);
    if (hatch) {
        ctx.strokeStyle = hatch;
        ctx.lineWidth = 1;
        const spacing = 5;
        for (let k = x - rh; k < x + rw + rh; k += spacing) {
            ctx.beginPath();
            ctx.moveTo(k, y);
            ctx.lineTo(k + rh, y + rh);
            ctx.stroke();
        }
    }
    ctx.restore();
}

function resizeCanvases() {
    const gridPanel = document.getElementById('grid-panel');
    const keyPanel = document.getElementById('keyboard-panel');

    const w = gridPanel.clientWidth;
    const gh = getElementContentHeight(gridPanel);
    const kh = getElementContentHeight(keyPanel);
    // Horizontal layout: keyboard and grid share a row — match heights. Vertical: grid is 1fr, keyboard is a separate strip — use full grid panel height.
    const h = state.verticalPianoRoll ? gh : Math.min(gh, kh);
    state.gridWidth = w;
    state.gridHeight = h;

    gridCanvas.width = w * devicePixelRatio;
    gridCanvas.height = h * devicePixelRatio;
    gridCanvas.style.width = w + 'px';
    gridCanvas.style.height = h + 'px';
    gridCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    if (state.verticalPianoRoll) {
        keyCanvas.width = w * devicePixelRatio;
        keyCanvas.height = KEYBOARD_WIDTH * devicePixelRatio;
        keyCanvas.style.width = w + 'px';
        keyCanvas.style.height = KEYBOARD_WIDTH + 'px';
    } else {
        keyCanvas.width = KEYBOARD_WIDTH * devicePixelRatio;
        keyCanvas.height = h * devicePixelRatio;
        keyCanvas.style.width = KEYBOARD_WIDTH + 'px';
        keyCanvas.style.height = h + 'px';
    }
    keyCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    if (state.verticalPianoRoll) {
        const pbw = VERTICAL_PLAYBACK_STRIP_WIDTH;
        pbCanvas.width = pbw * devicePixelRatio;
        pbCanvas.height = h * devicePixelRatio;
        pbCanvas.style.width = pbw + 'px';
        pbCanvas.style.height = h + 'px';
    } else {
        pbCanvas.width = w * devicePixelRatio;
        pbCanvas.height = PLAYBACK_HEADER_HEIGHT * devicePixelRatio;
        pbCanvas.style.width = w + 'px';
        pbCanvas.style.height = PLAYBACK_HEADER_HEIGHT + 'px';
    }
    pbCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    clampScrollToViewport();
    if (window.aeResize) window.aeResize();
}

/**
 * Vertical piano roll: pitch on X, time toward bottom; playhead is a horizontal line at the keyboard seam.
 */
function renderGridVertical() {
    const w = state.gridWidth;
    const h = state.gridHeight;
    const seamY = h - 1;
    const pan = state.verticalTimePanPx;
    const pb = state.playbackTick;
    const t = getTheme();

    gridCtx.clearRect(0, 0, w, h);

    const startCol = Math.max(0, Math.floor(state.scrollX / NOTE_HEIGHT));
    const endCol = Math.min(TOTAL_MIDI_NOTES, Math.ceil((state.scrollX + w) / NOTE_HEIGHT));
    for (let noteNum = startCol; noteNum < endCol; noteNum++) {
        const x = noteNum * NOTE_HEIGHT - state.scrollX;
        gridCtx.fillStyle = isBlackKey(noteNum) ? t.gridBgBlackKey : t.gridBgWhiteKey;
        gridCtx.fillRect(x, 0, NOTE_HEIGHT, h);
        drawKeyLockRowDim(gridCtx, x, 0, NOTE_HEIGHT, h, noteNum, t);
        gridCtx.strokeStyle = t.gridRowBorder;
        gridCtx.lineWidth = 0.5;
        gridCtx.beginPath();
        gridCtx.moveTo(x + NOTE_HEIGHT, 0);
        gridCtx.lineTo(x + NOTE_HEIGHT, h);
        gridCtx.stroke();
    }

    const visualTicks = state.snapGridPower < 0 ? Math.round(MIDI_TPQN / 4) : TICKS_PER_SNAP;
    const minTick = pb - (h + Math.abs(pan) + NOTE_HEIGHT) / SNAP_WIDTH;
    const maxTick = pb + (h + Math.abs(pan) + NOTE_HEIGHT) / SNAP_WIDTH;
    const startSnap = Math.floor(minTick / visualTicks);
    const endSnap = Math.ceil(maxTick / visualTicks);
    for (let s = startSnap; s <= endSnap; s++) {
        const tk = s * visualTicks;
        const y = seamY - (tk - pb) * SNAP_WIDTH + pan;
        if (y < -2 || y > h + 2) continue;
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
        gridCtx.moveTo(0, y);
        gridCtx.lineTo(w, y);
        gridCtx.stroke();
    }

    let overlayEvents = null;
    if (state.automationOverlay != null) {
        overlayEvents = new Array(16);
        for (let ch = 0; ch < 16; ch++) overlayEvents[ch] = [];
        if (state.automationOverlay === 'pitchBend') {
            for (const ev of state.pitchBends) {
                overlayEvents[ev.channel].push({ tick: ev.tick, value: ev.value / 16383 });
            }
        } else {
            const ccNum = state.automationOverlay;
            for (const ev of state.controllerChanges) {
                if (ev.controller === ccNum) {
                    overlayEvents[ev.channel].push({ tick: ev.tick, value: ev.value / 127 });
                }
            }
        }
        for (let ch = 0; ch < 16; ch++) {
            overlayEvents[ch].sort((a, b) => a.tick - b.tick);
        }
    }

    const NOTE_RADIUS = 3;
    const isVelocityEditing = state.interactionData && state.interactionData.velocityEditing;
    for (const n of state.notes) {
        if (typeof window.pulseProFoolsNoteIsKnocked === 'function' && window.pulseProFoolsNoteIsKnocked(n.id)) continue;
        const trk = state.tracks[n.track];
        if (trk && trk.hidden) continue;
        const xLeft = n.note * NOTE_HEIGHT - state.scrollX;
        const yBottom = seamY - (n.startTick - pb) * SNAP_WIDTH + pan;
        const yTop = seamY - (n.startTick + n.durationTicks - pb) * SNAP_WIDTH + pan;
        const nh = yBottom - yTop;
        const nw = NOTE_HEIGHT;
        const pbRollV = state.automationOverlay === 'pitchBend';
        if (xLeft + nw < 0 || xLeft > w || yBottom < 0 || yTop > h) continue;

        const selected = state.selectedNoteIds.has(n.id);
        const vel = n.velocity ?? 100;
        const velAlpha = 0.2 + 0.8 * (vel / 127);
        const baseAlpha = selected ? 1.0 : 0.8;
        const color = getTrackColor(n.track);
        const isMuted = trk && !isTrackAudible(n.track);
        const isLocked = trk && trk.locked;

        const r = Math.max(0, Math.min(NOTE_RADIUS, (nw - 2) / 2, (nh - 2) / 2));

        if (isMuted) {
            gridCtx.globalAlpha = baseAlpha * velAlpha * 0.6;
            gridCtx.strokeStyle = color;
            gridCtx.lineWidth = 1.5;
            gridCtx.beginPath();
            gridCtx.roundRect(xLeft + 1.5, yTop + 1.5, nw - 3, nh - 3, r);
            gridCtx.stroke();
        } else {
            gridCtx.fillStyle = color;
            gridCtx.globalAlpha = baseAlpha * velAlpha;
            gridCtx.beginPath();
            gridCtx.roundRect(xLeft + 1, yTop + 1, nw - 2, nh - 2, r);
            gridCtx.fill();
        }

        if (isLocked && !isMuted) {
            gridCtx.save();
            gridCtx.beginPath();
            gridCtx.roundRect(xLeft + 1, yTop + 1, nw - 2, nh - 2, r);
            gridCtx.clip();
            gridCtx.globalAlpha = 0.35;
            gridCtx.strokeStyle = t.gridBgWhiteKey;
            gridCtx.lineWidth = 1;
            const step = 5;
            for (let d = -nh; d < nw + nh; d += step) {
                gridCtx.beginPath();
                gridCtx.moveTo(xLeft + 1 + d, yTop + 1);
                gridCtx.lineTo(xLeft + 1 + d + nh, yTop + 1 + nh - 2);
                gridCtx.stroke();
            }
            gridCtx.restore();
        }

        if (overlayEvents && state.automationOverlay !== 'pitchBend') {
            const evts = overlayEvents[n.channel];
            const pad = 2;
            const innerLeft = xLeft + pad;
            const innerRight = xLeft + nw - pad;
            const innerTop = yTop + pad;
            const innerBot = yBottom - pad;
            const innerH = innerBot - innerTop;
            const innerW = innerRight - innerLeft;
            if (evts.length > 0 && innerW > 0 && innerH > 0) {
                const startTick = n.startTick;
                const endTick = n.startTick + n.durationTicks;
                let initVal = automationOverlayDefaultNorm(state.automationOverlay);
                let lo = 0, hi = evts.length - 1, lastBefore = -1;
                while (lo <= hi) {
                    const mid = (lo + hi) >> 1;
                    if (evts[mid].tick <= startTick) { lastBefore = mid; lo = mid + 1; }
                    else hi = mid - 1;
                }
                if (lastBefore >= 0) initVal = evts[lastBefore].value;

                const valToX = (v) => innerLeft + v * innerW;
                const tickToY = (tk) => innerBot - ((tk - startTick) / n.durationTicks) * innerH;
                const points = [{ x: valToX(initVal), y: tickToY(startTick) }];

                let idx = lastBefore >= 0 ? lastBefore + 1 : 0;
                while (idx < evts.length && evts[idx].tick <= startTick) idx++;

                let prevVal = initVal;
                while (idx < evts.length && evts[idx].tick < endTick) {
                    const ev = evts[idx];
                    const ey = tickToY(ev.tick);
                    points.push({ x: valToX(prevVal), y: ey });
                    points.push({ x: valToX(ev.value), y: ey });
                    prevVal = ev.value;
                    idx++;
                }
                points.push({ x: valToX(prevVal), y: tickToY(endTick) });

                gridCtx.save();
                gridCtx.beginPath();
                gridCtx.roundRect(xLeft + 1, yTop + 1, nw - 2, nh - 2, r);
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

        if (pbRollV) {
            drawPitchBendVerticalNoteRibbon(gridCtx, n, xLeft, yTop, yBottom, nw, nh);
            drawPitchBendVerticalHandles(gridCtx, n, xLeft, yTop, yBottom, nw, nh);
        }

        if (selected) {
            gridCtx.globalAlpha = 1.0;
            gridCtx.strokeStyle = t.noteSelectionStroke;
            gridCtx.lineWidth = 1.5;
            gridCtx.beginPath();
            gridCtx.roundRect(xLeft + 0.5, yTop + 0.5, nw - 1, nh - 1, r + 0.5);
            gridCtx.stroke();
        }
        if (isVelocityEditing) {
            gridCtx.globalAlpha = 1.0;
            gridCtx.fillStyle = t.velocityText;
            gridCtx.font = 'bold 9px monospace';
            gridCtx.textBaseline = 'middle';
            gridCtx.fillText(vel.toString(), xLeft + 3, yTop + nh / 2);
        }
        if (!overlayEvents && !isVelocityEditing && nh > 20 && nw >= 10) {
            gridCtx.globalAlpha = 0.85;
            gridCtx.fillStyle = currentTheme === 'dark' ? '#ffffff' : '#000000';
            gridCtx.font = `${Math.min(10, nw - 3)}px sans-serif`;
            gridCtx.textBaseline = 'middle';
            gridCtx.save();
            gridCtx.beginPath();
            gridCtx.roundRect(xLeft + 1, yTop + 1, nw - 2, nh - 2, r);
            gridCtx.clip();
            const noteIsDrum = trk && trk.channel === 9;
            gridCtx.fillText(displayMidiNoteName(n.note, noteIsDrum), xLeft + 3, yTop + nh / 2);
            gridCtx.restore();
        }
        gridCtx.globalAlpha = 1.0;
    }

    if (typeof window.pulseProDrawMidiRecordLiveNotes === 'function') {
        window.pulseProDrawMidiRecordLiveNotes(gridCtx, state.scrollX, state.scrollY, w, h, NOTE_RADIUS, NOTE_HEIGHT);
    }

    if (state.mode === 'selecting' && state.interactionData) {
        const d = state.interactionData;
        const minWx = Math.min(d.startX, d.currentX);
        const maxWx = Math.max(d.startX, d.currentX);
        const minWy = Math.min(d.startY, d.currentY);
        const maxWy = Math.max(d.startY, d.currentY);
        const t0 = minWx / SNAP_WIDTH;
        const t1 = maxWx / SNAP_WIDTH;
        const yTopV = seamY - (Math.max(t0, t1) - pb) * SNAP_WIDTH + pan;
        const yBotV = seamY - (Math.min(t0, t1) - pb) * SNAP_WIDTH + pan;
        const r0 = Math.floor(minWy / NOTE_HEIGHT);
        const r1 = Math.floor(maxWy / NOTE_HEIGHT);
        const noteHi = TOTAL_MIDI_NOTES - 1 - Math.min(r0, r1);
        const noteLo = TOTAL_MIDI_NOTES - 1 - Math.max(r0, r1);
        const rx = noteLo * NOTE_HEIGHT - state.scrollX;
        const rw = (noteHi - noteLo + 1) * NOTE_HEIGHT;
        const ry = yTopV;
        const rh = yBotV - yTopV;
        gridCtx.strokeStyle = t.selectionStroke;
        gridCtx.lineWidth = 1;
        gridCtx.setLineDash([4, 4]);
        gridCtx.strokeRect(rx, ry, rw, rh);
        gridCtx.setLineDash([]);
        gridCtx.fillStyle = t.selectionFill;
        gridCtx.fillRect(rx, ry, rw, rh);
    }

    if (state.conductorPlacementMode && state.conductorPlacementHoverTick != null) {
        const ty = seamY - (state.conductorPlacementHoverTick - pb) * SNAP_WIDTH + pan;
        if (ty >= -2 && ty <= h + 2) {
            gridCtx.strokeStyle = '#000000';
            gridCtx.lineWidth = 1.5;
            gridCtx.beginPath();
            gridCtx.moveTo(0, ty);
            gridCtx.lineTo(w, ty);
            gridCtx.stroke();
        }
    }

    if (typeof window.pulseProFoolsDrawParticles === 'function') {
        window.pulseProFoolsDrawParticles(gridCtx, state.scrollX, state.scrollY, w, h, NOTE_RADIUS);
    }

    const playY = seamY + pan;
    if (playY >= -1 && playY <= h + 1) {
        const py = Math.max(0, Math.min(h - 1, playY));
        gridCtx.strokeStyle = t.playbackLine;
        gridCtx.lineWidth = 2;
        gridCtx.beginPath();
        gridCtx.moveTo(0, py);
        gridCtx.lineTo(w, py);
        gridCtx.stroke();
    }
}

function renderGrid() {
    if (state.verticalPianoRoll) {
        renderGridVertical();
        return;
    }
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
        drawKeyLockRowDim(gridCtx, 0, y, w, NOTE_HEIGHT, noteNum, t);
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
        if (typeof window.pulseProFoolsNoteIsKnocked === 'function' && window.pulseProFoolsNoteIsKnocked(n.id)) continue;
        // Skip hidden tracks
        const trk = state.tracks[n.track];
        if (trk && trk.hidden) continue;
        const row = TOTAL_MIDI_NOTES - 1 - n.note;
        const nx = n.startTick * SNAP_WIDTH - sx;
        const pbRollH = state.automationOverlay === 'pitchBend';
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

        // Automation overlay line inside note (skip inner pitch polyline when overlay is pitch bend)
        if (overlayEvents && state.automationOverlay !== 'pitchBend') {
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

        if (pbRollH) {
            drawPitchBendHorizontalNoteRibbon(gridCtx, n, nx, nw, row, sy);
            drawPitchBendHorizontalHandles(gridCtx, n, nx, nw, row, sy);
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
            gridCtx.fillText(displayMidiNoteName(n.note, noteIsDrum), nx + 3, ny + NOTE_HEIGHT / 2);
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

    if (typeof window.pulseProFoolsDrawParticles === 'function') {
        window.pulseProFoolsDrawParticles(gridCtx, sx, sy, w, h, NOTE_RADIUS);
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

function renderKeyboardHorizontalStrip() {
    const w = state.gridWidth;
    const h = KEYBOARD_WIDTH;
    const th = getTheme();
    keyCtx.clearRect(0, 0, w, h);

    const playingKeys = new Map();
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

    const startCol = Math.max(0, Math.floor(state.scrollX / NOTE_HEIGHT));
    const endCol = Math.min(TOTAL_MIDI_NOTES, Math.ceil((state.scrollX + w) / NOTE_HEIGHT));
    for (let noteNum = startCol; noteNum < endCol; noteNum++) {
        const x = noteNum * NOTE_HEIGHT - state.scrollX;
        const black = isBlackKey(noteNum);
        const highlighted = state.highlightedKeys.has(noteNum) || state.midiInputHeldKeys.has(noteNum);
        const playingColor = playingKeys.get(noteNum);
        if (highlighted) {
            keyCtx.fillStyle = th.keyHighlight;
        } else if (playingColor) {
            keyCtx.fillStyle = playingColor;
        } else {
            keyCtx.fillStyle = black ? th.keyBlack : th.keyWhite;
        }
        keyCtx.fillRect(x, 0, NOTE_HEIGHT, h);
        drawKeyLockRowDim(keyCtx, x, 0, NOTE_HEIGHT, h, noteNum, th);
        keyCtx.strokeStyle = th.keyBorder;
        keyCtx.lineWidth = 0.5;
        keyCtx.strokeRect(x, 0, NOTE_HEIGHT, h);
        const isLit = highlighted || !!playingColor;
        keyCtx.fillStyle = isLit ? th.keyLabelHighlight : (black ? th.keyLabelBlack : th.keyLabelWhite);
        keyCtx.font = '9px monospace';
        keyCtx.textBaseline = 'middle';
        keyCtx.save();
        keyCtx.translate(x + NOTE_HEIGHT / 2, h / 2);
        keyCtx.rotate(-Math.PI / 2);
        const activeIsDrum = state.tracks[state.activeTrack] && state.tracks[state.activeTrack].channel === 9;
        keyCtx.fillText(displayMidiNoteName(noteNum, activeIsDrum), 0, 0);
        keyCtx.restore();
    }
}

function renderKeyboard() {
    if (state.verticalPianoRoll) {
        renderKeyboardHorizontalStrip();
        return;
    }
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
        const highlighted = state.highlightedKeys.has(noteNum) || state.midiInputHeldKeys.has(noteNum);
        const playingColor = playingKeys.get(noteNum);
        if (highlighted) {
            keyCtx.fillStyle = th.keyHighlight;
        } else if (playingColor) {
            keyCtx.fillStyle = playingColor;
        } else {
            keyCtx.fillStyle = black ? th.keyBlack : th.keyWhite;
        }
        keyCtx.fillRect(0, y, w, NOTE_HEIGHT);
        drawKeyLockRowDim(keyCtx, 0, y, w, NOTE_HEIGHT, noteNum, th);
        keyCtx.strokeStyle = th.keyBorder;
        keyCtx.lineWidth = 0.5;
        keyCtx.strokeRect(0, y, w, NOTE_HEIGHT);
        // Label
        const isLit = highlighted || !!playingColor;
        keyCtx.fillStyle = isLit ? th.keyLabelHighlight : (black ? th.keyLabelBlack : th.keyLabelWhite);
        keyCtx.font = '10px monospace';
        keyCtx.textBaseline = 'middle';
        const activeIsDrum = state.tracks[state.activeTrack] && state.tracks[state.activeTrack].channel === 9;
        keyCtx.fillText(displayMidiNoteName(noteNum, activeIsDrum), 4, y + NOTE_HEIGHT / 2);
    }
}

/**
 * Left-edge time ruler for vertical piano roll: same tick→Y mapping as the grid.
 */
function renderPlaybackHeaderVertical() {
    const w = VERTICAL_PLAYBACK_STRIP_WIDTH;
    const h = state.gridHeight;
    const seamY = h - 1;
    const pan = state.verticalTimePanPx;
    const pb = state.playbackTick;
    const th = getTheme();
    pbCtx.clearRect(0, 0, w, h);

    const visualTicks = state.snapGridPower < 0 ? Math.round(MIDI_TPQN / 4) : TICKS_PER_SNAP;
    const minTick = pb - (h + Math.abs(pan) + NOTE_HEIGHT) / SNAP_WIDTH;
    const maxTick = pb + (h + Math.abs(pan) + NOTE_HEIGHT) / SNAP_WIDTH;
    const startSnap = Math.floor(minTick / visualTicks);
    const endSnap = Math.ceil(maxTick / visualTicks);
    for (let s = startSnap; s <= endSnap; s++) {
        const tk = s * visualTicks;
        const y = seamY - (tk - pb) * SNAP_WIDTH + pan;
        if (y < -2 || y > h + 2) continue;
        const measureStart = measureStartTickContaining(tk);
        const isBar = tk === measureStart;
        if (isBar) {
            pbCtx.fillStyle = th.pbText;
            pbCtx.font = '10px monospace';
            pbCtx.textBaseline = 'middle';
            pbCtx.fillText(String(measureIndexAtTick(tk) + 1), 3, y);
            pbCtx.strokeStyle = th.pbBarLine;
            pbCtx.lineWidth = 2;
        } else if (tk % MIDI_TPQN === 0) {
            pbCtx.strokeStyle = th.pbBeatLine;
            pbCtx.lineWidth = 1;
        } else {
            pbCtx.strokeStyle = th.pbBeatLine;
            pbCtx.lineWidth = 0.5;
        }
        pbCtx.beginPath();
        pbCtx.moveTo(Math.floor(w * 0.35), y);
        pbCtx.lineTo(w, y);
        pbCtx.stroke();
    }

    const tickAtY0 = pb + (seamY + pan) / SNAP_WIDTH;
    const tickAtYh = pb + (seamY - h + pan) / SNAP_WIDTH;
    const visLo = Math.max(0, Math.min(tickAtY0, tickAtYh) - MIDI_TPQN);
    const visHi = Math.max(tickAtY0, tickAtYh) + MIDI_TPQN;
    if (conductorTrackVisible()) {
        const prev = state.conductorMarkerDragPreview;
        const half = w / 2;
        for (const e of state.tempoChanges) {
            let drawTick = e.tick;
            if (prev && prev.kind === 'bpm' && prev.origTick === e.tick) drawTick = prev.previewTick;
            if (drawTick < visLo || drawTick > visHi) continue;
            const my = seamY - (drawTick - pb) * SNAP_WIDTH + pan;
            if (my < -4 || my > h + 4) continue;
            pbCtx.strokeStyle = '#6c9eff';
            pbCtx.lineWidth = 2;
            pbCtx.beginPath();
            pbCtx.moveTo(half, my);
            pbCtx.lineTo(w, my);
            pbCtx.stroke();
            pbCtx.fillStyle = '#6c9eff';
            pbCtx.font = '9px monospace';
            pbCtx.textBaseline = 'middle';
            pbCtx.fillText(String(e.bpm), 2, my);
        }
        for (const e of state.timeSigChanges) {
            let drawTick = e.tick;
            if (prev && prev.kind === 'ts' && prev.origTick === e.tick) drawTick = prev.previewTick;
            if (drawTick < visLo || drawTick > visHi) continue;
            const my = seamY - (drawTick - pb) * SNAP_WIDTH + pan;
            if (my < -4 || my > h + 4) continue;
            pbCtx.strokeStyle = '#c9a227';
            pbCtx.lineWidth = 2;
            pbCtx.beginPath();
            pbCtx.moveTo(0, my);
            pbCtx.lineTo(half, my);
            pbCtx.stroke();
            pbCtx.fillStyle = '#c9a227';
            pbCtx.font = '9px monospace';
            pbCtx.textBaseline = 'middle';
            pbCtx.fillText(e.numerator + '/' + e.denominator, 2, my);
        }
    }

    if (state.conductorPlacementMode && state.conductorPlacementHoverTick != null) {
        const cy = seamY - (state.conductorPlacementHoverTick - pb) * SNAP_WIDTH + pan;
        if (cy >= -2 && cy <= h + 2) {
            pbCtx.strokeStyle = '#000000';
            pbCtx.lineWidth = 2;
            pbCtx.beginPath();
            pbCtx.moveTo(0, cy);
            pbCtx.lineTo(w, cy);
            pbCtx.stroke();
        }
    }

    const playY = seamY + pan;
    if (playY >= -10 && playY <= h + 10) {
        const py = Math.max(0, Math.min(h - 1, playY));
        pbCtx.fillStyle = th.pbHandle;
        pbCtx.beginPath();
        pbCtx.moveTo(0, py - 6);
        pbCtx.lineTo(0, py + 6);
        pbCtx.lineTo(16, py + 6);
        pbCtx.lineTo(w, py);
        pbCtx.lineTo(16, py - 6);
        pbCtx.closePath();
        pbCtx.fill();
    }
}

function renderPlaybackHeader() {
    if (state.verticalPianoRoll) {
        renderPlaybackHeaderVertical();
        return;
    }
    const w = state.gridWidth;
    const h = PLAYBACK_HEADER_HEIGHT;
    const sx = getPlaybackHeaderScrollPx();
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

/** Tick span used for horizontal scroll range (same basis as {@link getMaxScrollX}). */
function getTimelineSpanTicks() {
    const endTick = getEndTick();
    const tpmEnd = ticksPerMeasureAtTick(Math.max(0, endTick));
    const pad = tpmEnd * 4;
    return Math.max(pad, endTick + tpmEnd * 2);
}

window.getTimelineSpanTicks = getTimelineSpanTicks;

/** Max tick for vertical-roll playhead scrollbar (avoids div-by-zero). */
function getVerticalRollScrollbarPlayheadMaxTick() {
    return Math.max(1, typeof window.getPlaybackMaxTick === 'function' ? window.getPlaybackMaxTick() : getEndTick());
}

function verticalRollPlayheadThumbMetrics(trackH) {
    const maxT = getVerticalRollScrollbarPlayheadMaxTick();
    const vThumbH = Math.max(28, Math.floor(trackH * 0.12));
    const range = Math.max(0, trackH - vThumbH);
    return { maxT, vThumbH, range };
}

function clampScrollToViewport() {
    if (state.verticalPianoRoll) {
        const maxPX = getMaxPitchScrollPx();
        state.scrollX = Math.max(0, Math.min(maxPX, state.scrollX));
        state.verticalTimePanPx = 0;
        const maxHS = Math.max(0, getMaxScrollX());
        state.timelineHeaderScrollPx = Math.max(0, Math.min(maxHS, state.timelineHeaderScrollPx));
        return;
    }
    const maxSY = Math.max(0, TOTAL_HEIGHT - state.gridHeight);
    state.scrollY = Math.max(0, Math.min(maxSY, state.scrollY));
    const maxSX = Math.max(0, getMaxScrollX());
    state.scrollX = Math.max(0, Math.min(maxSX, state.scrollX));
}

function updateScrollbars() {
    const trackH = Math.max(1, getElementContentHeight(sbTrackV));
    const trackW = sbTrackH.clientWidth;

    if (state.verticalPianoRoll) {
        const { maxT, vThumbH, range } = verticalRollPlayheadThumbMetrics(trackH);
        const ratio = maxT > 0 ? state.playbackTick / maxT : 0;
        const vTop = range > 0 ? ratio * range : 0;
        sbThumbV.style.height = vThumbH + 'px';
        sbThumbV.style.top = Math.max(0, Math.min(trackH - vThumbH, vTop)) + 'px';

        const maxPX = Math.max(1, getMaxPitchScrollPx());
        const hThumbW = Math.max(20, trackW * (state.gridWidth / (maxPX + state.gridWidth)));
        const hLeft = (state.scrollX / maxPX) * (trackW - hThumbW);
        sbThumbH.style.width = hThumbW + 'px';
        sbThumbH.style.left = Math.max(0, Math.min(trackW - hThumbW, hLeft)) + 'px';
        return;
    }

    const maxSY = Math.max(1, TOTAL_HEIGHT - state.gridHeight);
    const maxSX = Math.max(1, getMaxScrollX());

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
            startScroll: axis === 'v'
                ? (state.verticalPianoRoll ? 0 : state.scrollY)
                : state.scrollX,
            startPlaybackTick: axis === 'v' && state.verticalPianoRoll ? state.playbackTick : undefined,
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    function onMouseMove(e) {
        if (!dragging) return;
        const { axis, startMouse, startScroll, startPlaybackTick } = dragging;
        const delta = (axis === 'v' ? e.clientY : e.clientX) - startMouse;
        if (axis === 'v') {
            const trackH = Math.max(1, getElementContentHeight(sbTrackV));
            if (state.verticalPianoRoll) {
                const { maxT, vThumbH, range } = verticalRollPlayheadThumbMetrics(trackH);
                const sp = startPlaybackTick !== undefined ? startPlaybackTick : state.playbackTick;
                const startTop = (sp / maxT) * range;
                const newTop = Math.max(0, Math.min(range, startTop + delta));
                const rawTick = range > 0 ? (newTop / range) * maxT : 0;
                let t = snapTickToGrid(Math.round(rawTick));
                t = Math.max(0, Math.min(maxT, t));
                state.playbackTick = t;
                state.playbackStartTick = t;
                state.lastMousePlaybackTick = t;
                state.verticalTimePanPx = 0;
                if (typeof window.pulseProSyncPlayheadPreviewNotes === 'function') {
                    window.pulseProSyncPlayheadPreviewNotes();
                }
            } else {
                const maxSY = Math.max(1, TOTAL_HEIGHT - state.gridHeight);
                const vRatio = state.gridHeight / TOTAL_HEIGHT;
                const thumbH = Math.max(20, trackH * vRatio);
                const scrollDelta = delta / (trackH - thumbH) * maxSY;
                state.scrollY = Math.max(0, Math.min(maxSY, startScroll + scrollDelta));
            }
        } else {
            const trackW = sbTrackH.clientWidth;
            if (state.verticalPianoRoll) {
                const maxPX = Math.max(1, getMaxPitchScrollPx());
                const thumbW = Math.max(20, trackW * (state.gridWidth / (maxPX + state.gridWidth)));
                const scrollDelta = delta / (trackW - thumbW) * maxPX;
                state.scrollX = Math.max(0, Math.min(maxPX, startScroll + scrollDelta));
            } else {
                const maxSX = Math.max(1, getMaxScrollX());
                const contentW = maxSX + state.gridWidth;
                const hRatio = state.gridWidth / contentW;
                const thumbW = Math.max(20, trackW * hRatio);
                const scrollDelta = delta / (trackW - thumbW) * maxSX;
                state.scrollX = Math.max(0, Math.min(maxSX, startScroll + scrollDelta));
            }
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
        if (state.verticalPianoRoll) {
            const { maxT, vThumbH, range } = verticalRollPlayheadThumbMetrics(trackH);
            let newTop = yInTrack - vThumbH / 2;
            newTop = Math.max(0, Math.min(range, newTop));
            const rawTick = range > 0 ? (newTop / range) * maxT : 0;
            let t = snapTickToGrid(Math.round(rawTick));
            t = Math.max(0, Math.min(maxT, t));
            state.playbackTick = t;
            state.playbackStartTick = t;
            state.lastMousePlaybackTick = t;
            state.verticalTimePanPx = 0;
            if (typeof window.pulseProSyncPlayheadPreviewNotes === 'function') {
                window.pulseProSyncPlayheadPreviewNotes();
            }
        } else {
            const maxSY = Math.max(1, TOTAL_HEIGHT - state.gridHeight);
            state.scrollY = Math.max(0, Math.min(maxSY, ratio * TOTAL_HEIGHT - state.gridHeight / 2));
        }
        renderAll();
    });
    sbTrackH.addEventListener('mousedown', function(e) {
        if (e.target === sbThumbH) return;
        const rect = sbTrackH.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        if (state.verticalPianoRoll) {
            const maxPX = Math.max(1, getMaxPitchScrollPx());
            state.scrollX = Math.max(0, Math.min(maxPX, ratio * maxPX));
        } else {
            const maxSX = Math.max(1, getMaxScrollX());
            const contentW = maxSX + state.gridWidth;
            state.scrollX = Math.max(0, ratio * contentW - state.gridWidth / 2);
        }
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

