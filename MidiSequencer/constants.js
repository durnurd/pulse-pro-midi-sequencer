// constants.js
let NOTE_HEIGHT = 16;
const NOTE_HEIGHT_DEFAULT = 16;
const NOTE_HEIGHT_MIN = 4;
const NOTE_HEIGHT_MAX = 48;
let BEAT_WIDTH = 48;
const BEAT_WIDTH_DEFAULT = 48;
const BEAT_WIDTH_MIN = 6;
const BEAT_WIDTH_MAX = 480;
const MIDI_TPQN = 480; // raw MIDI ticks per quarter note
/** RPN 0,0 pitch bend sensitivity (±semitones at full wheel); matches MIDI import limits. */
const PITCH_BEND_SENSITIVITY_SEMITONES_MIN = 0.01;
const PITCH_BEND_SENSITIVITY_SEMITONES_MAX = 96;
/** Note/automation snap interval in ticks; 1 when snap is off (see setSnapGridPower). */
let TICKS_PER_SNAP = Math.round(MIDI_TPQN / 4); // default 16th note
const SNAP_GRID_POWER_MIN = 0;
const SNAP_GRID_POWER_MAX = 5;
/** Sentinel: no quantize (raw tick); piano roll still draws a 16th-based visual grid. */
const SNAP_GRID_POWER_NONE = -1;

/**
 * Set note/automation snap to MIDI_TPQN / 2^power (quarter through 128th), or none (-1).
 * @param {number} power 0 = quarter … 5 = 128th, -1 = no snap (TICKS_PER_SNAP = 1)
 * @returns {number} power (including -1) after apply
 */
function setSnapGridPower(power) {
    if (power === SNAP_GRID_POWER_NONE) {
        TICKS_PER_SNAP = 1;
        return SNAP_GRID_POWER_NONE;
    }
    const p = Math.max(SNAP_GRID_POWER_MIN, Math.min(SNAP_GRID_POWER_MAX, power | 0));
    TICKS_PER_SNAP = Math.max(1, Math.round(MIDI_TPQN / Math.pow(2, p)));
    return p;
}
const SNAP_DIVISION = MIDI_TPQN; // ticks per beat (used by grid/measure math)
let SNAP_WIDTH = BEAT_WIDTH / MIDI_TPQN; // pixels per tick
const KEYBOARD_WIDTH = 120;
const PLAYBACK_HEADER_HEIGHT = 28;
/** Width of the time ruler when vertical piano roll is on (left strip, matches grid time axis). */
const VERTICAL_PLAYBACK_STRIP_WIDTH = 52;
const TOTAL_MIDI_NOTES = 128; // MIDI notes 0-127
let TOTAL_HEIGHT = TOTAL_MIDI_NOTES * NOTE_HEIGHT;

