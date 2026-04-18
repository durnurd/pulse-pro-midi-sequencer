// midi-record.js - Record MIDI note input onto the piano roll while editor playback is running (Web MIDI API).

let midiAccess = null;
/** @type {Set<string>} */
const attachedInputIds = new Set();
/** @type {Map<string, { startTick: number, velocity: number, trackIndex: number, channel: number, note: number }>} */
let pendingNoteOns = new Map();
let undoPushedThisPlay = false;

function midiRecordKey(midiChannel, note) {
    return midiChannel + '-' + note;
}

/**
 * Track used for recorded notes on a given MIDI channel.
 * Prefer the active track when its channel matches (tracks 17+ often share ch 1–16 with track 1–16).
 * Then the first non-hidden, non-locked track on that channel; finally any matching channel (legacy).
 */
function trackIndexForMidiChannel(midiCh) {
    const at = state.activeTrack;
    if (at >= 0 && at < state.tracks.length) {
        const t = state.tracks[at];
        if (t && t.channel === midiCh && !t.hidden && !t.locked) return at;
    }
    for (let i = 0; i < state.tracks.length; i++) {
        const t = state.tracks[i];
        if (t.channel === midiCh && !t.hidden && !t.locked) return i;
    }
    for (let i = 0; i < state.tracks.length; i++) {
        if (state.tracks[i].channel === midiCh) return i;
    }
    return state.activeTrack;
}

/**
 * Map device MIDI channel (0–15) to the project channel for recording: add the
 * selected track’s channel (state.activeChannel), wrapping 15→0 (MIDI 16→1).
 */
function remappedRecordChannel(deviceCh0) {
    return (deviceCh0 + state.activeChannel) % 16;
}

function ensureUndoForRecordSession() {
    if (!undoPushedThisPlay && state.midiRecordArmed) {
        pushUndoState('MIDI record');
        undoPushedThisPlay = true;
    }
}

function finishRecordedNote(midiCh, note, endTickRaw) {
    const k = midiRecordKey(midiCh, note);
    const pending = pendingNoteOns.get(k);
    if (!pending) return;
    pendingNoteOns.delete(k);
    const endT = Math.round(endTickRaw);
    // Duration from live playhead only; grid snap applies to piano-roll mouse edits, not MIDI input.
    const dur = Math.max(1, endT - pending.startTick);
    ensureUndoForRecordSession();
    addNote(pending.note, pending.channel, pending.startTick, dur, pending.velocity, pending.trackIndex);
    renderAll();
}

/**
 * Close any held notes at the given tick (pause/stop/disarm).
 * @param {number} endTickRaw
 */
function flushPendingRecordedNotes(endTickRaw) {
    if (pendingNoteOns.size === 0) return;
    const t = Math.round(endTickRaw);
    const entries = Array.from(pendingNoteOns.entries());
    pendingNoteOns.clear();
    let needRender = false;
    for (const [, pending] of entries) {
        const dur = Math.max(1, t - pending.startTick);
        ensureUndoForRecordSession();
        addNote(pending.note, pending.channel, pending.startTick, dur, pending.velocity, pending.trackIndex);
        needRender = true;
    }
    if (needRender) renderAll();
}

/** True if notes/CC can be written for this device MIDI channel (same routing as notes). */
function canRecordOnDeviceMidiChannel(midiCh) {
    const outCh = remappedRecordChannel(midiCh);
    const trk = trackIndexForMidiChannel(outCh);
    const trkInfo = state.tracks[trk];
    return !!(trkInfo && !trkInfo.locked && !trkInfo.hidden);
}

function sortControllerChangesRecorded() {
    if (typeof window.compareControllerChangesForPlayback === 'function') {
        state.controllerChanges.sort(window.compareControllerChangesForPlayback);
    } else {
        state.controllerChanges.sort((a, b) => a.tick - b.tick || a.channel - b.channel || a.controller - b.controller);
    }
    if (typeof window.bumpPitchBendControllerMutationForSensCache === 'function') {
        window.bumpPitchBendControllerMutationForSensCache();
    }
}

