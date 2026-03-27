// playback.js - Playback engine
let playbackAnimFrame = null;
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

function syncPlaybackSoundingTracksFromMap(activeMap) {
    state.playbackSoundingTracks.clear();
    for (const info of activeMap.values()) {
        state.playbackSoundingTracks.add(info.track);
    }
}

function startPlayback() {
    stopLibraryPreview();
    audioEngine.init();
    state.isPlaying = true;
    state.isPaused = false;
    state.playbackStartTime = performance.now();
    state.playbackStartTick = state.playbackTick;
    playbackActiveNotes.clear();
    state.playbackSoundingTracks.clear();
    // Seek automation indices to current playback position and apply last-known values
    seekAutomationTo(state.playbackTick);
    updatePlaybackButtons();
    playbackLoop();
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
    // Apply the most recent pitch bend per channel up to this tick
    const lastPB = new Map();
    for (let i = 0; i < playbackPBIndex; i++) {
        lastPB.set(pbs[i].channel, pbs[i].value);
    }
    for (const [ch, val] of lastPB) {
        audioEngine.pitchWheel(ch, val);
    }
    // Apply the most recent CC per channel+controller up to this tick
    const lastCC = new Map();
    for (let i = 0; i < playbackCCIndex; i++) {
        const e = ccs[i];
        lastCC.set(`${e.channel}-${e.controller}`, { channel: e.channel, controller: e.controller, value: e.value });
    }
    for (const info of lastCC.values()) {
        audioEngine.controllerChange(info.channel, info.controller, info.value);
    }
}

function pausePlayback() {
    stopLibraryPreview();
    state.isPlaying = false;
    state.isPaused = true;
    if (playbackAnimFrame) cancelAnimationFrame(playbackAnimFrame);
    playbackAnimFrame = null;
    audioEngine.allNotesOff();
    playbackActiveNotes.clear();
    state.playbackSoundingTracks.clear();
    updatePlaybackButtons();
}

/**
 * Stop editor playback: silence output and cancel the animation frame.
 * @param {{ naturalEnd?: boolean }} [options] If naturalEnd, move the playhead to {@link state.lastMousePlaybackTick}
 *   (clamped to song end) instead of rewinding to tick 0; otherwise rewind and clear lastMousePlaybackTick.
 */
function stopPlayback(options) {
    const naturalEnd = options && options.naturalEnd;
    stopLibraryPreview();
    state.isPlaying = false;
    state.isPaused = false;
    if (playbackAnimFrame) cancelAnimationFrame(playbackAnimFrame);
    playbackAnimFrame = null;
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
        state.playbackTick = 0;
        state.playbackStartTick = 0;
        state.lastMousePlaybackTick = 0;
        playbackPBIndex = 0;
        playbackCCIndex = 0;
    }
    updatePlaybackButtons();
    renderAll();
}

function togglePlayPause() {
    if (state.isPlaying) {
        pausePlayback();
    } else {
        startPlayback();
    }
}

function playbackLoop() {
    if (!state.isPlaying) return;
    const elapsed = (performance.now() - state.playbackStartTime) / 1000;
    const wallAtStart = wallSecondsFromTick(state.playbackStartTick);
    const currentTick = tickFromWallSeconds(wallAtStart + elapsed);
    // Use measure-aligned end tick for looping, raw end tick for non-loop stop
    const endMeasureTick = getEndMeasureTick();
    const endTick = state.isRepeat ? endMeasureTick : getEndTick();

    // Check if we've reached the end
    if (currentTick >= endTick && endTick > 0) {
        if (state.isRepeat) {
            state.playbackStartTime = performance.now();
            state.playbackStartTick = 0;
            state.playbackTick = 0;
            audioEngine.allNotesOff();
            audioEngine.resetAllControllers();
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
        }
    }
    // Now start newly active notes
    for (const [id, info] of newActive) {
        if (!playbackActiveNotes.has(id)) {
            audioEngine.noteOn(info.note, info.channel, info.velocity);
        }
    }
    playbackActiveNotes = newActive;
    syncPlaybackSoundingTracksFromMap(newActive);

    // Process pitch bend events up to current tick
    const pbs = state.pitchBends;
    while (playbackPBIndex < pbs.length && pbs[playbackPBIndex].tick <= state.playbackTick) {
        const e = pbs[playbackPBIndex];
        audioEngine.pitchWheel(e.channel, e.value);
        playbackPBIndex++;
    }

    // Process controller change events up to current tick
    const ccs = state.controllerChanges;
    while (playbackCCIndex < ccs.length && ccs[playbackCCIndex].tick <= state.playbackTick) {
        const e = ccs[playbackCCIndex];
        audioEngine.controllerChange(e.channel, e.controller, e.value);
        playbackCCIndex++;
    }

    // Auto-scroll to keep playback head in view
    const pbScreenX = state.playbackTick * SNAP_WIDTH - state.scrollX;
    const margin = state.gridWidth * 0.15;
    if (pbScreenX > state.gridWidth - margin) {
        state.scrollX = state.playbackTick * SNAP_WIDTH - state.gridWidth + margin;
    } else if (pbScreenX < margin) {
        state.scrollX = Math.max(0, state.playbackTick * SNAP_WIDTH - margin);
    }

    renderAll();
    playbackAnimFrame = requestAnimationFrame(playbackLoop);
}

