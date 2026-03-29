// midi-output.js - Optional playback to a connected MIDI output device (Web MIDI API).

const MIDI_OUT_STORAGE_KEY = 'pulsepro-midi-output-id';

let midiOutputMidiAccess = null;
/** @type {string} */
let selectedOutputId = '';
/** @type {MIDIOutput | null} */
let currentOutputPort = null;
/** Keys `${channel}-${note}` for notes we turned on (mirrors audioEngine.activeNotes for external gear). */
const midiOutHeldKeys = new Set();

function readStoredOutputId() {
    try {
        return localStorage.getItem(MIDI_OUT_STORAGE_KEY) || '';
    } catch (_e) {
        return '';
    }
}

function writeStoredOutputId(id) {
    try {
        localStorage.setItem(MIDI_OUT_STORAGE_KEY, id || '');
    } catch (_e) { /* ignore */ }
}

function bindCurrentPort() {
    currentOutputPort = null;
    if (!midiOutputMidiAccess || !selectedOutputId) return;
    const port = midiOutputMidiAccess.outputs.get(selectedOutputId);
    if (port && port.state === 'connected') {
        currentOutputPort = port;
    }
}

/**
 * @returns {Promise<boolean>}
 */
async function pulseProEnsureMidiOutputAccess() {
    if (midiOutputMidiAccess) return true;
    if (!navigator.requestMIDIAccess) return false;
    try {
        midiOutputMidiAccess = await navigator.requestMIDIAccess({ sysex: false });
        midiOutputMidiAccess.onstatechange = function() {
            bindCurrentPort();
            if (typeof window.pulseProRefreshMidiOutputSelect === 'function') {
                window.pulseProRefreshMidiOutputSelect();
            }
        };
        return true;
    } catch (_e) {
        return false;
    }
}

function pulseProMidiOutIsActive() {
    return !!currentOutputPort;
}

function sendBytes(bytes) {
    if (!currentOutputPort) return;
    try {
        currentOutputPort.send(new Uint8Array(bytes));
    } catch (_e) { /* ignore */ }
}

function heldKey(ch, note) {
    return (ch & 0x0f) + '-' + (note & 0x7f);
}

function pulseProMidiOutNoteOn(note, channel, velocity) {
    if (!pulseProMidiOutIsActive()) return;
    const ch = channel & 0x0f;
    const n = note & 0x7f;
    const vel = Math.max(1, Math.min(127, velocity | 0));
    const k = heldKey(ch, n);
    if (midiOutHeldKeys.has(k)) {
        sendBytes([0x80 | ch, n, 0]);
    }
    sendBytes([0x90 | ch, n, vel]);
    midiOutHeldKeys.add(k);
}

function pulseProMidiOutNoteOff(note, channel) {
    if (!pulseProMidiOutIsActive()) return;
    const ch = channel & 0x0f;
    const n = note & 0x7f;
    midiOutHeldKeys.delete(heldKey(ch, n));
    sendBytes([0x80 | ch, n, 0]);
}

function pulseProMidiOutPitchWheel(channel, value14) {
    if (!pulseProMidiOutIsActive()) return;
    const ch = channel & 0x0f;
    const v = Math.max(0, Math.min(16383, value14 | 0));
    sendBytes([0xe0 | ch, v & 0x7f, (v >> 7) & 0x7f]);
}

function pulseProMidiOutControllerChange(channel, controller, value) {
    if (!pulseProMidiOutIsActive()) return;
    const ch = channel & 0x0f;
    const val = Math.max(0, Math.min(127, value | 0));
    sendBytes([0xb0 | ch, controller & 0x7f, val]);
}

function pulseProMidiOutProgramChange(channel, program) {
    if (!pulseProMidiOutIsActive()) return;
    const ch = channel & 0x0f;
    sendBytes([0xc0 | ch, program & 0x7f]);
}

/** Per-channel reset aligned with audioEngine.resetAllControllers (no all-notes-off). */
function pulseProMidiOutResetControllersOnly() {
    if (!pulseProMidiOutIsActive()) return;
    for (let ch = 0; ch < 16; ch++) {
        pulseProMidiOutControllerChange(ch, 64, 0);
        pulseProMidiOutPitchWheel(ch, 8192);
        pulseProMidiOutControllerChange(ch, 7, 100);
        pulseProMidiOutControllerChange(ch, 10, 64);
        pulseProMidiOutControllerChange(ch, 11, 127);
        pulseProMidiOutControllerChange(ch, 1, automationCcDefaultMidi(1));
        pulseProMidiOutControllerChange(ch, 71, automationCcDefaultMidi(71));
        pulseProMidiOutControllerChange(ch, 72, automationCcDefaultMidi(72));
        pulseProMidiOutControllerChange(ch, 73, automationCcDefaultMidi(73));
        pulseProMidiOutControllerChange(ch, 74, automationCcDefaultMidi(74));
        pulseProMidiOutControllerChange(ch, 91, automationCcDefaultMidi(91));
        pulseProMidiOutControllerChange(ch, 93, automationCcDefaultMidi(93));
    }
}