function sortPitchBendsRecorded() {
    state.pitchBends.sort((a, b) => a.tick - b.tick || a.channel - b.channel);
}

/**
 * Record a control change (e.g. sustain CC 64) onto the timeline and mirror to the synth.
 * @param {number} midiCh 0–15 device channel
 * @param {number} controller 0–127
 * @param {number} value 0–127
 */
function insertRecordedCc(midiCh, controller, value) {
    if (!canRecordOnDeviceMidiChannel(midiCh)) return;
    if (controller < 0 || controller > 127) return;
    const v = Math.max(0, Math.min(127, value | 0));
    const outCh = remappedRecordChannel(midiCh);
    const tick = Math.max(0, Math.round(state.playbackTick));
    const ccs = state.controllerChanges;
    for (let j = ccs.length - 1; j >= 0; j--) {
        const e = ccs[j];
        if (e.tick < tick) break;
        if (e.tick === tick && e.channel === outCh && e.controller === controller && e.value === v) return;
    }
    ensureUndoForRecordSession();
    ccs.push({ tick, channel: outCh, controller, value: v });
    sortControllerChangesRecorded();
    audioEngine.controllerChange(outCh, controller, v);
    if (typeof window.pulseProMidiOutControllerChange === 'function') {
        window.pulseProMidiOutControllerChange(outCh, controller, v);
    }
    if (typeof window.playbackResyncAutomationIndicesAfterRecord === 'function') {
        window.playbackResyncAutomationIndicesAfterRecord();
    }
    renderAll();
}

/**
 * Record 14-bit pitch bend (center 8192).
 * @param {number} midiCh 0–15 device channel
 * @param {number} value14 0–16383
 */
function insertRecordedPitchBend(midiCh, value14) {
    if (!canRecordOnDeviceMidiChannel(midiCh)) return;
    const outCh = remappedRecordChannel(midiCh);
    const val = Math.max(0, Math.min(16383, value14 | 0));
    const tick = Math.max(0, Math.round(state.playbackTick));
    const pbs = state.pitchBends;
    for (let j = pbs.length - 1; j >= 0; j--) {
        const e = pbs[j];
        if (e.tick < tick) break;
        if (e.tick === tick && e.channel === outCh && e.value === val) return;
    }
    ensureUndoForRecordSession();
    pbs.push({ tick, channel: outCh, value: val });
    sortPitchBendsRecorded();
    audioEngine.pitchWheel(outCh, val);
    if (typeof window.pulseProMidiOutPitchWheel === 'function') {
        window.pulseProMidiOutPitchWheel(outCh, val);
    }
    if (typeof window.playbackResyncAutomationIndicesAfterRecord === 'function') {
        window.playbackResyncAutomationIndicesAfterRecord();
    }
    renderAll();
}

/**
 * Update on-screen keyboard highlights from hardware note on/off (all channels).
 * @param {Uint8Array} data
 */
function applyMidiKeyboardMonitorFromMessage(data) {
    const status = data[0];
    const cmd = status & 0xf0;
    const a = data[1];
    const b = data.length > 2 ? data[2] : 0;
    if (cmd === 0x90) {
        const note = a;
        if (note < 0 || note > 127) return;
        if (b === 0) {
            state.midiInputHeldKeys.delete(note);
        } else {
            state.midiInputHeldKeys.add(note);
        }
        renderAll();
    } else if (cmd === 0x80) {
        const note = a;
        if (note < 0 || note > 127) return;
        state.midiInputHeldKeys.delete(note);
        renderAll();
    }
}

