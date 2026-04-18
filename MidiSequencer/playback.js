// playback.js - Playback engine
let playbackAnimFrame = null;
/** When the tab is in the background, requestAnimationFrame is heavily throttled; drive playback with this interval instead. */
const PLAYBACK_BACKGROUND_INTERVAL_MS = 20;
let playbackLoopTimer = null;
let playbackActiveNotes = new Map(); // id -> {note, channel, velocity, track} for currently sounding notes
let playbackPBIndex = 0;   // next pitch bend event index to process
let playbackCCIndex = 0;   // next controller change event index to process

function ticksPerSecond() {
    // BPM = quarter notes per minute. Each quarter note = MIDI_TPQN ticks.
    return (state.bpm / 60) * MIDI_TPQN;
}

/** After a tempo change during playback, keep the playhead tick stable (wall clock uses the new rate from “now”). */
function reanchorPlaybackClockIfPlaying() {
    if (!state.isPlaying) return;
    state.playbackStartTick = state.playbackTick;
    state.playbackStartTime = performance.now();
}

window.reanchorPlaybackClockIfPlaying = reanchorPlaybackClockIfPlaying;

function clearPlaybackLoopDriver() {
    if (playbackAnimFrame != null) {
        cancelAnimationFrame(playbackAnimFrame);
        playbackAnimFrame = null;
    }
    if (playbackLoopTimer != null) {
        clearTimeout(playbackLoopTimer);
        playbackLoopTimer = null;
    }
}

/** Schedule the next editor playback tick using rAF (foreground) or a timer (background tab / minimized window). */
function scheduleNextPlaybackLoop() {
    if (!state.isPlaying) return;
    clearPlaybackLoopDriver();
    if (document.hidden) {
        playbackLoopTimer = setTimeout(function playbackBackgroundTick() {
            playbackLoopTimer = null;
            playbackLoop();
        }, PLAYBACK_BACKGROUND_INTERVAL_MS);
    } else {
        playbackAnimFrame = requestAnimationFrame(playbackLoop);
    }
}

function syncPlaybackSoundingTracksFromMap(activeMap) {
    state.playbackSoundingTracks.clear();
    for (const info of activeMap.values()) {
        state.playbackSoundingTracks.add(info.track);
    }
}

function startPlayback() {
    stopLibraryPreview();
    if (typeof window.pulseProMidiRecordOnPlaybackStart === 'function') {
        window.pulseProMidiRecordOnPlaybackStart();
    }
    audioEngine.init();
    state.isPlaying = true;
    state.isPaused = false;
    state.playbackStartTime = performance.now();
    state.playbackStartTick = state.playbackTick;
    playbackActiveNotes.clear();
    state.playbackSoundingTracks.clear();
    // Seek automation indices to current playback position and apply last-known values
    seekAutomationTo(state.playbackTick);
    if (typeof window.pulseProMidiOutSendProgramsFromAudioEngine === 'function') {
        window.pulseProMidiOutSendProgramsFromAudioEngine();
    }
    updatePlaybackButtons();
    playbackLoop();
}

/** Apply editor pitch-bend range (RPN 0,0) on the built-in synth for all channels at timeline tick. */
function applySynthEditorPitchBendSensitivityAtTick(tick) {
    const t = tick | 0;
    for (let ch = 0; ch < 16; ch++) {
        const semi = typeof window.getPitchBendSensitivitySemitones === 'function'
            ? window.getPitchBendSensitivitySemitones(ch, t)
            : 2;
        audioEngine.setPitchBendSensitivitySemitones(ch, semi);
    }
}

// Find the correct automation index for a given tick and apply the most recent
// pitch bend / CC values so playback starts with the right sound state.
function seekAutomationTo(tick) {
    const pbs = state.pitchBends;
    const ccs = state.controllerChanges;
    // Reset controllers to defaults first
    audioEngine.resetAllControllers();
    // Find first event at or after tick for the index pointers
    playbackPBIndex = 0;
    while (playbackPBIndex < pbs.length && pbs[playbackPBIndex].tick <= tick) playbackPBIndex++;
    playbackCCIndex = 0;
    while (playbackCCIndex < ccs.length && ccs[playbackCCIndex].tick <= tick) playbackCCIndex++;
    const lastCC = new Map();
    for (let i = 0; i < playbackCCIndex; i++) {
        const e = ccs[i];
        lastCC.set(`${e.channel}-${e.controller}`, { channel: e.channel, controller: e.controller, value: e.value });
    }
    for (const info of lastCC.values()) {
        audioEngine.controllerChange(info.channel, info.controller, info.value);
    }
    applySynthEditorPitchBendSensitivityAtTick(tick);
    const lastPB = new Map();
    for (let i = 0; i < playbackPBIndex; i++) {
        lastPB.set(pbs[i].channel, pbs[i].value);
    }
    for (const [ch, val] of lastPB) {
        audioEngine.pitchWheel(ch, val);
    }
    if (typeof window.pulseProMidiOutAfterAutomationSeek === 'function') {
        window.pulseProMidiOutAfterAutomationSeek(lastPB, lastCC, tick);
    }
}