function pulseProMidiOutAllNotesOff() {
    midiOutHeldKeys.clear();
    if (!pulseProMidiOutIsActive()) return;
    for (let ch = 0; ch < 16; ch++) {
        pulseProMidiOutControllerChange(ch, 123, 0);
    }
}

/** All notes off plus controller reset (stop / loop jump). */
function pulseProMidiOutFullSilence() {
    if (!pulseProMidiOutIsActive()) return;
    pulseProMidiOutAllNotesOff();
    pulseProMidiOutResetControllersOnly();
}

/**
 * After audio seekAutomationTo: reset hardware, then apply last pitch/CC maps from the timeline.
 * @param {Map<number, number>} lastPB channel → 14-bit bend
 * @param {Map<string, {channel:number, controller:number, value:number}>} lastCC
 */
function pulseProMidiOutAfterAutomationSeek(lastPB, lastCC) {
    if (!pulseProMidiOutIsActive()) return;
    pulseProMidiOutAllNotesOff();
    pulseProMidiOutResetControllersOnly();
    for (const [ch, val] of lastPB) {
        pulseProMidiOutPitchWheel(ch, val);
    }
    for (const info of lastCC.values()) {
        pulseProMidiOutControllerChange(info.channel, info.controller, info.value);
    }
}

/** Send program change for channels 0–15 from audioEngine.channelInstruments. */
function pulseProMidiOutSendProgramsFromAudioEngine() {
    if (!pulseProMidiOutIsActive()) return;
    for (let ch = 0; ch < 16; ch++) {
        pulseProMidiOutProgramChange(ch, audioEngine.channelInstruments[ch] | 0);
    }
}

/**
 * @param {number[]|Uint8Array} chInstr length 16, program per MIDI channel
 */
function pulseProMidiOutSendProgramsFromArray(chInstr) {
    if (!pulseProMidiOutIsActive() || !chInstr || chInstr.length < 16) return;
    for (let ch = 0; ch < 16; ch++) {
        pulseProMidiOutProgramChange(ch, chInstr[ch] | 0);
    }
}

/**
 * @param {HTMLSelectElement | null} select
 */
function pulseProRefreshMidiOutputSelect(select) {
    const el = select || document.getElementById('midi-output-select');
    if (!el) return;
    const prev = selectedOutputId || readStoredOutputId();
    el.innerHTML = '';
    const off = document.createElement('option');
    off.value = '';
    off.textContent = 'Off (built-in only)';
    el.appendChild(off);
    if (midiOutputMidiAccess) {
        const outs = Array.from(midiOutputMidiAccess.outputs.values());
        outs.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
        for (const p of outs) {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name && p.name.trim() ? p.name : p.id;
            el.appendChild(opt);
        }
    }
    el.value = midiOutputMidiAccess && midiOutputMidiAccess.outputs.has(prev) ? prev : '';
    if (el.value !== prev) {
        selectedOutputId = el.value;
        writeStoredOutputId(selectedOutputId);
    }
    bindCurrentPort();
}

/**
 * @param {string} id output port id or '' for off
 * @param {HTMLSelectElement | null} select
 */
function pulseProSetMidiOutputId(id, select) {
    selectedOutputId = id || '';
    writeStoredOutputId(selectedOutputId);
    bindCurrentPort();
    const el = select || document.getElementById('midi-output-select');
    if (el && el.value !== selectedOutputId) el.value = selectedOutputId;
}

window.pulseProEnsureMidiOutputAccess = pulseProEnsureMidiOutputAccess;
window.pulseProMidiOutIsActive = pulseProMidiOutIsActive;
window.pulseProMidiOutNoteOn = pulseProMidiOutNoteOn;
window.pulseProMidiOutNoteOff = pulseProMidiOutNoteOff;
window.pulseProMidiOutPitchWheel = pulseProMidiOutPitchWheel;
window.pulseProMidiOutControllerChange = pulseProMidiOutControllerChange;
window.pulseProMidiOutProgramChange = pulseProMidiOutProgramChange;
window.pulseProMidiOutAllNotesOff = pulseProMidiOutAllNotesOff;
window.pulseProMidiOutFullSilence = pulseProMidiOutFullSilence;
window.pulseProMidiOutAfterAutomationSeek = pulseProMidiOutAfterAutomationSeek;
window.pulseProMidiOutSendProgramsFromAudioEngine = pulseProMidiOutSendProgramsFromAudioEngine;
window.pulseProMidiOutSendProgramsFromArray = pulseProMidiOutSendProgramsFromArray;
window.pulseProRefreshMidiOutputSelect = pulseProRefreshMidiOutputSelect;
window.pulseProSetMidiOutputId = pulseProSetMidiOutputId;

// Restore selection from storage (port binds after Web MIDI access is granted)
selectedOutputId = readStoredOutputId();