function startRecordedNote(midiCh, note, velocity) {
    if (typeof window.pulseProFoolsShouldBlockMiddleC === 'function' && window.pulseProFoolsShouldBlockMiddleC(note)) {
        if (typeof window.pulseProFoolsShowUpgradeDialog === 'function') {
            window.pulseProFoolsShowUpgradeDialog('middleC');
        }
        return;
    }
    if (typeof window.pulseProFoolsShouldBlockBlackKey === 'function' && window.pulseProFoolsShouldBlockBlackKey(note)) {
        if (typeof window.pulseProFoolsShowUpgradeDialog === 'function') {
            window.pulseProFoolsShowUpgradeDialog('blackKeys');
        }
        return;
    }
    if (isKeySignatureActive(state.keySignature) && !midiNoteInKeySignature(note, state.keySignature)) return;
    const outCh = remappedRecordChannel(midiCh);
    const trk = trackIndexForMidiChannel(outCh);
    const trkInfo = state.tracks[trk];
    if (!trkInfo || trkInfo.locked || trkInfo.hidden) return;
    const startTick = Math.max(0, Math.round(state.playbackTick));
    const k = midiRecordKey(midiCh, note);
    pendingNoteOns.set(k, {
        startTick,
        velocity: Math.max(1, Math.min(127, velocity)),
        trackIndex: trk,
        channel: outCh,
        note,
    });
    renderAll();
}

function handleMidiInputMessage(ev) {
    const data = ev.data;
    if (!data || data.length < 2) return;
    if (state.midiKeyboardMonitor) {
        applyMidiKeyboardMonitorFromMessage(data);
    }
    if (!state.isPlaying || !state.midiRecordArmed) return;

    const status = data[0];
    const cmd = status & 0xf0;
    const midiCh = status & 0x0f;
    const a = data[1];
    const b = data.length > 2 ? data[2] : 0;

    if (cmd === 0x90) {
        if (b === 0) {
            finishRecordedNote(midiCh, a, state.playbackTick);
        } else {
            startRecordedNote(midiCh, a, b);
        }
    } else if (cmd === 0x80) {
        finishRecordedNote(midiCh, a, state.playbackTick);
    } else if (cmd === 0xb0) {
        insertRecordedCc(midiCh, a, b);
    } else if (cmd === 0xe0) {
        const lsb = a;
        const msb = data.length > 2 ? b : 0;
        insertRecordedPitchBend(midiCh, (msb << 7) | lsb);
    }
}

function detachAllMidiInputs() {
    if (!midiAccess) {
        attachedInputIds.clear();
        return;
    }
    for (const id of attachedInputIds) {
        const port = midiAccess.inputs.get(id);
        if (port) port.onmidimessage = null;
    }
    attachedInputIds.clear();
}

function attachAllMidiInputs() {
    if (!midiAccess || (!state.midiRecordArmed && !state.midiKeyboardMonitor)) return;
    for (const input of midiAccess.inputs.values()) {
        if (attachedInputIds.has(input.id)) continue;
        input.onmidimessage = handleMidiInputMessage;
        attachedInputIds.add(input.id);
    }
}

function onMidiAccessStateChange() {
    if (state.midiRecordArmed || state.midiKeyboardMonitor) attachAllMidiInputs();
}

async function ensureMidiAccess() {
    if (midiAccess) return true;
    if (!navigator.requestMIDIAccess) return false;
    try {
        midiAccess = await navigator.requestMIDIAccess({ sysex: false });
        midiAccess.onstatechange = onMidiAccessStateChange;
        return true;
    } catch (_e) {
        return false;
    }
}

function pulseProMidiRecordOnPlaybackStart() {
    pendingNoteOns.clear();
    undoPushedThisPlay = false;
}

function pulseProMidiRecordFlushPending(endTickRaw) {
    flushPendingRecordedNotes(endTickRaw);
}

