// audio.js - SoundFont-based audio engine using SpessaSynth

/** Registered parameter 0,0: pitch bend sensitivity in semitones (MIDI data entry coarse + fine/128). */
function semitonesToPitchBendRangeDataEntry(semitones) {
    const lo = typeof PITCH_BEND_SENSITIVITY_SEMITONES_MIN === 'number' ? PITCH_BEND_SENSITIVITY_SEMITONES_MIN : 0.01;
    const hi = typeof PITCH_BEND_SENSITIVITY_SEMITONES_MAX === 'number' ? PITCH_BEND_SENSITIVITY_SEMITONES_MAX : 96;
    let s = Number(semitones);
    if (!Number.isFinite(s)) s = 2;
    s = Math.max(lo, Math.min(hi, s));
    let coarse = Math.floor(s);
    let fine = Math.round((s - coarse) * 128);
    if (fine >= 128) {
        coarse += 1;
        fine -= 128;
    }
    if (fine < 0) fine = 0;
    coarse = Math.max(0, Math.min(127, coarse));
    fine = Math.max(0, Math.min(127, fine));
    return { coarse, fine };
}

class AudioEngine {
    constructor() {
        this.ctx = null;
        this.activeNotes = new Map(); // key -> true (for compatibility with interactions2.js)
        this.channelInstruments = new Array(16).fill(0);
        this.synth = null;          // SpessaSynth WorkletSynthesizer
        this.masterGain = null;   // routes synth → speakers (and optional MediaStreamDestination for export)
        this.ready = false;         // true once synth + soundfont are loaded
        this._initPromise = null;
        this._currentSoundFontId = null;
        this._loadedSoundFonts = new Map(); // id → ArrayBuffer (cached for switching)
        this._exportMediaDest = null;
    }