/** Re-apply built-in synth + MIDI out automation from the timeline at the current playhead (e.g. after editing pitch range). */
function pulseProSeekAutomationToPlayhead() {
    if (typeof audioEngine !== 'undefined' && audioEngine && typeof audioEngine.init === 'function') {
        void audioEngine.init();
    }
    seekAutomationTo(state.playbackTick | 0);
}
window.pulseProSeekAutomationToPlayhead = pulseProSeekAutomationToPlayhead;

/**
 * After appending pitch-bend or CC events during live MIDI record, advance scan indices so the
 * next playbackLoop frame does not re-send automation already applied in the record handler.
 */
function playbackResyncAutomationIndicesAfterRecord() {
    if (!state.isPlaying) return;
    const t = state.playbackTick;
    let i = 0;
    while (i < state.pitchBends.length && state.pitchBends[i].tick <= t) i++;
    playbackPBIndex = i;
    i = 0;
    while (i < state.controllerChanges.length && state.controllerChanges[i].tick <= t) i++;
    playbackCCIndex = i;
}

window.playbackResyncAutomationIndicesAfterRecord = playbackResyncAutomationIndicesAfterRecord;

function pausePlayback() {
    if (state.audioExportInProgress) return;
    if (state.midiRecordArmed && state.isPlaying) return;
    if (typeof window.pulseProMidiRecordFlushPending === 'function') {
        window.pulseProMidiRecordFlushPending(Math.round(state.playbackTick));
    }
    stopLibraryPreview();
    state.isPlaying = false;
    state.isPaused = true;
    clearPlaybackLoopDriver();
    audioEngine.allNotesOff();
    if (typeof window.pulseProMidiOutAllNotesOff === 'function') {
        window.pulseProMidiOutAllNotesOff();
    }
    playbackActiveNotes.clear();
    state.playbackSoundingTracks.clear();
    if (typeof window.pulseProFoolsReset === 'function') window.pulseProFoolsReset();
    updatePlaybackButtons();
}

/**
 * Stop editor playback: silence output and cancel the animation frame.
 * @param {{ naturalEnd?: boolean }} [options] If naturalEnd, move the playhead to {@link state.lastMousePlaybackTick}
 *   (clamped to song end) instead of rewinding to tick 0; otherwise rewind and clear lastMousePlaybackTick.
 */
function stopPlayback(options) {
    const naturalEnd = options && options.naturalEnd;
    if (typeof window.pulseProMidiRecordFlushPending === 'function') {
        window.pulseProMidiRecordFlushPending(Math.round(state.playbackTick));
    }
    stopLibraryPreview();
    state.isPlaying = false;
    state.isPaused = false;
    clearPlaybackLoopDriver();
    audioEngine.allNotesOff();
    audioEngine.resetAllControllers();
    playbackActiveNotes.clear();
    state.playbackSoundingTracks.clear();
    if (naturalEnd) {
        const maxT = getEndTick();
        let t = Math.max(0, state.lastMousePlaybackTick);
        if (maxT > 0) t = Math.min(t, maxT);
        state.playbackTick = t;
        state.playbackStartTick = t;
        seekAutomationTo(t);
    } else {
        if (typeof window.pulseProMidiOutFullSilence === 'function') {
            window.pulseProMidiOutFullSilence();
        }
        state.playbackTick = 0;
        state.playbackStartTick = 0;
        state.lastMousePlaybackTick = 0;
        playbackPBIndex = 0;
        playbackCCIndex = 0;
    }
    if (typeof window.pulseProFoolsReset === 'function') window.pulseProFoolsReset();
    updatePlaybackButtons();
    renderAll();
}