function pulseProUpdateMidiRecordButton() {
    const btn = document.getElementById('btn-midi-record');
    if (!btn) return;
    btn.classList.toggle('active', state.midiRecordArmed);
    btn.classList.toggle('recording', state.midiRecordArmed && state.isPlaying);
    btn.setAttribute('aria-pressed', state.midiRecordArmed ? 'true' : 'false');
    const btnPause = document.getElementById('btn-pause');
    if (btnPause) {
        const recBlock = state.midiRecordArmed && state.isPlaying;
        btnPause.disabled = recBlock;
        btnPause.title = recBlock
            ? 'Pause disabled while MIDI record is armed (use Stop or turn record off)'
            : 'Pause (Space)';
    }
}

/**
 * Add held MIDI notes to playback audio map (same as sequencer notes sounding).
 * @param {Map<string|number, {note:number, channel:number, velocity:number, track:number}>} newActive
 */
function pulseProMidiRecordMergePlaybackActive(newActive) {
    if (!state.isPlaying || !state.midiRecordArmed) return;
    for (const p of pendingNoteOns.values()) {
        if (!isTrackAudible(p.trackIndex)) continue;
        const trk = state.tracks[p.trackIndex];
        if (trk && trk.hidden) continue;
        const id = 'mr-' + p.channel + '-' + p.note;
        newActive.set(id, {
            note: p.note,
            channel: p.channel,
            velocity: p.velocity,
            track: p.trackIndex,
        });
    }
}

/**
 * Draw in-progress recorded notes (grow with playhead until key release).
 * @param {CanvasRenderingContext2D} gridCtx
 * @param {number} sx
 * @param {number} sy
 * @param {number} w
 * @param {number} h
 * @param {number} NOTE_RADIUS
 * @param {number} NOTE_HEIGHT
 */
function pulseProDrawMidiRecordLiveNotes(gridCtx, sx, sy, w, h, NOTE_RADIUS, NOTE_HEIGHT) {
    if (!state.isPlaying || !state.midiRecordArmed || pendingNoteOns.size === 0) return;
    const playbackTick = Math.round(state.playbackTick);
    for (const p of pendingNoteOns.values()) {
        const trk = state.tracks[p.trackIndex];
        if (trk && trk.hidden) continue;
        const endTick = Math.max(p.startTick + 1, playbackTick);
        const durationTicks = endTick - p.startTick;
        let nx, ny, nw, nh;
        if (state.verticalPianoRoll) {
            const seamY = h - 1;
            const pan = state.verticalTimePanPx;
            const pb = playbackTick;
            nx = p.note * NOTE_HEIGHT - state.scrollX;
            const yBottom = seamY - (p.startTick - pb) * SNAP_WIDTH + pan;
            const yTop = seamY - (p.startTick + durationTicks - pb) * SNAP_WIDTH + pan;
            nw = NOTE_HEIGHT;
            nh = yBottom - yTop;
            ny = yTop;
        } else {
            const row = TOTAL_MIDI_NOTES - 1 - p.note;
            nx = p.startTick * SNAP_WIDTH - sx;
            ny = row * NOTE_HEIGHT - sy;
            nw = durationTicks * SNAP_WIDTH;
            nh = NOTE_HEIGHT;
        }
        if (nx + nw < 0 || nx > w || ny + nh < 0 || ny > h) continue;

        const vel = p.velocity;
        const velAlpha = 0.2 + 0.8 * (vel / 127);
        const color = getTrackColor(p.trackIndex);
        const r = Math.max(0, Math.min(NOTE_RADIUS, (nw - 2) / 2, (nh - 2) / 2));

        gridCtx.save();
        gridCtx.fillStyle = color;
        gridCtx.globalAlpha = 0.45 * velAlpha;
        gridCtx.beginPath();
        gridCtx.roundRect(nx + 1, ny + 1, nw - 2, nh - 2, r);
        gridCtx.fill();
        gridCtx.globalAlpha = 0.95;
        gridCtx.strokeStyle = color;
        gridCtx.lineWidth = 1.5;
        gridCtx.setLineDash([4, 3]);
        gridCtx.stroke();
        gridCtx.setLineDash([]);
        if (nw > 20 && nh >= 10) {
            gridCtx.globalAlpha = 0.9;
            gridCtx.fillStyle = currentTheme === 'dark' ? '#ffffff' : '#000000';
            gridCtx.font = `${Math.min(10, Math.min(nw, nh) - 3)}px sans-serif`;
            gridCtx.textBaseline = 'middle';
            gridCtx.save();
            gridCtx.beginPath();
            gridCtx.roundRect(nx + 1, ny + 1, nw - 2, nh - 2, r);
            gridCtx.clip();
            const noteIsDrum = trk && trk.channel === 9;
            gridCtx.fillText(displayMidiNoteName(p.note, noteIsDrum), nx + 3, ny + nh / 2);
            gridCtx.restore();
        }
        gridCtx.restore();
    }
}

