// audio.js - SoundFont-based audio engine using SpessaSynth (worklet path, with worker fallback for older Chrome).
// Default SoundFont is fetched on load without creating AudioContext; the context is created on first user gesture
// (see _armDocumentUnlockOnce and init() from UI) to satisfy browser autoplay policy.
class AudioEngine {
    constructor() {
        this.ctx = null;
        this.activeNotes = new Map(); // key -> true (for compatibility with interactions2.js)
        this.channelInstruments = new Array(16).fill(0);
        this.synth = null;          // SpessaSynth WorkletSynthesizer or WorkerSynthesizer
        this.ready = false;         // true once synth + soundfont are loaded
        this._initPromise = null;
        this._currentSoundFontId = null;
        this._loadedSoundFonts = new Map(); // id → ArrayBuffer (cached for switching)
        this._spessaWorker = null;
        this._audioUnlockGo = null;
        this._stagedSoundFontId = null;
    }

    async init() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = this._doInit().catch((err) => {
            this._initPromise = null;
            throw err;
        });
        return this._initPromise;
    }

    _disarmDocumentUnlock() {
        if (this._audioUnlockGo) {
            document.removeEventListener('pointerdown', this._audioUnlockGo, true);
            document.removeEventListener('keydown', this._audioUnlockGo, true);
            this._audioUnlockGo = null;
        }
    }

    _armDocumentUnlockOnce() {
        if (this._audioUnlockGo || this.ctx) return;
        const go = () => {
            void this.init();
        };
        this._audioUnlockGo = go;
        document.addEventListener('pointerdown', go, true);
        document.addEventListener('keydown', go, true);
    }

    async _doInit() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
            throw new Error('Web Audio API is not available in this browser.');
        }
        if (!this.ctx) {
            this.ctx = new AC();
            if (this.ctx.state === 'suspended') {
                void this.ctx.resume();
            }
        }

        if (this.synth) {
            await this._flushStagedSoundFontIfAny();
            this._disarmDocumentUnlock();
            return;
        }

        const processorURL = 'https://cdn.jsdelivr.net/npm/spessasynth_lib@4.2.2/dist/spessasynth_processor.min.js';
        let workletOk = false;
        try {
            await this.ctx.audioWorklet.addModule(processorURL);
            workletOk = true;
        } catch (err) {
            console.warn('SpessaSynth worklet addModule failed:', err);
        }

        if (workletOk && window.SpessaSynthWorkletSynthesizer) {
            try {
                this.synth = new window.SpessaSynthWorkletSynthesizer(this.ctx);
            } catch (err) {
                console.warn('SpessaSynth WorkletSynthesizer constructor failed:', err);
                this.synth = null;
            }
        }

        if (!this.synth) {
            const deadline = Date.now() + 8000;
            let inst = window.__spessaWorkerSynthInstaller;
            while (
                (!inst || !inst.WorkerSynthesizer || !inst.workerModuleURL) &&
                Date.now() < deadline
            ) {
                await new Promise((r) => setTimeout(r, 40));
                inst = window.__spessaWorkerSynthInstaller;
            }
            if (!inst || !inst.WorkerSynthesizer || !inst.workerModuleURL) {
                throw new Error(
                    'Audio engine could not start (worklet failed and worker fallback is not configured).'
                );
            }
            await inst.WorkerSynthesizer.registerPlaybackWorklet(this.ctx);
            this._spessaWorker = new Worker(inst.workerModuleURL, { type: 'module' });
            this.synth = new inst.WorkerSynthesizer(
                this.ctx,
                this._spessaWorker.postMessage.bind(this._spessaWorker)
            );
            this._spessaWorker.onmessage = (e) => this.synth.handleWorkerMessage(e.data);
        }

        this.synth.connect(this.ctx.destination);
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
        await this._flushStagedSoundFontIfAny();
        this._disarmDocumentUnlock();
    }

    async _flushStagedSoundFontIfAny() {
        const id = this._stagedSoundFontId;
        if (id == null || !this.synth) return;
        this._stagedSoundFontId = null;
        const buf = this._loadedSoundFonts.get(id);
        if (!buf) return;
        await this._applySoundFontBuffer(buf, id);
    }

    // Load a SoundFont file by URL. Returns true if bytes are ready (synth applies after first audio unlock).
    async loadSoundFont(url, id) {
        const indicator = document.getElementById('sf-loading-indicator');
        if (indicator) indicator.style.display = 'inline';

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`SoundFont HTTP ${response.status} for ${url}`);
            }
            const buffer = await response.arrayBuffer();
            if (!this._loadedSoundFonts.has(id)) {
                this._loadedSoundFonts.set(id, buffer.slice(0));
            }
            if (!this.ctx) {
                this._stagedSoundFontId = id;
                this.ready = false;
                this._armDocumentUnlockOnce();
                return true;
            }
            await this.init();
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
        if (!this.ctx) {
            this._stagedSoundFontId = id;
            return;
        }
        await this._applySoundFontBuffer(buffer, id);
    }

    noteOn(note, channel = 0, velocity = 100) {
        if (!this.synth || !this.ready) {
            void (async () => {
                try {
                    await this.init();
                    await this._flushStagedSoundFontIfAny();
                    if (!this.synth || !this.ready) return;
                    this.noteOn(note, channel, velocity);
                } catch (e) {
                    console.error(e);
                }
            })();
            return;
        }
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