function togglePlayPause() {
    if (state.audioExportInProgress) return;
    if (state.isPlaying) {
        if (state.midiRecordArmed) return;
        pausePlayback();
    } else {
        startPlayback();
    }
}

function playbackLoop() {
    if (!state.isPlaying) return;
    const tickAtFrameStart = state.playbackTick;
    const elapsed = (performance.now() - state.playbackStartTime) / 1000;
    const wallAtStart = wallSecondsFromTick(state.playbackStartTick);
    const currentTick = tickFromWallSeconds(wallAtStart + elapsed);
    // Use measure-aligned end tick for looping, raw end tick for non-loop stop
    const endMeasureTick = getEndMeasureTick();
    let endTick = state.isRepeat ? endMeasureTick : getEndTick();
    if (state.midiRecordArmed && !state.isRepeat) {
        endTick = 0;
    }

    // Check if we've reached the end
    if (currentTick >= endTick && endTick > 0) {
        if (state.isRepeat) {
            if (typeof window.pulseProFoolsOnRepeatRewind === 'function') window.pulseProFoolsOnRepeatRewind();
            state.playbackStartTime = performance.now();
            state.playbackStartTick = 0;
            state.playbackTick = 0;
            audioEngine.allNotesOff();
            audioEngine.resetAllControllers();
            if (typeof window.pulseProMidiOutFullSilence === 'function') {
                window.pulseProMidiOutFullSilence();
            }
            if (typeof window.pulseProMidiOutSendProgramsFromAudioEngine === 'function') {
                window.pulseProMidiOutSendProgramsFromAudioEngine();
            }
            playbackActiveNotes.clear();
            state.playbackSoundingTracks.clear();
            playbackPBIndex = 0;
            playbackCCIndex = 0;
        } else {
            stopPlayback({ naturalEnd: true });
            return;
        }
    } else {
        state.playbackTick = currentTick;
    }

    if (typeof window.pulseProFoolsOnPlaybackFrame === 'function') {
        window.pulseProFoolsOnPlaybackFrame(tickAtFrameStart, state.playbackTick);
    }

    // Note on/off logic — track by note instance ID so back-to-back
    // same-pitch notes retrigger properly.
    // Shave a small amount off the end of each note so that consecutive
    // same-pitch notes always have a gap, ensuring an audible re-attack.
    const NOTE_END_TRIM = 6; // ticks (small fraction of a 16th note at 480 TPQN)
    const newActive = new Map(); // id -> {note, channel, velocity, track}
    for (const n of state.notes) {
        // Skip muted / non-solo tracks
        if (!isTrackAudible(n.track)) continue;
        const endTick = n.startTick + n.durationTicks - NOTE_END_TRIM;
        if (n.startTick <= state.playbackTick && endTick > state.playbackTick) {
            newActive.set(n.id, {
                note: n.note,
                channel: n.channel,
                velocity: n.velocity ?? 100,
                track: n.track,
            });
        }
    }
    // Turn off notes that are no longer active BEFORE starting new ones,
    // so a noteOff doesn't kill a just-started voice on the same pitch
    for (const [id, info] of playbackActiveNotes) {
        if (!newActive.has(id)) {
            audioEngine.noteOff(info.note, info.channel);
            if (typeof window.pulseProMidiOutNoteOff === 'function') {
                window.pulseProMidiOutNoteOff(info.note, info.channel);
            }
        }
    }
    // Now start newly active notes
    for (const [id, info] of newActive) {
        if (!playbackActiveNotes.has(id)) {
            audioEngine.noteOn(info.note, info.channel, info.velocity);
            if (typeof window.pulseProMidiOutNoteOn === 'function') {
                window.pulseProMidiOutNoteOn(info.note, info.channel, info.velocity);
            }
        }
    }
    if (typeof window.pulseProMidiRecordMergePlaybackActive === 'function') {
        window.pulseProMidiRecordMergePlaybackActive(newActive);
    }
    playbackActiveNotes = newActive;
    syncPlaybackSoundingTracksFromMap(newActive);

    const pbs = state.pitchBends;
    const ccs = state.controllerChanges;
    const playT = state.playbackTick;
    const PRI_P = 1;
    const PRI_C = 2;
    while (true) {
        const candidates = [];
        if (playbackPBIndex < pbs.length && pbs[playbackPBIndex].tick <= playT) {
            candidates.push({ kind: 'p', tick: pbs[playbackPBIndex].tick, pri: PRI_P });
        }
        if (playbackCCIndex < ccs.length && ccs[playbackCCIndex].tick <= playT) {
            candidates.push({ kind: 'c', tick: ccs[playbackCCIndex].tick, pri: PRI_C });
        }
        if (candidates.length === 0) break;
        candidates.sort(function(a, b) {
            if (a.tick !== b.tick) return a.tick - b.tick;
            return a.pri - b.pri;
        });
        const first = candidates[0].kind;
        if (first === 'p') {
            const e = pbs[playbackPBIndex];
            audioEngine.pitchWheel(e.channel, e.value);
            if (typeof window.pulseProMidiOutPitchWheel === 'function') {
                window.pulseProMidiOutPitchWheel(e.channel, e.value);
            }
            playbackPBIndex++;
        } else {
            const e = ccs[playbackCCIndex];
            audioEngine.controllerChange(e.channel, e.controller, e.value);
            if (typeof window.pulseProMidiOutControllerChange === 'function') {
                window.pulseProMidiOutControllerChange(e.channel, e.controller, e.value);
            }
            playbackCCIndex++;
        }
    }

    if (state.verticalPianoRoll) {
        state.verticalTimePanPx = 0;
    } else {
        const pbScreenX = state.playbackTick * SNAP_WIDTH - state.scrollX;
        const margin = state.gridWidth * 0.15;
        if (pbScreenX > state.gridWidth - margin) {
            state.scrollX = state.playbackTick * SNAP_WIDTH - state.gridWidth + margin;
        } else if (pbScreenX < margin) {
            state.scrollX = Math.max(0, state.playbackTick * SNAP_WIDTH - margin);
        }
    }

    if (!document.hidden) {
        renderAll();
    }
    scheduleNextPlaybackLoop();
}

