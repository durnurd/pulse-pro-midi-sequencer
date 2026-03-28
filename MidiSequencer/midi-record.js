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

/** First track whose MIDI channel matches; otherwise active track. */
function trackIndexForMidiChannel(midiCh) {
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
    const dur = Math.max(TICKS_PER_SNAP, endT - pending.startTick);
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
        const dur = Math.max(TICKS_PER_SNAP, t - pending.startTick);
        ensureUndoForRecordSession();
        addNote(pending.note, pending.channel, pending.startTick, dur, pending.velocity, pending.trackIndex);
        needRender = true;
    }
    if (needRender) renderAll();
}

function startRecordedNote(midiCh, note, velocity) {
    const outCh = remappedRecordChannel(midiCh);
    const trk = trackIndexForMidiChannel(outCh);
    const trkInfo = state.tracks[trk];
    if (!trkInfo || trkInfo.locked || trkInfo.hidden) return;
    const startTick = Math.max(0, snapTickToGrid(Math.round(state.playbackTick)));
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
    if (!midiAccess || !state.midiRecordArmed) return;
    for (const input of midiAccess.inputs.values()) {
        if (attachedInputIds.has(input.id)) continue;
        input.onmidimessage = handleMidiInputMessage;
        attachedInputIds.add(input.id);
    }
}

function onMidiAccessStateChange() {
    if (state.midiRecordArmed) attachAllMidiInputs();
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
        const row = TOTAL_MIDI_NOTES - 1 - p.note;
        const endTick = Math.max(p.startTick + TICKS_PER_SNAP, playbackTick);
        const durationTicks = endTick - p.startTick;
        const nx = p.startTick * SNAP_WIDTH - sx;
        const ny = row * NOTE_HEIGHT - sy;
        const nw = durationTicks * SNAP_WIDTH;
        if (nx + nw < 0 || nx > w || ny + NOTE_HEIGHT < 0 || ny > h) continue;

        const vel = p.velocity;
        const velAlpha = 0.2 + 0.8 * (vel / 127);
        const color = getTrackColor(p.trackIndex);
        const r = Math.max(0, Math.min(NOTE_RADIUS, (nw - 2) / 2, (NOTE_HEIGHT - 2) / 2));

        gridCtx.save();
        gridCtx.fillStyle = color;
        gridCtx.globalAlpha = 0.45 * velAlpha;
        gridCtx.beginPath();
        gridCtx.roundRect(nx + 1, ny + 1, nw - 2, NOTE_HEIGHT - 2, r);
        gridCtx.fill();
        gridCtx.globalAlpha = 0.95;
        gridCtx.strokeStyle = color;
        gridCtx.lineWidth = 1.5;
        gridCtx.setLineDash([4, 3]);
        gridCtx.stroke();
        gridCtx.setLineDash([]);
        if (nw > 20 && NOTE_HEIGHT >= 10) {
            gridCtx.globalAlpha = 0.9;
            gridCtx.fillStyle = currentTheme === 'dark' ? '#ffffff' : '#000000';
            gridCtx.font = `${Math.min(10, NOTE_HEIGHT - 3)}px sans-serif`;
            gridCtx.textBaseline = 'middle';
            gridCtx.save();
            gridCtx.beginPath();
            gridCtx.roundRect(nx + 1, ny + 1, nw - 2, NOTE_HEIGHT - 2, r);
            gridCtx.clip();
            const noteIsDrum = trk && trk.channel === 9;
            gridCtx.fillText(midiNoteName(p.note, noteIsDrum), nx + 3, ny + NOTE_HEIGHT / 2);
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
window.pulseProMidiRecordMergePlaybackActive = pulseProMidiRecordMergePlaybackActive;
window.pulseProDrawMidiRecordLiveNotes = pulseProDrawMidiRecordLiveNotes;
window.pulseProMidiRecordMergePlayingKeys = pulseProMidiRecordMergePlayingKeys;

