// midi.js - MIDI file export/import (SMF Type 1)
// Internal ticks = raw MIDI ticks. MIDI file TPQN may differ from internal MIDI_TPQN.
function writeU16(a, v) { a.push((v >> 8) & 0xFF, v & 0xFF); }
function writeU32(a, v) { a.push((v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF); }
function writeVL(a, v) { const b = [v & 0x7F]; v >>= 7; while (v > 0) { b.push((v & 0x7F) | 0x80); v >>= 7; } b.reverse(); for (const x of b) a.push(x); }
function writeStr(a, s) { for (let i = 0; i < s.length; i++) a.push(s.charCodeAt(i)); }
function readU16(d, o) { return (d[o] << 8) | d[o + 1]; }
function readU32(d, o) { return ((d[o] << 24) | (d[o+1] << 16) | (d[o+2] << 8) | d[o+3]) >>> 0; }
function readVL(d, o) { let v = 0; while (true) { const b = d[o++]; v = (v << 7) | (b & 0x7F); if (!(b & 0x80)) break; } return { v, o }; }

/** Dedupe conductor events at the same tick (last wins). */
function dedupeConductorByTick(events) {
    const byTick = new Map();
    for (const e of events) {
        byTick.set(e.tick, e);
    }
    return Array.from(byTick.entries()).sort((a, b) => a[0] - b[0]).map(x => x[1]);
}

/**
 * From raw tempo / time-sig meta events, derive initial globals and change lists.
 * @param {{tick:number,bpm:number}[]} tempoEvents
 * @param {{tick:number,numerator:number,denominator:number}[]} tsEvents
 */
function mergeConductorMetaFromImport(tempoEvents, tsEvents) {
    const te = dedupeConductorByTick(tempoEvents.map(e => ({ tick: e.tick, bpm: e.bpm })));
    const se = dedupeConductorByTick(tsEvents.map(e => ({
        tick: e.tick, numerator: e.numerator, denominator: e.denominator,
    })));
    let bpm = 120;
    let tempoChanges = [];
    if (te.length > 0) {
        if (te[0].tick === 0) {
            bpm = te[0].bpm;
            tempoChanges = te.slice(1);
        } else {
            bpm = 120;
            tempoChanges = te.slice();
        }
    }
    let tsN = 4;
    let tsD = 4;
    let timeSigChanges = [];
    if (se.length > 0) {
        if (se[0].tick === 0) {
            tsN = se[0].numerator;
            tsD = se[0].denominator;
            timeSigChanges = se.slice(1);
        } else {
            tsN = 4;
            tsD = 4;
            timeSigChanges = se.slice();
        }
    }
    return { bpm, tsN, tsD, tempoChanges, timeSigChanges };
}

/** SMF track 0 bytes: all FF 58 / FF 51 meta with deltas, plus end of track. */
function buildConductorTrack0Bytes() {
    const events = [];
    function pushTempo(tick, bpm) {
        const us = Math.round(60000000 / bpm);
        const bytes = [0xFF, 0x51, 0x03, (us >> 16) & 0xFF, (us >> 8) & 0xFF, us & 0xFF];
        events.push({ tick, ord: 1, bytes });
    }
    function pushTs(tick, n, den) {
        const bytes = [0xFF, 0x58, 0x04, n, Math.log2(den) & 0xFF, 24, 8];
        events.push({ tick, ord: 0, bytes });
    }
    pushTs(0, state.timeSigNumerator, state.timeSigDenominator);
    pushTempo(0, state.bpm);
    for (const e of state.timeSigChanges) {
        pushTs(e.tick, e.numerator, e.denominator);
    }
    for (const e of state.tempoChanges) {
        pushTempo(e.tick, e.bpm);
    }
    events.sort((a, b) => a.tick - b.tick || a.ord - b.ord);
    const t0 = [];
    let prev = 0;
    for (const e of events) {
        writeVL(t0, e.tick - prev);
        for (const b of e.bytes) t0.push(b);
        prev = e.tick;
    }
    writeVL(t0, 0);
    t0.push(0xFF, 0x2F, 0x00);
    return t0;
}

function exportMidi() {
    if (state.notes.length === 0 && state.pitchBends.length === 0 && state.controllerChanges.length === 0
        && !conductorTrackVisible()) return null;
    // Group notes by track
    const trkNotes = Array.from({ length: state.tracks.length }, () => []);
    for (const n of state.notes) trkNotes[n.track].push(n);
    // Group automation events by channel (automation is still per-channel for MIDI output)
    const chPB = Array.from({ length: 16 }, () => []);
    const chCC = Array.from({ length: 16 }, () => []);
    for (const pb of state.pitchBends) chPB[pb.channel].push(pb);
    for (const cc of state.controllerChanges) chCC[cc.channel].push(cc);
    // Track which channels have had automation written (to avoid duplicates)
    const chAutomationWritten = new Array(16).fill(false);
    const tracks = [];
    tracks.push(buildConductorTrack0Bytes());
    for (let ti = 0; ti < state.tracks.length; ti++) {
        const trkInfo = state.tracks[ti];
        const ch = trkInfo.channel;
        const hasAutomation = !chAutomationWritten[ch] && (chPB[ch].length > 0 || chCC[ch].length > 0);
        if (trkNotes[ti].length === 0 && !hasAutomation) continue;
        const trk = [];
        const nm = trkInfo.name || `Track ${ti + 1}`;
        const nb = []; writeStr(nb, nm);
        writeVL(trk, 0); trk.push(0xFF, 0x03); writeVL(trk, nb.length); for (const b of nb) trk.push(b);
        writeVL(trk, 0); trk.push(0xC0 | ch, trkInfo.instrument);
        const evts = [];
        for (const n of trkNotes[ti]) {
            const vel = n.velocity ?? 100;
            const dur = Math.max(1, n.durationTicks | 0);
            const endT = n.startTick + dur;
            // Sort keys at equal tick: note-off before note-on (matches common SMF and our import order).
            // If note-on is sorted first, same-pitch legato pairs break and LIFO stacks mis-close notes.
            evts.push({ t: n.startTick, k: 1, d: [0x90 | ch, n.note, vel] });
            evts.push({ t: endT, k: 0, d: [0x80 | ch, n.note, 0] });
        }
        // Write automation events on the first track that uses this channel
        if (!chAutomationWritten[ch]) {
            chAutomationWritten[ch] = true;
            for (const pb of chPB[ch]) {
                const lsb = pb.value & 0x7F;
                const msb = (pb.value >> 7) & 0x7F;
                evts.push({ t: pb.tick, k: 0.5, d: [0xE0 | ch, lsb, msb] });
            }
            for (const cc of chCC[ch]) {
                evts.push({ t: cc.tick, k: 0.5, d: [0xB0 | ch, cc.controller, cc.value] });
            }
        }
        evts.sort((a, b) => {
            if (a.t !== b.t) return a.t - b.t;
            if (a.k !== b.k) return a.k - b.k;
            const isCCa = (a.d[0] & 0xf0) === 0xb0;
            const isCCb = (b.d[0] & 0xf0) === 0xb0;
            if (isCCa && isCCb) {
                const pa = controllerChangeSameTickSortPri(a.d[1], a.d[2]);
                const pb = controllerChangeSameTickSortPri(b.d[1], b.d[2]);
                if (pa !== pb) return pa - pb;
            }
            const ba = a.d[1] != null ? a.d[1] : 0;
            const bb = b.d[1] != null ? b.d[1] : 0;
            return ba - bb;
        });
        let prev = 0;
        for (const e of evts) {
            writeVL(trk, e.t - prev);
            for (const b of e.d) trk.push(b);
            prev = e.t;
        }
        writeVL(trk, 0); trk.push(0xFF, 0x2F, 0x00);
        tracks.push(trk);
    }
    const out = [];
    writeStr(out, 'MThd'); writeU32(out, 6);
    writeU16(out, 1); writeU16(out, tracks.length); writeU16(out, MIDI_TPQN);
    for (const trk of tracks) { writeStr(out, 'MTrk'); writeU32(out, trk.length); for (const b of trk) out.push(b); }
    return new Uint8Array(out);
}

/** Minimal SMF Type 1 (conductor track only: time signature, tempo, end). Used when exportMidi() has no note/automation data. */
function exportMidiOrEmptyTemplate() {
    const tracks = [buildConductorTrack0Bytes()];
    const out = [];
    writeStr(out, 'MThd'); writeU32(out, 6);
    writeU16(out, 1); writeU16(out, tracks.length); writeU16(out, MIDI_TPQN);
    for (const trk of tracks) { writeStr(out, 'MTrk'); writeU32(out, trk.length); for (const b of trk) out.push(b); }
    return new Uint8Array(out);
}

/**
 * Apply imported MIDI bytes to application state (file import, localStorage load).
 * @param {ArrayBuffer} arrayBuffer
 * @param {{ skipUndo?: boolean }} [options] skipUndo when caller already called pushUndoState (e.g. batch entry point).
 */
function applyMidiImportFromArrayBuffer(arrayBuffer, options) {
    stopLibraryPreview();
    const opts = options || {};
    const skipUndo = opts.skipUndo;
    if (opts.clearSessionAutosave !== false && typeof window.pulseProClearSessionAutosave === 'function') {
        void window.pulseProClearSessionAutosave();
    }
    const r = importMidi(arrayBuffer);
    if (!skipUndo) pushUndoState('load MIDI');
    stopPlayback();
    state.notes = []; state.selectedNoteIds.clear(); state.nextNoteId = 1;
    state.bpm = r.bpm;
    state.timeSigNumerator = r.tsN;
    state.timeSigDenominator = r.tsD;
    state.tempoChanges = r.tempoChanges ? r.tempoChanges.map(x => ({ tick: x.tick, bpm: x.bpm })) : [];
    state.timeSigChanges = r.timeSigChanges
        ? r.timeSigChanges.map(x => ({ tick: x.tick, numerator: x.numerator, denominator: x.denominator }))
        : [];
    sortTempoChanges();
    sortTimeSigChanges();
    state.conductor = { locked: false };
    state.conductorPlacementMode = null;
    state.conductorPlacementHoverTick = null;
    state.conductorMarkerDragPreview = null;
    state.tracks = r.importedTracks.map(t => ({
        name: t.name,
        channel: t.channel,
        instrument: t.instrument,
        color: null,
        hidden: false,
        locked: false,
        muted: false,
        solo: false,
    }));
    ensureMinTracks();
    for (const n of r.notes) addNote(n.note, n.channel, n.startTick, n.durationTicks, n.velocity, n.track);
    // Per-channel program from the file only (matches startLibraryPreview in playback.js).
    const chInstr = new Array(16).fill(0);
    for (const trk of r.importedTracks) chInstr[trk.channel] = trk.instrument;
    // Padded empty tracks share MIDI channels 1–16; keep their instrument field in sync so the
    // track list shows the real sound for that channel, not default piano (0).
    for (let i = 0; i < state.tracks.length; i++) {
        state.tracks[i].instrument = chInstr[state.tracks[i].channel];
    }
    for (let ch = 0; ch < 16; ch++) audioEngine.setInstrument(ch, chInstr[ch]);
    if (typeof window.pulseProMidiOutSendProgramsFromArray === 'function') {
        window.pulseProMidiOutSendProgramsFromArray(chInstr);
    }
    state.pitchBends = r.pitchBends || [];
    state.controllerChanges = r.controllerChanges || [];
    state.playbackTick = 0; state.playbackStartTick = 0; state.lastMousePlaybackTick = 0;
    if (state.verticalPianoRoll) {
        state.timelineHeaderScrollPx = 0;
        state.verticalTimePanPx = 0;
        state.scrollX = 0;
    } else {
        state.scrollX = 0;
    }
    setActiveTrack(0);
    reassignTrackColors();
    if (window.syncUIAfterImport) window.syncUIAfterImport();
    renderAll();
}

function readFileAsArrayBuffer(file) {
    return new Promise(function(resolve, reject) {
        const reader = new FileReader();
        reader.onload = function() { resolve(reader.result); };
        reader.onerror = function() { reject(reader.error || new Error('File read failed')); };
        reader.readAsArrayBuffer(file);
    });
}

function isMidiFileName(name) {
    return /\.(mid|midi)$/i.test(name);
}

/**
 * Import MIDI from disk: one file opens in the editor; multiple files are added to the Songs library only.
 */
function importMidiFileList(files) {
    const all = Array.from(files);
    const list = all.filter(function(f) { return isMidiFileName(f.name); });
    if (list.length === 0) {
        if (all.length > 0) alert('No MIDI files found (.mid / .midi).');
        return Promise.resolve();
    }
    if (list.length === 1) {
        return readFileAsArrayBuffer(list[0]).then(function(buf) {
            try {
                pushUndoState('import MIDI');
                applyMidiImportFromArrayBuffer(buf, { skipUndo: true });
                if (window.pulseProOnMidiImportedFromDisk) window.pulseProOnMidiImportedFromDisk(list[0].name);
            } catch (err) {
                alert('Failed to import MIDI: ' + err.message);
                console.error(err);
            }
        }).catch(function(err) {
            alert('Failed to read file: ' + (err && err.message ? err.message : String(err)));
        });
    }
    if (!window.pulseProAddMidiFilesToLibrary) {
        alert('Song library is not available.');
        return Promise.resolve();
    }
    return window.pulseProAddMidiFilesToLibrary(list);
}

/** Enable drag-and-drop of .mid/.midi onto a container (e.g. main sequencer area). */
function initMidiDragDrop(element) {
    if (!element) return;
    element.addEventListener('dragover', function(e) {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    element.addEventListener('drop', function(e) {
        e.preventDefault();
        const files = e.dataTransfer.files;
        if (!files || files.length === 0) return;
        importMidiFileList(files);
    });
}

const _PB_SENS_DEFAULT = 2;
const _PB_SENS_MIN = typeof PITCH_BEND_SENSITIVITY_SEMITONES_MIN === 'number' ? PITCH_BEND_SENSITIVITY_SEMITONES_MIN : 0.01;
const _PB_SENS_MAX = typeof PITCH_BEND_SENSITIVITY_SEMITONES_MAX === 'number' ? PITCH_BEND_SENSITIVITY_SEMITONES_MAX : 96;

/**
 * Sort key for control changes at the same tick/channel so RPN select (101/100) precedes data entry (6/38)
 * and null-RPN close (101=127,100=127) follows, matching hardware expectations.
 */
function controllerChangeSameTickSortPri(controller, value) {
    const c = controller | 0;
    const v = value | 0;
    if (c === 101) return v === 127 ? 50 : 0;
    if (c === 100) return v === 127 ? 51 : 1;
    if (c === 6) return 2;
    if (c === 38) return 3;
    return 100 + c;
}

/** Stable order for {@link state.controllerChanges} and import replay. */
function compareControllerChangesForPlayback(a, b) {
    const dt = (a.tick | 0) - (b.tick | 0);
    if (dt !== 0) return dt;
    const dc = (a.channel | 0) - (b.channel | 0);
    if (dc !== 0) return dc;
    const pa = controllerChangeSameTickSortPri(a.controller | 0, a.value | 0);
    const pb = controllerChangeSameTickSortPri(b.controller | 0, b.value | 0);
    if (pa !== pb) return pa - pb;
    const sa = a._seq !== undefined ? a._seq : 0;
    const sb = b._seq !== undefined ? b._seq : 0;
    if (sa !== sb) return sa - sb;
    return (a.controller | 0) - (b.controller | 0);
}

function sortStateControllerChanges() {
    if (typeof state === 'undefined' || !state || !Array.isArray(state.controllerChanges)) return;
    state.controllerChanges.sort(compareControllerChangesForPlayback);
    if (typeof window.bumpPitchBendControllerMutationForSensCache === 'function') {
        window.bumpPitchBendControllerMutationForSensCache();
    }
}

function encodePitchBendSensitivitySemitonesToCoarseFine(semitones) {
    let s = Number(semitones);
    if (!Number.isFinite(s)) s = _PB_SENS_DEFAULT;
    s = _clampPitchSensitivitySemi(s);
    let coarse = Math.floor(s);
    let fine = Math.round((s - coarse) * 128);
    if (fine >= 128) {
        coarse += 1;
        fine -= 128;
    }
    if (fine < 0) fine = 0;
    coarse = Math.max(0, Math.min(127, coarse));
    fine = Math.max(0, Math.min(127, fine));
    return { coarse: coarse, fine: fine };
}

/**
 * RPN 0,0 pitch-bend sensitivity as raw CC events (select + data entry + null RPN), one timeline tick.
 * @returns {{ tick: number, channel: number, controller: number, value: number }[]}
 */
function buildPitchBendSensitivityRpnControllerEvents(channel, tick, semitones) {
    const ch = channel | 0;
    const t = tick | 0;
    const cf = encodePitchBendSensitivitySemitonesToCoarseFine(semitones);
    return [
        { tick: t, channel: ch, controller: 101, value: 0 },
        { tick: t, channel: ch, controller: 100, value: 0 },
        { tick: t, channel: ch, controller: 6, value: cf.coarse },
        { tick: t, channel: ch, controller: 38, value: cf.fine },
        { tick: t, channel: ch, controller: 101, value: 127 },
        { tick: t, channel: ch, controller: 100, value: 127 },
    ];
}

function stripPitchBendRpnControllersAtTickForChannel(list, channel, tick) {
    const ch = channel | 0;
    const t = tick | 0;
    return list.filter(function(ev) {
        if ((ev.tick | 0) !== t || (ev.channel | 0) !== ch) return true;
        const c = ev.controller | 0;
        return !(c === 101 || c === 100 || c === 6 || c === 38);
    });
}

/** Replace any RPN 6/38/101/100 at (tick, channel) with a full sensitivity RPN sequence in {@link state.controllerChanges}. */
function applyPitchBendSensitivityRpnAtTick(channel, tick, semitones) {
    if (typeof state === 'undefined' || !state) return;
    const ch = channel | 0;
    const t = tick | 0;
    const base = stripPitchBendRpnControllersAtTickForChannel(state.controllerChanges || [], ch, t);
    state.controllerChanges = base.concat(buildPitchBendSensitivityRpnControllerEvents(ch, t, semitones));
    sortStateControllerChanges();
}

function removePitchBendSensitivityRpnBundleFromState(channel, tick) {
    if (typeof state === 'undefined' || !state) return;
    const ch = channel | 0;
    const t = tick | 0;
    state.controllerChanges = stripPitchBendRpnControllersAtTickForChannel(state.controllerChanges || [], ch, t);
    sortStateControllerChanges();
}

/** Last winning semitone per (tick, channel) for conductor / header UI (avoids duplicate commits from 6+38 same tick). */
function getPitchBendSensitivityDisplayChanges() {
    const raw = computePitchBendSensitivityChanges(state.controllerChanges || []);
    const byKey = new Map();
    for (let i = 0; i < raw.length; i++) {
        const e = raw[i];
        const k = (e.tick | 0) + ',' + (e.channel | 0);
        byKey.set(k, e);
    }
    return Array.from(byKey.values()).sort(function(a, b) {
        return a.tick - b.tick || (a.channel | 0) - (b.channel | 0);
    });
}

function _clampPitchSensitivitySemi(s) {
    if (!Number.isFinite(s)) return _PB_SENS_DEFAULT;
    return Math.max(_PB_SENS_MIN, Math.min(_PB_SENS_MAX, s));
}

/** Mutable FSM for RPN 0,0 pitch bend range from a CC stream (MIDI Registered Parameter). */
function createPitchBendSensitivityFsmFromCcStream() {
    return {
        rpnHi: new Array(16).fill(127),
        rpnLo: new Array(16).fill(127),
        dataCoarse: new Array(16).fill(0),
        lastSent: new Array(16).fill(NaN),
        currentSemi: new Array(16).fill(null),
        lastChangeTick: new Array(16).fill(-1),
        maxSemiEver: _PB_SENS_DEFAULT,
    };
}

/**
 * Apply one controller change to pitch-bend sensitivity FSM.
 * @returns {{ changed: boolean, channel: number, semitones: number }} changed when a new sensitivity value is committed for that channel
 */
function applyControllerEventForPitchSensitivityFsm(fsm, ev) {
    const ch = ev.channel | 0;
    const cc = ev.controller | 0;
    const v = ev.value | 0;
    if (cc === 101) {
        fsm.rpnHi[ch] = v;
        fsm.dataCoarse[ch] = 0;
        return { changed: false, channel: ch, semitones: _PB_SENS_DEFAULT };
    }
    if (cc === 100) {
        fsm.rpnLo[ch] = v;
        fsm.dataCoarse[ch] = 0;
        return { changed: false, channel: ch, semitones: _PB_SENS_DEFAULT };
    }
    if (fsm.rpnHi[ch] !== 0 || fsm.rpnLo[ch] !== 0) {
        return { changed: false, channel: ch, semitones: _PB_SENS_DEFAULT };
    }
    let semi = NaN;
    if (cc === 6) {
        fsm.dataCoarse[ch] = v;
        semi = _clampPitchSensitivitySemi(v);
    } else if (cc === 38) {
        semi = _clampPitchSensitivitySemi(fsm.dataCoarse[ch] + v / 128);
    } else {
        return { changed: false, channel: ch, semitones: _PB_SENS_DEFAULT };
    }
    if (semi === fsm.lastSent[ch]) {
        return { changed: false, channel: ch, semitones: semi };
    }
    fsm.lastSent[ch] = semi;
    fsm.currentSemi[ch] = semi;
    fsm.lastChangeTick[ch] = ev.tick | 0;
    if (semi > fsm.maxSemiEver) fsm.maxSemiEver = semi;
    return { changed: true, channel: ch, semitones: semi };
}

/**
 * Replay sorted controller changes up to tick (inclusive) and return FSM snapshot.
 * @param {{ tick: number, channel: number, controller: number, value: number }[]} sortedCCs
 * @param {number} tickLimit
 */
function replayPitchBendSensitivityFsmFromControllerChanges(sortedCCs, tickLimit) {
    const fsm = createPitchBendSensitivityFsmFromCcStream();
    const lim = typeof tickLimit === 'number' && Number.isFinite(tickLimit)
        ? Math.floor(tickLimit)
        : 0x7fffffff;
    const ccs = sortedCCs || [];
    for (let i = 0; i < ccs.length; i++) {
        const ev = ccs[i];
        if (ev.tick > lim) break;
        applyControllerEventForPitchSensitivityFsm(fsm, ev);
    }
    return fsm;
}

/**
 * Effective ±semitones from raw CC RPN 0,0 + data entry.
 * @param {number} channel 0–15
 * @param {number} tick
 * @param {{ tick: number, channel: number, controller: number, value: number }[]} [optSortedCcs] optional list (e.g. library preview); defaults to {@link state.controllerChanges}
 * @returns {{ semitones: number|null, lastTick: number }}
 */
function getPitchBendSensitivityFromControllerChangesAtTick(channel, tick, optSortedCcs) {
    const ch = channel | 0;
    const ccs = optSortedCcs != null
        ? optSortedCcs
        : (typeof state !== 'undefined' && state && state.controllerChanges ? state.controllerChanges : []);
    const fsm = replayPitchBendSensitivityFsmFromControllerChanges(ccs, tick);
    const semi = fsm.currentSemi[ch];
    const t = fsm.lastChangeTick[ch];
    if (semi != null && Number.isFinite(semi)) {
        return { semitones: semi, lastTick: t >= 0 ? t : -1 };
    }
    return { semitones: null, lastTick: -1 };
}

/**
 * Max ±semitones seen anywhere in the controller CC stream (for layout when markers are empty).
 * @param {{ tick: number, channel: number, controller: number, value: number }[]} sortedCCs
 */
function getMaxPitchSensitivitySemitonesFromControllerChanges(sortedCCs) {
    const fsm = replayPitchBendSensitivityFsmFromControllerChanges(sortedCCs, 0x7fffffff);
    return fsm.maxSemiEver;
}

window.getPitchBendSensitivityFromControllerChangesAtTick = getPitchBendSensitivityFromControllerChangesAtTick;
window.getMaxPitchSensitivitySemitonesFromControllerChanges = getMaxPitchSensitivitySemitonesFromControllerChanges;
window.sortStateControllerChanges = sortStateControllerChanges;
window.applyPitchBendSensitivityRpnAtTick = applyPitchBendSensitivityRpnAtTick;
window.removePitchBendSensitivityRpnBundleFromState = removePitchBendSensitivityRpnBundleFromState;
window.getPitchBendSensitivityDisplayChanges = getPitchBendSensitivityDisplayChanges;
window.compareControllerChangesForPlayback = compareControllerChangesForPlayback;

/**
 * Build pitch-bend sensitivity (± semitones) events from RPN 0,0 + Data Entry (CC6/CC38) on sorted controller list.
 * @param {{ tick: number, channel: number, controller: number, value: number }[]} sortedCCs
 * @returns {{ tick: number, channel: number, semitones: number }[]}
 */
function computePitchBendSensitivityChanges(sortedCCs) {
    const changes = [];
    const fsm = createPitchBendSensitivityFsmFromCcStream();
    for (let i = 0; i < sortedCCs.length; i++) {
        const ev = sortedCCs[i];
        const r = applyControllerEventForPitchSensitivityFsm(fsm, ev);
        if (r.changed) {
            changes.push({ tick: ev.tick | 0, channel: r.channel, semitones: r.semitones });
        }
    }
    changes.sort(function(a, b) { return a.tick - b.tick || a.channel - b.channel; });
    return changes;
}

window.computePitchBendSensitivityChanges = computePitchBendSensitivityChanges;

function importMidi(buf) {
    const d = new Uint8Array(buf);
    if (String.fromCharCode(d[0], d[1], d[2], d[3]) !== 'MThd') throw new Error('Not a valid MIDI file');
    const hLen = readU32(d, 4), nTrk = readU16(d, 10), div = readU16(d, 12);
    if (div & 0x8000) throw new Error('SMPTE not supported');
    const sc = MIDI_TPQN / div; // scale file ticks to internal MIDI_TPQN ticks
    const tempoEvents = [];
    const tsEvents = [];
    const notes = [];
    const pitchBends = [], controllerChanges = [];
    let ccImportSeq = 0;
    // Build tracks array: one per SMF track chunk (skip empty conductor tracks later)
    const importedTracks = []; // {name, channel, instrument}
    let off = 8 + hLen;
    for (let t = 0; t < nTrk; t++) {
        const cid = String.fromCharCode(d[off], d[off+1], d[off+2], d[off+3]);
        off += 4; const clen = readU32(d, off); off += 4;
        if (cid !== 'MTrk') { off += clen; continue; }
        const tend = off + clen;
        let at = 0, rs = 0, pn = null;
        /** @type {Map<string, { t: number, v: number }[]>} LIFO stack per ch-note (overlapping same-pitch notes). */
        const pendingStacks = new Map();
        const trkNotes = [];
        const chInstruments = new Array(16).fill(0); // per-channel program changes
        const channelsSeen = new Set();
        function pushNoteOn(k, t, v) {
            let st = pendingStacks.get(k);
            if (!st) {
                st = [];
                pendingStacks.set(k, st);
            }
            st.push({ t, v });
        }
        function closeNoteFromStack(k, endAbsTick, nt, ch) {
            const st = pendingStacks.get(k);
            if (!st || st.length === 0) return;
            const s = st.pop();
            if (st.length === 0) pendingStacks.delete(k);
            trkNotes.push({
                note: nt,
                channel: ch,
                startTick: Math.round(s.t * sc),
                durationTicks: Math.max(1, Math.round((endAbsTick - s.t) * sc)),
                velocity: s.v,
            });
        }
        while (off < tend) {
            const dv = readVL(d, off); off = dv.o; at += dv.v;
            let sb = d[off];
            if (sb & 0x80) { rs = sb; off++; } else { sb = rs; }
            const tp = sb & 0xF0, ch = sb & 0x0F;
            if (sb === 0xFF) {
                const mt = d[off++]; const ml = readVL(d, off); off = ml.o;
                if (mt === 0x51 && ml.v === 3) {
                    const tbpm = Math.round(60000000 / ((d[off] << 16) | (d[off + 1] << 8) | d[off + 2]));
                    tempoEvents.push({ tick: Math.round(at * sc), bpm: tbpm });
                } else if (mt === 0x58 && ml.v >= 2) {
                    tsEvents.push({
                        tick: Math.round(at * sc),
                        numerator: d[off],
                        denominator: Math.pow(2, d[off + 1]),
                    });
                }
                else if (mt === 0x03 && ml.v > 0) pn = String.fromCharCode(...d.slice(off, off + ml.v));
                off += ml.v;
            } else if (tp === 0x90) {
                const nt = d[off++], vl = d[off++];
                channelsSeen.add(ch);
                const k = `${ch}-${nt}`;
                if (vl === 0) {
                    closeNoteFromStack(k, at, nt, ch);
                } else {
                    pushNoteOn(k, at, vl);
                }
            } else if (tp === 0x80) {
                const nt = d[off++]; off++;
                channelsSeen.add(ch);
                const k = `${ch}-${nt}`;
                closeNoteFromStack(k, at, nt, ch);
            } else if (tp === 0xB0) {
                const cc = d[off++], cv = d[off++];
                controllerChanges.push({
                    tick: Math.round(at * sc),
                    channel: ch,
                    controller: cc,
                    value: cv,
                    _seq: ccImportSeq++,
                });
            } else if (tp === 0xE0) {
                const lsb = d[off++], msb = d[off++];
                const val = (msb << 7) | lsb;
                pitchBends.push({ tick: Math.round(at * sc), channel: ch, value: val });
            } else if (tp === 0xC0) {
                const pg = d[off++];
                chInstruments[ch] = pg;
            }
            else if (tp === 0xD0) off++;
            else if (sb === 0xF0 || sb === 0xF7) { const sl = readVL(d, off); off = sl.o + sl.v; }
            else off += 2;
        }
        // Implicit note-off at end of track for any keys still held (matches common MIDI semantics)
        for (const [k, st] of pendingStacks) {
            while (st.length > 0) {
                const s = st.pop();
                const parts = k.split('-');
                const pch = parseInt(parts[0], 10);
                const pnt = parseInt(parts[1], 10);
                trkNotes.push({
                    note: pnt,
                    channel: pch,
                    startTick: Math.round(s.t * sc),
                    durationTicks: Math.max(1, Math.round((at - s.t) * sc)),
                    velocity: s.v,
                });
            }
        }
        pendingStacks.clear();
        off = tend;
        if (trkNotes.length === 0) continue;
        // If this SMF track uses only one channel, create one track
        // If it uses multiple channels (e.g. Format 0), split into one track per channel
        const channels = Array.from(channelsSeen).sort((a, b) => a - b);
        if (channels.length <= 1) {
            const ch = channels.length === 1 ? channels[0] : 0;
            const trackIdx = importedTracks.length;
            importedTracks.push({
                name: pn || `Track ${trackIdx + 1}`,
                channel: ch,
                instrument: chInstruments[ch],
            });
            for (const n of trkNotes) { n.track = trackIdx; notes.push(n); }
        } else {
            // Split: one imported track per channel
            for (const ch of channels) {
                const chNotes = trkNotes.filter(n => n.channel === ch);
                if (chNotes.length === 0) continue;
                const trackIdx = importedTracks.length;
                const suffix = pn ? `${pn} (Ch ${ch + 1})` : `Track ${trackIdx + 1} (Ch ${ch + 1})`;
                importedTracks.push({
                    name: suffix,
                    channel: ch,
                    instrument: chInstruments[ch],
                });
                for (const n of chNotes) { n.track = trackIdx; notes.push(n); }
            }
        }
    }
    // If no tracks were created (e.g. empty file), create a default one
    if (importedTracks.length === 0) {
        importedTracks.push({ name: 'Track 1', channel: 0, instrument: 0 });
    }
    const cm = mergeConductorMetaFromImport(tempoEvents, tsEvents);
    // Sort automation events by tick for efficient playback scanning
    pitchBends.sort((a, b) => a.tick - b.tick);
    controllerChanges.sort(compareControllerChangesForPlayback);
    for (let i = 0; i < controllerChanges.length; i++) {
        if (Object.prototype.hasOwnProperty.call(controllerChanges[i], '_seq')) {
            delete controllerChanges[i]._seq;
        }
    }
    return {
        notes,
        bpm: cm.bpm,
        tsN: cm.tsN,
        tsD: cm.tsD,
        tempoChanges: cm.tempoChanges,
        timeSigChanges: cm.timeSigChanges,
        importedTracks,
        pitchBends,
        controllerChanges,
    };
}

function downloadMidiFile() {
    let bytes = exportMidi();
    if (!bytes) bytes = exportMidiOrEmptyTemplate();
    if (!bytes) { alert('Nothing to export.'); return; }
    const blob = new Blob([bytes], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'song.mid'; a.click();
    URL.revokeObjectURL(url);
}

function openMidiFile() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.mid,.midi,audio/midi,audio/x-midi';
    inp.multiple = true;
    inp.addEventListener('change', function() {
        if (!this.files || this.files.length === 0) return;
        importMidiFileList(this.files).finally(function() { inp.value = ''; });
    });
    inp.click();
}