function updatePlaybackButtons() {
    const btnPlay = document.getElementById('btn-play');
    const btnPause = document.getElementById('btn-pause');
    btnPlay.style.display = state.isPlaying ? 'none' : 'inline-block';
    btnPause.style.display = state.isPlaying ? 'inline-block' : 'none';
    if (typeof window.pulseProUpdateMidiRecordButton === 'function') {
        window.pulseProUpdateMidiRecordButton();
    }
}

/** End tick used for playback boundary (matches playbackLoop). */
function getPlaybackMaxTick() {
    const raw = getEndTick();
    let maxT;
    if (raw <= 0) {
        maxT = 0;
    } else {
        maxT = state.isRepeat ? getEndMeasureTick() : raw;
    }
    if (state.midiRecordArmed) {
        maxT = Math.max(maxT, Math.ceil(state.playbackTick));
    }
    return maxT;
}

/**
 * Move the playback head to tick (clamped). If playing, continues from the new position with automation aligned.
 */
function seekPlaybackToTick(tick) {
    const maxT = getPlaybackMaxTick();
    let t = Math.max(0, tick);
    if (maxT > 0) t = Math.min(t, maxT);
    state.playbackTick = t;
    if (state.verticalPianoRoll) {
        state.verticalTimePanPx = 0;
    }
    if (state.isPlaying) {
        state.playbackStartTick = t;
        state.playbackStartTime = performance.now();
        seekAutomationTo(t);
        audioEngine.allNotesOff();
        if (typeof window.pulseProMidiOutAllNotesOff === 'function') {
            window.pulseProMidiOutAllNotesOff();
        }
        playbackActiveNotes.clear();
        state.playbackSoundingTracks.clear();
    } else {
        state.playbackStartTick = t;
        if (typeof window.pulseProSyncPlayheadPreviewNotes === 'function') {
            window.pulseProSyncPlayheadPreviewNotes();
        }
    }
    renderAll();
}

window.getPlaybackMaxTick = getPlaybackMaxTick;
window.seekPlaybackToTick = seekPlaybackToTick;

/**
 * While paused, match built-in synth + MIDI out to notes under the playhead (playhead scrub / vertical seek).
 * Skips when playing — the playback loop owns note output.
 */