    async init() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = this._doInit();
        return this._initPromise;
    }

    async _doInit() {
        if (this.ctx) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();

        // Load the SpessaSynth worklet processor from CDN
        const processorURL = 'https://cdn.jsdelivr.net/npm/spessasynth_lib@4.2.2/dist/spessasynth_processor.min.js';
        await this.ctx.audioWorklet.addModule(processorURL);

        // Create the synthesizer (WorkletSynthesizer is set on window by the module loader)
        this.synth = new window.SpessaSynthWorkletSynthesizer(this.ctx);
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 1;
        this.synth.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);
    }

    /**
     * Adds a tap from the main mix into a MediaStreamDestination for MediaRecorder export.
     * @returns {MediaStream|null}
     */
    connectExportMediaDestination() {
        if (!this.masterGain || !this.ctx) return null;
        if (this._exportMediaDest) return this._exportMediaDest.stream;
        this._exportMediaDest = this.ctx.createMediaStreamDestination();
        this.masterGain.connect(this._exportMediaDest);
        return this._exportMediaDest.stream;
    }

    disconnectExportMediaDestination() {
        if (this._exportMediaDest && this.masterGain) {
            try {
                this.masterGain.disconnect(this._exportMediaDest);
            } catch (e) { /* already disconnected */ }
            this._exportMediaDest = null;
        }
    }

    // Load a SoundFont file by URL. Returns true if the font was applied, false on failure.
    async loadSoundFont(url, id) {
        await this.init();
        const indicator = document.getElementById('sf-loading-indicator');
        if (indicator) indicator.style.display = 'inline';

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`SoundFont HTTP ${response.status} for ${url}`);
            }
            const buffer = await response.arrayBuffer();
            await this._applySoundFontBuffer(buffer, id);
            return true;
        } catch (err) {
            console.error('Failed to load SoundFont:', err);
            return false;
        } finally {
            if (indicator) indicator.style.display = 'none';
        }
    }

    // Load a SoundFont from an ArrayBuffer directly (e.g. from File API). Returns true on success, false on failure.
    async loadSoundFontFromBuffer(buffer, id) {
        await this.init();
        const indicator = document.getElementById('sf-loading-indicator');
        if (indicator) indicator.style.display = 'inline';

        try {
            await this._applySoundFontBuffer(buffer, id);
            return true;
        } catch (err) {
            console.error('Failed to load SoundFont:', err);
            return false;
        } finally {
            if (indicator) indicator.style.display = 'none';
        }
    }

    async _applySoundFontBuffer(buffer, id) {
        // Cache a copy of the buffer — postMessage transfers the original, detaching it
        if (!this._loadedSoundFonts.has(id)) {
            this._loadedSoundFonts.set(id, buffer.slice(0));
        }

        // Remove the old soundfont and add the new one (send a fresh copy so the cache stays valid)
        const oldId = this._currentSoundFontId;
        await this.synth.soundBankManager.addSoundBank(buffer.slice(0), id);
        if (oldId && oldId !== id) {
            try { await this.synth.soundBankManager.deleteSoundBank(oldId); } catch(e) { /* ignore if already gone */ }
        }
        this._currentSoundFontId = id;
        await this.synth.isReady;
        this.ready = true;

        // Re-apply current instrument settings to all channels
        for (let ch = 0; ch < 16; ch++) {
            this.synth.programChange(ch, this.channelInstruments[ch]);
        }

        console.log(`SoundFont loaded: ${id}`);
    }

    // Switch to a previously loaded SoundFont by id (no re-read from disk needed)
    async switchSoundFont(id) {
        if (id === this._currentSoundFontId) return;
        const buffer = this._loadedSoundFonts.get(id);
        if (!buffer) {
            console.error('SoundFont not cached:', id);
            return;
        }
        await this._applySoundFontBuffer(buffer, id);
    }

    noteOn(note, channel = 0, velocity = 100) {
        if (!this.synth || !this.ready) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const key = `${channel}-${note}`;
        if (this.activeNotes.has(key)) {
            // Force-kill the previous voice instantly so the retrigger is audible
            this.synth.noteOff(channel, note, true);
        }
        this.synth.noteOn(channel, note, velocity);
        this.activeNotes.set(key, true);
    }

    noteOff(note, channel = 0) {
        if (!this.synth || !this.ready) return;
        const key = `${channel}-${note}`;
        if (this.activeNotes.has(key)) {
            this.synth.noteOff(channel, note);
            this.activeNotes.delete(key);
        }
    }

    allNotesOff() {
        if (!this.synth || !this.ready) return;
        // Send noteOff for all tracked active notes
        for (const [key] of this.activeNotes) {
            const parts = key.split('-');
            const ch = parseInt(parts[0]);
            const nt = parseInt(parts[1]);
            this.synth.noteOff(ch, nt);
        }
        this.activeNotes.clear();
    }

    setInstrument(channel, instrument) {
        this.channelInstruments[channel] = instrument;
        if (this.synth && this.ready) {
            this.synth.programChange(channel, instrument);
        }
    }

    pitchWheel(channel, value) {
        // value: 0-16383, 8192 = center (no bend)
        if (!this.synth || !this.ready) return;
        this.synth.pitchWheel(channel, value);
    }

    controllerChange(channel, controller, value) {
        if (!this.synth || !this.ready) return;
        this.synth.controllerChange(channel, controller, value);
    }

    /**
     * Set pitch wheel range (±semitones at full deflection) via RPN 0,0 and data entry.
     * @param {number} channel 0–15
     * @param {number} semitones positive range in semitones (e.g. 2 for ±2)
     */
    setPitchBendSensitivitySemitones(channel, semitones) {
        if (!this.synth || !this.ready) return;
        const ch = channel & 0x0f;
        const { coarse, fine } = semitonesToPitchBendRangeDataEntry(semitones);
        this.synth.controllerChange(ch, 101, 0);
        this.synth.controllerChange(ch, 100, 0);
        this.synth.controllerChange(ch, 6, coarse);
        this.synth.controllerChange(ch, 38, fine);
        this.synth.controllerChange(ch, 101, 127);
        this.synth.controllerChange(ch, 100, 127);
    }

    resetAllControllers() {
        if (!this.synth || !this.ready) return;
        for (let ch = 0; ch < 16; ch++) {
            this.synth.controllerChange(ch, 64, 0);    // sustain pedal off (must be before noteOff calls take effect)
            this.synth.pitchWheel(ch, 8192); // center pitch bend (14-bit center)
            this.synth.controllerChange(ch, 7, 100);  // volume default
            this.synth.controllerChange(ch, 10, 64);   // pan center
            this.synth.controllerChange(ch, 11, 127);  // expression default
            this.synth.controllerChange(ch, 1, automationCcDefaultMidi(1));
            this.synth.controllerChange(ch, 71, automationCcDefaultMidi(71));
            this.synth.controllerChange(ch, 72, automationCcDefaultMidi(72));
            this.synth.controllerChange(ch, 73, automationCcDefaultMidi(73));
            this.synth.controllerChange(ch, 74, automationCcDefaultMidi(74));
            this.synth.controllerChange(ch, 91, automationCcDefaultMidi(91));
            this.synth.controllerChange(ch, 93, automationCcDefaultMidi(93));
        }
    }

    // Play a short preview note
    preview(note, channel = 0, durationMs = 200) {
        this.noteOn(note, channel);
        setTimeout(() => this.noteOff(note, channel), durationMs);
    }
}

const audioEngine = new AudioEngine();