// Vertical zoom: adjusts NOTE_HEIGHT and keeps the view centered around the mouse position
function zoomVertical(delta, mouseYInGrid) {
    const oldNoteHeight = NOTE_HEIGHT;
    // Each scroll step changes height by ~10%
    const factor = delta < 0 ? 1.1 : 1 / 1.1;
    NOTE_HEIGHT = Math.max(NOTE_HEIGHT_MIN, Math.min(NOTE_HEIGHT_MAX, Math.round(NOTE_HEIGHT * factor)));
    if (NOTE_HEIGHT === oldNoteHeight) return;
    TOTAL_HEIGHT = TOTAL_MIDI_NOTES * NOTE_HEIGHT;
    if (state.verticalPianoRoll) {
        if (mouseYInGrid !== undefined) {
            const noteUnderMouse = (state.scrollX + mouseYInGrid) / oldNoteHeight;
            const maxPX = Math.max(0, TOTAL_MIDI_NOTES * NOTE_HEIGHT - state.gridWidth);
            state.scrollX = Math.max(0, Math.min(maxPX, noteUnderMouse * NOTE_HEIGHT - mouseYInGrid));
        } else {
            const centerNote = (state.scrollX + state.gridWidth / 2) / oldNoteHeight;
            const maxPX = Math.max(0, TOTAL_MIDI_NOTES * NOTE_HEIGHT - state.gridWidth);
            state.scrollX = Math.max(0, Math.min(maxPX, centerNote * NOTE_HEIGHT - state.gridWidth / 2));
        }
    } else {
        if (mouseYInGrid !== undefined) {
            const noteUnderMouse = (state.scrollY + mouseYInGrid) / oldNoteHeight;
            state.scrollY = Math.max(0, Math.min(TOTAL_HEIGHT - state.gridHeight,
                noteUnderMouse * NOTE_HEIGHT - mouseYInGrid));
        } else {
            const centerNote = (state.scrollY + state.gridHeight / 2) / oldNoteHeight;
            state.scrollY = Math.max(0, Math.min(TOTAL_HEIGHT - state.gridHeight,
                centerNote * NOTE_HEIGHT - state.gridHeight / 2));
        }
    }
    renderAll();
}
// Horizontal zoom: adjusts BEAT_WIDTH and keeps the view centered around the mouse position
function zoomHorizontal(delta, mouseXInGrid) {
    const oldBeatWidth = BEAT_WIDTH;
    const factor = delta < 0 ? 1.1 : 1 / 1.1;
    BEAT_WIDTH = Math.max(BEAT_WIDTH_MIN, Math.min(BEAT_WIDTH_MAX, BEAT_WIDTH * factor));
    if (BEAT_WIDTH === oldBeatWidth) return;
    SNAP_WIDTH = BEAT_WIDTH / MIDI_TPQN;
    if (state.verticalPianoRoll) {
        const h = state.gridHeight;
        const seamY = h - 1;
        const pan = state.verticalTimePanPx;
        const pb = state.playbackTick;
        const oldSW = oldBeatWidth / MIDI_TPQN;
        const ly = mouseXInGrid !== undefined ? mouseXInGrid : h / 2;
        const tickUnderMouse = pb + (seamY - ly + pan) / oldSW;
        state.verticalTimePanPx = 0;
        let newPb = tickUnderMouse - (seamY - ly) / SNAP_WIDTH;
        newPb = snapTickToGrid(Math.round(newPb));
        if (typeof window.seekPlaybackToTick === 'function') {
            window.seekPlaybackToTick(Math.max(0, newPb));
        } else {
            state.playbackTick = Math.max(0, newPb);
            state.playbackStartTick = state.playbackTick;
        }
        const maxHS = Math.max(0, typeof getMaxScrollX === 'function' ? getMaxScrollX() : 0);
        state.timelineHeaderScrollPx = Math.max(0, Math.min(maxHS, state.timelineHeaderScrollPx));
    } else {
        if (mouseXInGrid !== undefined) {
            const tickUnderMouse = (state.scrollX + mouseXInGrid) / (oldBeatWidth / MIDI_TPQN);
            state.scrollX = Math.max(0, tickUnderMouse * SNAP_WIDTH - mouseXInGrid);
        } else {
            const centerTick = (state.scrollX + state.gridWidth / 2) / (oldBeatWidth / MIDI_TPQN);
            state.scrollX = Math.max(0, centerTick * SNAP_WIDTH - state.gridWidth / 2);
        }
    }
    renderAll();
}
const EDGE_THRESHOLD = 6; // pixels from edge to trigger resize

/** Default MIDI CC values (0–127) for automation overlay / engine reset (GM-style). */
const AUTOMATION_CC_DEFAULT_MIDI = {
    1: 0,       // Modulation
    7: 100,     // Channel volume
    10: 64,     // Pan (center)
    11: 127,    // Expression (full)
    64: 0,      // Sustain pedal (off)
    71: 64,     // Timbre / resonance (neutral)
    72: 64,     // Release time (neutral)
    73: 64,     // Attack time (neutral)
    74: 127,    // Brightness / cutoff (wide open)
    91: 0,      // Reverb send (off)
    93: 0,      // Chorus send (off)
};

/** Default MIDI value for a CC when drawing automation or after reset; 64 if unknown. */
function automationCcDefaultMidi(cc) {
    const v = AUTOMATION_CC_DEFAULT_MIDI[cc];
    return v !== undefined ? v : 64;
}

/** Normalized 0–1 default for the active automation overlay (pitch bend center ≈ 0.5). */
function automationOverlayDefaultNorm(overlay) {
    if (overlay === null || overlay === undefined) return 0.5;
    if (overlay === 'pitchBend') return 8192 / 16383;
    return automationCcDefaultMidi(overlay) / 127;
}

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const BLACK_KEYS = new Set([1,3,6,8,10]); // semitone indices that are black keys

// Track color palette — assigned dynamically to tracks that have notes
const TRACK_COLORS = [
    '#e94560','#0ea5e9','#22c55e','#f59e0b',
    '#a855f7','#ec4899','#14b8a6','#f97316',
    '#6366f1','#84cc16','#06b6d4','#ef4444',
    '#8b5cf6','#10b981','#f43f5e','#eab308',
    '#fb923c','#38bdf8','#4ade80','#facc15',
    '#c084fc','#f472b6','#2dd4bf','#a3e635',
    '#818cf8','#34d399','#fbbf24','#f87171',
    '#a78bfa','#67e8f9','#86efac','#fcd34d'
];
// Legacy alias for compatibility
const CHANNEL_COLORS = TRACK_COLORS;