function pulseProSyncPlayheadPreviewNotes() {
    if (state.isPlaying) return;
    for (const [k] of [...audioEngine.activeNotes]) {
        const p = k.split('-');
        const ch = +p[0];
        const nt = +p[1];
        let shouldSound = false;
        for (const n of state.notes) {
            if (!isTrackAudible(n.track)) continue;
            if (n.channel === ch && n.note === nt && n.startTick <= state.playbackTick
                && n.startTick + n.durationTicks > state.playbackTick) {
                shouldSound = true;
                break;
            }
        }
        if (!shouldSound) {
            audioEngine.noteOff(nt, ch);
            if (typeof window.pulseProMidiOutNoteOff === 'function') {
                window.pulseProMidiOutNoteOff(nt, ch);
            }
        }
    }
    for (const n of state.notes) {
        if (!isTrackAudible(n.track)) continue;
        if (n.startTick <= state.playbackTick && n.startTick + n.durationTicks > state.playbackTick
            && !audioEngine.activeNotes.has(`${n.channel}-${n.note}`)) {
            const vel = n.velocity ?? 100;
            audioEngine.noteOn(n.note, n.channel, vel);
            if (typeof window.pulseProMidiOutNoteOn === 'function') {
                window.pulseProMidiOutNoteOn(n.note, n.channel, vel);
            }
        }
    }
}

window.pulseProSyncPlayheadPreviewNotes = pulseProSyncPlayheadPreviewNotes;

/**
 * Vertical piano roll: wheel moves the playhead (not while playing). Shift+wheel is reserved for pitch scroll.
 * @param {number} deltaY
 * @param {boolean} shiftKey
 */
function applyVerticalRollWheelToPlayhead(deltaY, shiftKey) {
    if (state.isPlaying || shiftKey || deltaY === 0) return;
    const lineTicks = TICKS_PER_SNAP;
    const steps = Math.max(-120, Math.min(120, Math.round(-deltaY / 40)));
    if (steps === 0) return;
    let t = snapTickToGrid(state.playbackTick + steps * lineTicks);
    const maxT = getPlaybackMaxTick();
    t = Math.max(0, maxT > 0 ? Math.min(t, maxT) : t);
    state.playbackTick = t;
    state.playbackStartTick = t;
    state.lastMousePlaybackTick = t;
    if (state.verticalPianoRoll) {
        state.verticalTimePanPx = 0;
    }
    if (typeof window.pulseProSyncPlayheadPreviewNotes === 'function') {
        window.pulseProSyncPlayheadPreviewNotes();
    }
    renderAll();
}
window.applyVerticalRollWheelToPlayhead = applyVerticalRollWheelToPlayhead;

// --- Library preview (hear saved MIDI without loading into the editor) ---
const NOTE_END_TRIM_LIBRARY = 6;

let libraryPreviewCtx = null;

function previewNotesEndTick(notes) {
    let maxTick = 0;
    for (const n of notes) {
        const end = n.startTick + n.durationTicks;
        if (end > maxTick) maxTick = end;
    }
    return maxTick;
}

function previewAutomationEndTick(r) {
    let m = 0;
    const pbs = r.pitchBends || [];
    const ccs = r.controllerChanges || [];
    for (let i = 0; i < pbs.length; i++) {
        if (pbs[i].tick > m) m = pbs[i].tick;
    }
    for (let i = 0; i < ccs.length; i++) {
        if (ccs[i].tick > m) m = ccs[i].tick;
    }
    return m;
}

function seekLibraryPreviewAutomation(tick, pbs, ccs, st) {
    audioEngine.resetAllControllers();
    st.pbIndex = 0;
    while (st.pbIndex < pbs.length && pbs[st.pbIndex].tick <= tick) st.pbIndex++;
    st.ccIndex = 0;
    while (st.ccIndex < ccs.length && ccs[st.ccIndex].tick <= tick) st.ccIndex++;
    const lastCC = new Map();
    for (let i = 0; i < st.ccIndex; i++) {
        const e = ccs[i];
        lastCC.set(`${e.channel}-${e.controller}`, { channel: e.channel, controller: e.controller, value: e.value });
    }
    for (const info of lastCC.values()) {
        audioEngine.controllerChange(info.channel, info.controller, info.value);
    }
    for (let ch = 0; ch < 16; ch++) {
        const g = typeof window.getPitchBendSensitivityFromControllerChangesAtTick === 'function'
            ? window.getPitchBendSensitivityFromControllerChangesAtTick(ch, tick, ccs)
            : { semitones: null };
        const semi = g && g.semitones != null && Number.isFinite(g.semitones) ? g.semitones : 2;
        audioEngine.setPitchBendSensitivitySemitones(ch, semi);
    }
    const lastPB = new Map();
    for (let i = 0; i < st.pbIndex; i++) {
        lastPB.set(pbs[i].channel, pbs[i].value);
    }
    for (const [ch, val] of lastPB) {
        audioEngine.pitchWheel(ch, val);
    }
    if (typeof window.pulseProMidiOutAfterAutomationSeek === 'function') {
        window.pulseProMidiOutAfterAutomationSeek(lastPB, lastCC, tick);
    }
}

