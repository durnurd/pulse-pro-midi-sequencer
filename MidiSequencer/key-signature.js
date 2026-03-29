// key-signature.js - Diatonic scale helpers for optional pitch lock (major / natural minor)

/**
 * @param {number} root MIDI pitch class 0–11 (C=0)
 * @param {'major'|'minor'} mode
 * @returns {Set<number>} pitch classes 0–11 in the scale
 */
function keySignaturePitchClasses(root, mode) {
    const r = ((root % 12) + 12) % 12;
    const major = [0, 2, 4, 5, 7, 9, 11];
    const minorNat = [0, 2, 3, 5, 7, 8, 10];
    const intervals = mode === 'minor' ? minorNat : major;
    const set = new Set();
    for (let i = 0; i < intervals.length; i++) {
        set.add((r + intervals[i]) % 12);
    }
    return set;
}

/**
 * @param {null | { root: number, mode: string }} ks
 * @returns {boolean}
 */
function isKeySignatureActive(ks) {
    return !!(ks && typeof ks.root === 'number' && (ks.mode === 'major' || ks.mode === 'minor'));
}

/**
 * @param {number} note MIDI note 0–127
 * @param {null | { root: number, mode: string }} ks
 * @returns {boolean}
 */
function midiNoteInKeySignature(note, ks) {
    if (!isKeySignatureActive(ks)) return true;
    const pc = ((note % 12) + 12) % 12;
    return keySignaturePitchClasses(ks.root, ks.mode).has(pc);
}

/**
 * Nearest MIDI note in range 0–127 whose pitch class is in the key; prefers lower note on ties.
 * @param {number} note
 * @param {null | { root: number, mode: string }} ks
 * @returns {number}
 */
function snapMidiNoteToKey(note, ks) {
    let nn = Math.max(0, Math.min(127, Math.round(note)));
    if (!isKeySignatureActive(ks)) return nn;
    if (midiNoteInKeySignature(nn, ks)) return nn;
    for (let d = 1; d <= 127; d++) {
        const down = nn - d;
        const up = nn + d;
        if (down >= 0 && midiNoteInKeySignature(down, ks)) return down;
        if (up <= 127 && midiNoteInKeySignature(up, ks)) return up;
    }
    return nn;
}

/**
 * If scale lock is on and Shift is not held, return null when the pitch is not in-key (block placement).
 * @param {number} midiNote
 * @param {boolean} shiftHeld
 * @param {null | { root: number, mode: string }} ks
 * @returns {number | null}
 */
function keyLockPlacementPitchOrNull(midiNote, shiftHeld, ks) {
    if (!isKeySignatureActive(ks) || shiftHeld) return midiNote;
    return midiNoteInKeySignature(midiNote, ks) ? midiNote : null;
}

/**
 * On-screen piano keyboard preview: allow only in-key pitches unless Shift is held (same as grid placement).
 * @param {number} midiNote
 * @param {boolean} shiftHeld
 * @param {null | { root: number, mode: string }} ks
 * @returns {boolean}
 */
function keyLockAllowsKeyboardPitch(midiNote, shiftHeld, ks) {
    if (!isKeySignatureActive(ks)) return true;
    if (shiftHeld) return true;
    return midiNoteInKeySignature(midiNote, ks);
}