function updatePlaybackButtons() {
    const btnPlay = document.getElementById('btn-play');
    const btnPause = document.getElementById('btn-pause');
    btnPlay.style.display = state.isPlaying ? 'none' : 'inline-block';
    btnPause.style.display = state.isPlaying ? 'inline-block' : 'none';
}

/** End tick used for playback boundary (matches playbackLoop). */
function getPlaybackMaxTick() {
    const raw = getEndTick();
    if (raw <= 0) return 0;
    return state.isRepeat ? getEndMeasureTick() : raw;
}

/**
 * Move the playback head to tick (clamped). If playing, continues from the new position with automation aligned.
 */
function seekPlaybackToTick(tick) {
    const maxT = getPlaybackMaxTick();
    let t = Math.max(0, tick);
    if (maxT > 0) t = Math.min(t, maxT);
    state.playbackTick = t;
    if (state.isPlaying) {
        state.playbackStartTick = t;
        state.playbackStartTime = performance.now();
        seekAutomationTo(t);
        audioEngine.allNotesOff();
        playbackActiveNotes.clear();
        state.playbackSoundingTracks.clear();
    } else {
        state.playbackStartTick = t;
    }
    renderAll();
}

window.getPlaybackMaxTick = getPlaybackMaxTick;
window.seekPlaybackToTick = seekPlaybackToTick;

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
    const lastPB = new Map();
    for (let i = 0; i < st.pbIndex; i++) {
        lastPB.set(pbs[i].channel, pbs[i].value);
    }
    for (const [ch, val] of lastPB) {
        audioEngine.pitchWheel(ch, val);
    }
    const lastCC = new Map();
    for (let i = 0; i < st.ccIndex; i++) {
        const e = ccs[i];
        lastCC.set(`${e.channel}-${e.controller}`, { channel: e.channel, controller: e.controller, value: e.value });
    }
    for (const info of lastCC.values()) {
        audioEngine.controllerChange(info.channel, info.controller, info.value);
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
    libraryPreviewCtx = null;
    audioEngine.allNotesOff();
    audioEngine.resetAllControllers();
    restoreEditorInstrumentsToAudioEngine();
    if (window.pulseProRefreshSongLibraryIfVisible) window.pulseProRefreshSongLibraryIfVisible();
}

function libraryPreviewTicksPerSecond(bpm) {
    return (bpm / 60) * MIDI_TPQN;
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
        }
    }
    for (const [id, info] of newActive) {
        if (!st.activeNotes.has(id)) {
            audioEngine.noteOn(info.note, info.channel, info.velocity);
        }
    }
    st.activeNotes = newActive;

    const pbs = st.pitchBends;
    while (st.pbIndex < pbs.length && pbs[st.pbIndex].tick <= playbackTick) {
        const e = pbs[st.pbIndex];
        audioEngine.pitchWheel(e.channel, e.value);
        st.pbIndex++;
    }
    const ccs = st.controllerChanges;
    while (st.ccIndex < ccs.length && ccs[st.ccIndex].tick <= playbackTick) {
        const e = ccs[st.ccIndex];
        audioEngine.controllerChange(e.channel, e.controller, e.value);
        st.ccIndex++;
    }

    st.rafId = requestAnimationFrame(libraryPreviewLoop);
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

    libraryPreviewCtx = {
        songId: songId,
        rafId: null,
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
    seekLibraryPreviewAutomation(0, libraryPreviewCtx.pitchBends, libraryPreviewCtx.controllerChanges, libraryPreviewCtx);
    libraryPreviewCtx.rafId = requestAnimationFrame(libraryPreviewLoop);
    if (window.pulseProRefreshSongLibraryIfVisible) window.pulseProRefreshSongLibraryIfVisible();
}

function getLibraryPreviewSongId() {
    return libraryPreviewCtx ? libraryPreviewCtx.songId : null;
}

(function initPausePlaybackWhenPageInactive() {
    function pauseIfNothingShouldPlay() {
        if (state.isPlaying || libraryPreviewCtx) pausePlayback();
    }
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') pauseIfNothingShouldPlay();
    });
    window.addEventListener('blur', function() {
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                if (document.visibilityState === 'hidden') return;
                if (!document.hasFocus()) pauseIfNothingShouldPlay();
            });
        });
    });
})();