function restoreEditorInstrumentsToAudioEngine() {
    const tracksWithNotes = new Set();
    for (const n of state.notes) {
        if (n.track >= 0 && n.track < state.tracks.length) tracksWithNotes.add(n.track);
    }
    const chInstr = new Array(16).fill(0);
    for (let ti = 0; ti < state.tracks.length; ti++) {
        if (!tracksWithNotes.has(ti)) continue;
        const trk = state.tracks[ti];
        chInstr[trk.channel] = trk.instrument;
    }
    for (let ch = 0; ch < 16; ch++) {
        audioEngine.setInstrument(ch, chInstr[ch]);
    }
}

/** Stop library preview if running; restores channel instruments from the current editor state. */
function stopLibraryPreview() {
    if (!libraryPreviewCtx) return;
    if (libraryPreviewCtx.rafId) cancelAnimationFrame(libraryPreviewCtx.rafId);
    if (libraryPreviewCtx.timerId) clearTimeout(libraryPreviewCtx.timerId);
    libraryPreviewCtx = null;
    audioEngine.allNotesOff();
    audioEngine.resetAllControllers();
    if (typeof window.pulseProMidiOutFullSilence === 'function') {
        window.pulseProMidiOutFullSilence();
    }
    restoreEditorInstrumentsToAudioEngine();
    if (typeof window.pulseProMidiOutSendProgramsFromAudioEngine === 'function') {
        window.pulseProMidiOutSendProgramsFromAudioEngine();
    }
    if (window.pulseProRefreshSongLibraryIfVisible) window.pulseProRefreshSongLibraryIfVisible();
}

function libraryPreviewTicksPerSecond(bpm) {
    return (bpm / 60) * MIDI_TPQN;
}

function scheduleNextLibraryPreviewLoop() {
    if (!libraryPreviewCtx) return;
    const st = libraryPreviewCtx;
    if (st.rafId != null) {
        cancelAnimationFrame(st.rafId);
        st.rafId = null;
    }
    if (st.timerId != null) {
        clearTimeout(st.timerId);
        st.timerId = null;
    }
    if (document.hidden) {
        st.timerId = setTimeout(function libraryPreviewBackgroundTick() {
            st.timerId = null;
            libraryPreviewLoop();
        }, PLAYBACK_BACKGROUND_INTERVAL_MS);
    } else {
        st.rafId = requestAnimationFrame(libraryPreviewLoop);
    }
}