// General MIDI instrument names (first 128)
const GM_INSTRUMENTS = [
    'Acoustic Grand Piano','Bright Acoustic Piano','Electric Grand Piano','Honky-tonk Piano',
    'Electric Piano 1','Electric Piano 2','Harpsichord','Clavinet',
    'Celesta','Glockenspiel','Music Box','Vibraphone',
    'Marimba','Xylophone','Tubular Bells','Dulcimer',
    'Drawbar Organ','Percussive Organ','Rock Organ','Church Organ',
    'Reed Organ','Accordion','Harmonica','Tango Accordion',
    'Acoustic Guitar (nylon)','Acoustic Guitar (steel)','Electric Guitar (jazz)','Electric Guitar (clean)',
    'Electric Guitar (muted)','Overdriven Guitar','Distortion Guitar','Guitar Harmonics',
    'Acoustic Bass','Electric Bass (finger)','Electric Bass (pick)','Fretless Bass',
    'Slap Bass 1','Slap Bass 2','Synth Bass 1','Synth Bass 2',
    'Violin','Viola','Cello','Contrabass',
    'Tremolo Strings','Pizzicato Strings','Orchestral Harp','Timpani',
    'String Ensemble 1','String Ensemble 2','Synth Strings 1','Synth Strings 2',
    'Choir Aahs','Voice Oohs','Synth Choir','Orchestra Hit',
    'Trumpet','Trombone','Tuba','Muted Trumpet',
    'French Horn','Brass Section','Synth Brass 1','Synth Brass 2',
    'Soprano Sax','Alto Sax','Tenor Sax','Baritone Sax',
    'Oboe','English Horn','Bassoon','Clarinet',
    'Piccolo','Flute','Recorder','Pan Flute',
    'Blown Bottle','Shakuhachi','Whistle','Ocarina',
    'Lead 1 (square)','Lead 2 (sawtooth)','Lead 3 (calliope)','Lead 4 (chiff)',
    'Lead 5 (charang)','Lead 6 (voice)','Lead 7 (fifths)','Lead 8 (bass + lead)',
    'Pad 1 (new age)','Pad 2 (warm)','Pad 3 (polysynth)','Pad 4 (choir)',
    'Pad 5 (bowed)','Pad 6 (metallic)','Pad 7 (halo)','Pad 8 (sweep)',
    'FX 1 (rain)','FX 2 (soundtrack)','FX 3 (crystal)','FX 4 (atmosphere)',
    'FX 5 (brightness)','FX 6 (goblins)','FX 7 (echoes)','FX 8 (sci-fi)',
    'Sitar','Banjo','Shamisen','Koto',
    'Kalimba','Bagpipe','Fiddle','Shanai',
    'Tinkle Bell','Agogo','Steel Drums','Woodblock',
    'Taiko Drum','Melodic Tom','Synth Drum','Reverse Cymbal',
    'Guitar Fret Noise','Breath Noise','Seashore','Bird Tweet',
    'Telephone Ring','Helicopter','Applause','Gunshot'
];

// General MIDI Percussion map (channel 10 / MIDI channel 9)
// Keys 27–87 per GM spec; notes outside this range have no standard name
const GM_DRUM_NAMES = {
    27: 'High Q', 28: 'Slap', 29: 'Scratch Push', 30: 'Scratch Pull', 31: 'Sticks',
    32: 'Square Click', 33: 'Metro Click', 34: 'Metro Bell',
    35: 'Kick 2', 36: 'Kick 1', 37: 'Side Stick', 38: 'Snare 1', 39: 'Hand Clap',
    40: 'Snare 2', 41: 'Low Tom 2', 42: 'Closed HH', 43: 'Low Tom 1',
    44: 'Pedal HH', 45: 'Mid Tom 2', 46: 'Open HH', 47: 'Mid Tom 1',
    48: 'Hi Tom 2', 49: 'Crash 1', 50: 'Hi Tom 1', 51: 'Ride 1',
    52: 'Chinese Cym', 53: 'Ride Bell', 54: 'Tambourine', 55: 'Splash Cym',
    56: 'Cowbell', 57: 'Crash 2', 58: 'Vibraslap', 59: 'Ride 2',
    60: 'Hi Bongo', 61: 'Low Bongo', 62: 'Mute Conga', 63: 'Open Conga',
    64: 'Low Conga', 65: 'Hi Timbale', 66: 'Low Timbale', 67: 'Hi Agogo',
    68: 'Low Agogo', 69: 'Cabasa', 70: 'Maracas', 71: 'Short Whistle',
    72: 'Long Whistle', 73: 'Short Guiro', 74: 'Long Guiro', 75: 'Claves',
    76: 'Hi Woodblk', 77: 'Low Woodblk', 78: 'Mute Cuica', 79: 'Open Cuica',
    80: 'Mute Tri', 81: 'Open Tri', 82: 'Shaker', 83: 'Jingle Bell',
    84: 'Belltree', 85: 'Castanets', 86: 'Mute Surdo', 87: 'Open Surdo',
};