/**
 * @param {Map<number, string>} playingKeys note number → CSS color
 */
function pulseProMidiRecordMergePlayingKeys(playingKeys) {
    if (!state.isPlaying || !state.midiRecordArmed) return;
    for (const p of pendingNoteOns.values()) {
        const trk = state.tracks[p.trackIndex];
        if (trk && trk.hidden) continue;
        if (!isTrackAudible(p.trackIndex)) continue;
        playingKeys.set(p.note, getTrackColor(p.trackIndex));
    }
}

/**
 * Enable or disable live MIDI input highlights on the keyboard; requests Web MIDI when enabling.
 * @param {boolean} on
 * @returns {Promise<void>}
 */
async function pulseProSetMidiKeyboardMonitor(on) {
    const next = !!on;
    if (!next) {
        state.midiKeyboardMonitor = false;
        state.midiInputHeldKeys.clear();
        detachAllMidiInputs();
        if (state.midiRecordArmed && midiAccess) attachAllMidiInputs();
        renderAll();
        return;
    }
    const ok = await ensureMidiAccess();
    if (!ok) {
        alert('Web MIDI is not available in this browser or access was denied. Use http://localhost or HTTPS.');
        state.midiKeyboardMonitor = false;
        return;
    }
    state.midiKeyboardMonitor = true;
    attachAllMidiInputs();
    renderAll();
}

/**
 * Arm or disarm MIDI recording; requests Web MIDI when arming.
 * @param {boolean} on
 * @returns {Promise<void>}
 */
async function pulseProApplyMidiRecordArmed(on) {
    if (!on) {
        detachAllMidiInputs();
        state.midiRecordArmed = false;
        if (state.isPlaying) {
            stopPlayback();
        } else {
            pendingNoteOns.clear();
        }
        pulseProUpdateMidiRecordButton();
        if (state.midiKeyboardMonitor && midiAccess) attachAllMidiInputs();
        return;
    }
    const ok = await ensureMidiAccess();
    if (!ok) {
        alert('Web MIDI is not available in this browser or access was denied. Use http://localhost or HTTPS.');
        state.midiRecordArmed = false;
        pulseProUpdateMidiRecordButton();
        return;
    }
    state.midiRecordArmed = true;
    attachAllMidiInputs();
    pulseProUpdateMidiRecordButton();
}

window.pulseProMidiRecordOnPlaybackStart = pulseProMidiRecordOnPlaybackStart;
window.pulseProMidiRecordFlushPending = pulseProMidiRecordFlushPending;
window.pulseProUpdateMidiRecordButton = pulseProUpdateMidiRecordButton;
window.pulseProApplyMidiRecordArmed = pulseProApplyMidiRecordArmed;
window.pulseProSetMidiKeyboardMonitor = pulseProSetMidiKeyboardMonitor;
window.pulseProMidiRecordMergePlaybackActive = pulseProMidiRecordMergePlaybackActive;
window.pulseProDrawMidiRecordLiveNotes = pulseProDrawMidiRecordLiveNotes;
window.pulseProMidiRecordMergePlayingKeys = pulseProMidiRecordMergePlayingKeys;