function libraryPreviewLoop() {
    if (!libraryPreviewCtx) return;
    const st = libraryPreviewCtx;
    const elapsed = (performance.now() - st.playbackStartTime) / 1000;
    const playbackTick = st.playbackStartTick + elapsed * libraryPreviewTicksPerSecond(st.bpm);
    const endTick = st.endTick;

    if (playbackTick >= endTick && endTick > 0) {
        stopLibraryPreview();
        return;
    }

    const newActive = new Map();
    for (const n of st.notes) {
        const endN = n.startTick + n.durationTicks - NOTE_END_TRIM_LIBRARY;
        if (n.startTick <= playbackTick && endN > playbackTick) {
            newActive.set(n.id, { note: n.note, channel: n.channel, velocity: n.velocity ?? 100 });
        }
    }
    for (const [id, info] of st.activeNotes) {
        if (!newActive.has(id)) {
            audioEngine.noteOff(info.note, info.channel);
            if (typeof window.pulseProMidiOutNoteOff === 'function') {
                window.pulseProMidiOutNoteOff(info.note, info.channel);
            }
        }
    }
    for (const [id, info] of newActive) {
        if (!st.activeNotes.has(id)) {
            audioEngine.noteOn(info.note, info.channel, info.velocity);
            if (typeof window.pulseProMidiOutNoteOn === 'function') {
                window.pulseProMidiOutNoteOn(info.note, info.channel, info.velocity);
            }
        }
    }
    st.activeNotes = newActive;

    const pbs = st.pitchBends;
    const ccs = st.controllerChanges;
    const playT = playbackTick;
    const PRI_P = 1;
    const PRI_C = 2;
    while (true) {
        const candidates = [];
        if (st.pbIndex < pbs.length && pbs[st.pbIndex].tick <= playT) {
            candidates.push({ kind: 'p', tick: pbs[st.pbIndex].tick, pri: PRI_P });
        }
        if (st.ccIndex < ccs.length && ccs[st.ccIndex].tick <= playT) {
            candidates.push({ kind: 'c', tick: ccs[st.ccIndex].tick, pri: PRI_C });
        }
        if (candidates.length === 0) break;
        candidates.sort(function(a, b) {
            if (a.tick !== b.tick) return a.tick - b.tick;
            return a.pri - b.pri;
        });
        const first = candidates[0].kind;
        if (first === 'p') {
            const e = pbs[st.pbIndex];
            audioEngine.pitchWheel(e.channel, e.value);
            if (typeof window.pulseProMidiOutPitchWheel === 'function') {
                window.pulseProMidiOutPitchWheel(e.channel, e.value);
            }
            st.pbIndex++;
        } else {
            const e = ccs[st.ccIndex];
            audioEngine.controllerChange(e.channel, e.controller, e.value);
            if (typeof window.pulseProMidiOutControllerChange === 'function') {
                window.pulseProMidiOutControllerChange(e.channel, e.controller, e.value);
            }
            st.ccIndex++;
        }
    }

    scheduleNextLibraryPreviewLoop();
}

/**
 * Preview a MIDI file through the synth without loading it into the sequencer.
 * Clicking Play again for the same songId stops preview. Uses importMidi() in midi.js.
 */
function startLibraryPreview(arrayBuffer, songId) {
    if (libraryPreviewCtx && libraryPreviewCtx.songId === songId) {
        stopLibraryPreview();
        return;
    }
    stopLibraryPreview();
    stopPlayback();

    let r;
    try {
        r = importMidi(arrayBuffer);
    } catch (e) {
        alert('Could not play this file: ' + (e && e.message ? e.message : String(e)));
        return;
    }

    let nid = 1;
    const notes = r.notes.map(function(n) {
        return {
            id: nid++,
            note: n.note,
            channel: n.channel,
            startTick: n.startTick,
            durationTicks: n.durationTicks,
            velocity: n.velocity ?? 100,
        };
    });
    const endTick = Math.max(previewNotesEndTick(notes), previewAutomationEndTick(r));
    if (endTick <= 0) {
        alert('Nothing to play in this file.');
        return;
    }

    audioEngine.init();
    const chInstr = new Array(16).fill(0);
    for (const trk of r.importedTracks) {
        chInstr[trk.channel] = trk.instrument;
    }
    for (let ch = 0; ch < 16; ch++) {
        audioEngine.setInstrument(ch, chInstr[ch]);
    }
    if (typeof window.pulseProMidiOutSendProgramsFromArray === 'function') {
        window.pulseProMidiOutSendProgramsFromArray(chInstr);
    }

    libraryPreviewCtx = {
        songId: songId,
        rafId: null,
        timerId: null,
        notes: notes,
        pitchBends: r.pitchBends || [],
        controllerChanges: r.controllerChanges || [],
        bpm: r.bpm,
        playbackStartTime: performance.now(),
        playbackStartTick: 0,
        activeNotes: new Map(),
        pbIndex: 0,
        ccIndex: 0,
        endTick: endTick,
    };
    seekLibraryPreviewAutomation(0, libraryPreviewCtx.pitchBends, libraryPreviewCtx.controllerChanges,
        libraryPreviewCtx);
    scheduleNextLibraryPreviewLoop();
    if (window.pulseProRefreshSongLibraryIfVisible) window.pulseProRefreshSongLibraryIfVisible();
}

function getLibraryPreviewSongId() {
    return libraryPreviewCtx ? libraryPreviewCtx.songId : null;
}

(function initPlaybackDriverOnVisibilityChange() {
    document.addEventListener('visibilitychange', function() {
        if (state.isPlaying) {
            clearPlaybackLoopDriver();
            scheduleNextPlaybackLoop();
        }
        if (libraryPreviewCtx) {
            scheduleNextLibraryPreviewLoop();
        }
    });
})();