// Get note name for a MIDI note number (0=C-1, 127=G9)
// If isDrum is true, returns the GM drum name instead
function midiNoteName(note, isDrum) {
    if (isDrum && GM_DRUM_NAMES[note]) return GM_DRUM_NAMES[note];
    const octave = Math.floor(note / 12) - 1;
    return NOTE_NAMES[note % 12] + octave;
}

/**
 * Label for piano roll / keys (April Fools may replace GM drum names via window.pulseProFoolsDrumDisplayName).
 */
function displayMidiNoteName(note, isDrum) {
    if (isDrum && typeof window !== 'undefined' && typeof window.pulseProFoolsDrumDisplayName === 'function') {
        const silly = window.pulseProFoolsDrumDisplayName(note);
        if (silly != null && silly !== '') return silly;
    }
    return midiNoteName(note, isDrum);
}

// Is this a black key?
function isBlackKey(note) {
    return BLACK_KEYS.has(note % 12);
}

// --- Theme system ---
const THEMES = {
    dark: {
        // Grid
        gridBgWhiteKey: '#1a1a2e',
        gridBgBlackKey: '#141428',
        gridRowBorder: '#222244',
        gridBarLine: '#444488',
        gridBeatLine: '#333366',
        gridSubLine: '#222244',
        // Notes
        noteSelectionStroke: '#ffffff',
        velocityText: '#ffffff',
        // Selection rect
        selectionStroke: '#ffffff',
        selectionFill: 'rgba(255,255,255,0.05)',
        // Playback line
        playbackLine: '#e94560',
        // Keyboard
        keyWhite: '#ddd',
        keyBlack: '#222',
        keyHighlight: '#e94560',
        keyBorder: '#555',
        keyLabelWhite: '#333',
        keyLabelBlack: '#aaa',
        keyLabelHighlight: '#fff',
        // Playback header
        pbText: '#888',
        pbBarLine: '#444',
        pbBeatLine: '#333',
        pbHandle: '#e94560',
        keyLockRowOverlay: 'rgba(72, 52, 118, 0.78)',
        keyLockRowHatch: 'rgba(255, 255, 255, 0.14)',
    },
    light: {
        // Grid
        gridBgWhiteKey: '#e8e8f0',
        gridBgBlackKey: '#d0d0de',
        gridRowBorder: '#b8b8cc',
        gridBarLine: '#8888aa',
        gridBeatLine: '#a0a0bb',
        gridSubLine: '#c8c8dd',
        // Notes
        noteSelectionStroke: '#333333',
        velocityText: '#333333',
        // Selection rect
        selectionStroke: '#333333',
        selectionFill: 'rgba(0,0,0,0.08)',
        // Playback line
        playbackLine: '#d6304a',
        // Keyboard
        keyWhite: '#f5f5f5',
        keyBlack: '#444',
        keyHighlight: '#d6304a',
        keyBorder: '#999',
        keyLabelWhite: '#333',
        keyLabelBlack: '#ccc',
        keyLabelHighlight: '#fff',
        // Playback header
        pbText: '#555',
        pbBarLine: '#999',
        pbBeatLine: '#bbb',
        pbHandle: '#d6304a',
        keyLockRowOverlay: 'rgba(165, 145, 210, 0.88)',
        keyLockRowHatch: 'rgba(55, 40, 95, 0.28)',
    }
};

let currentTheme = localStorage.getItem('pulsepro-theme') || 'dark';
function getTheme() { return THEMES[currentTheme]; }

function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('pulsepro-theme', currentTheme);

    const applyTheme = () => {
        document.documentElement.setAttribute('data-theme', currentTheme);
        renderAll();
    };

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || typeof document.startViewTransition !== 'function') {
        applyTheme();
        return;
    }

    document.startViewTransition(applyTheme);
}

