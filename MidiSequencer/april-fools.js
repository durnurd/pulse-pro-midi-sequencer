// april-fools.js - Optional April 1 / ?fools=1 gags: falling notes, silly labels, tiered fake “PulsePro Plus/Pro/…” unlocks.
(function() {
    const FOOLS_LS_KEY = 'pulsepro-fools';
    /** MIDI note 60 — blocked in fools mode with a fake “Pro” upsell. */
    const MIDDLE_C_MIDI_NOTE = 60;
    const MAX_PARTICLES = 200;
    const GRAVITY_PX = 520;
    const FLOOR_FRICTION = 0.88;
    const ROT_DAMP = 0.92;
    /**
     * One silly fake name per GM program (0–127); display-only, deterministic, not shuffled GM list.
     */
    const FOOLS_SILLY_INSTRUMENT_NAMES = [
        'Grand Piano Full Of Bees',
        'Bright Piano But Judging You',
        'Electric Grand On Roller Skates',
        'Honky-Tonk Bucket',
        'Rhodes Made Of Jello',
        'Chorused Spoons',
        'Harpsi-chaos',
        'Clav In A Washing Machine',
        'Celeste Of Whispers',
        'Glockenspiel Of Regret',
        'Music Box Full Of Crickets',
        'Vibes But Wet',
        'Marimba Of Doom',
        'Xylo-phone Home',
        'Tubular Bells (Dentist Edition)',
        'Hamster Dulcimer',
        'Drawbar Organ (Evil)',
        'Percussive Organ (Angry)',
        'Rock Organ (Sleepy)',
        'Church Organ (Kazoo Stop)',
        'Reed Organ Made Of Cardboard',
        'Accordion Of Destiny',
        'Harmonica In A Wind Tunnel',
        'Bandoneon Of Sad Tango',
        'Nylon String Rubber Band',
        'Steel String Soup Can',
        'Jazz Guitar (Wrong Notes Only)',
        'Clean Guitar (Actually Mud)',
        'Muted Trumpet Shaped Guitar',
        'Overdriven Ukulele Army',
        'Distortion Pedal Only',
        'Guitar Harmonics From Space',
        'Acoustic Bass (Inflatable)',
        'Finger Bass (But Toes)',
        'Pick Bass Pickle Jar',
        'Fretless Bass Frets Found',
        'Slap Bass Slap Bracelet',
        'Slap Bass 2: The Slappening',
        'Synth Bass 1 (Beeps)',
        'Synth Bass 2 (Boops)',
        'Violin Screech Solo',
        'Viola Acceptance Speech',
        'Cello In An Elevator',
        'Contrabass As Doorstop',
        'Tremolo Strings (Shaky)',
        'Pizzicato Popcorn',
        'Orchestral Harp Fish Tank',
        'Timpani Surprise Party',
        'String Ensemble Lost',
        'String Ensemble 2: The Squeakquel',
        'Synth Strings 1 Duct Tape',
        'Synth Strings 2 Glitter',
        'Choir Aahs-Choo (Pepper Factory)',
        'Voice Oohs (Allergies)',
        'Synth Choir Of Meowing',
        'Orchestra Hit Pie Face',
        'Trumpet Duck Call',
        'Trombone Slide Greased',
        'Tuba Full Of Confetti',
        'Muted Trumpet In Pillow',
        'French Horn Spiral Staircase',
        'Brass Section Yawn',
        'Synth Brass 1 Lasers',
        'Synth Brass 2 Foghorn',
        'Soprano Sax Duck',
        'Alto Sax Honk',
        'Tenor Sax Wobble',
        'Baritone Sax Submarine',
        'Oboe Question Mark',
        'English Horn Tea Time',
        'Bassoon Party Blower',
        'Clarinet Squeaky Toy',
        'Piccolo Angry Bird',
        'Flute Panic',
        'Recorder Elementary School',
        'Pan Flute Wind Chime',
        'Bottle Blow Orchestra',
        'Shakuhachi Zen Wrong',
        'Whistle Tea Kettle',
        'Ocarina Of Time (Wrong Game)',
        'Lead 1 Square Sawtooth Soup',
        'Lead 2 Triangle Trouble',
        'Lead 3 Calliope Cat',
        'Lead 4 Chiff Chaff',
        'Lead 5 Charangarang',
        'Lead 6 Voice Lead (Shy)',
        'Lead 7 Fifths Fifth Element',
        'Lead 8 Bass & Lead Stew',
        'Pad 1 New Age Nachos',
        'Pad 2 Warm Wool Sweater',
        'Pad 3 Polysynth Polygraph',
        'Pad 4 Choir Of Crickets',
        'Pad 5 Bowed Metal Spork',
        'Pad 6 Metallic Jello',
        'Pad 7 Halo On A Budget',
        'Pad 8 Sweep The Floor',
        'FX 1 Rain On Synth',
        'FX 2 Soundtrack To Nothing',
        'FX 3 Crystal Ball Gag',
        'FX 4 Atmosphere (Tuna Can)',
        'FX 5 Brightness Knob Stuck',
        'FX 6 Goblin Parade',
        'FX 7 Echoes Of Lunch',
        'FX 8 Sci-Fi Doorbell',
        'Sitar Cat Tree',
        'Banjo Moonbounce',
        'Shamisen Speedrun',
        'Koto Made Of Pasta',
        'Kalimba Thumb Wars',
        'Bagpipe Stealth Mode',
        'Fiddle Stick Figure',
        'Shanai Surprise',
        'Tinkle Bell Door Chime',
        'Agogo Train Crossing',
        'Steel Drums Oil Barrel',
        'Woodblock Woodchuck',
        'Taiko Drum Heartbeat',
        'Melodic Tom Tomato',
        'Synth Drum Tin Can',
        'Reverse Cymbal Time Travel',
        'Guitar Fret Noise ASMR',
        'Breath Noise Windmill',
        'Seashore In A Shoebox',
        'Bird Tweet Autotune',
        'Telephone Ring Wagner',
        'Ceiling Fan',
        'Applause Sign Broken',
        'Gunshot Rubber Band',
    ];

    /** GM percussion map keys 27–87; silly display-only labels (matches GM_DRUM_NAMES in constants.js). */
    const FOOLS_SILLY_DRUM_NAMES = {
        27: 'Quantum Thump (Schrodinger)',
        28: 'Slapstick Orchestra Hit',
        29: 'Vinyl Scratch DJ Possum',
        30: 'Unscratch The Itch',
        31: 'Drumsticks Made Of Licorice',
        32: 'Square Clickbait Cymbal',
        33: 'Metronome With A Grudge',
        34: 'Metro Bell Pepper',
        35: 'Kick Drum Full Of Soup',
        36: 'Kick One: Electric Boogaloo',
        37: 'Side Stick Figure Drawing',
        38: 'Snare There, Done That',
        39: 'Single Clap Standing Ovation',
        40: 'Snare II: Return Of The Rim',
        41: 'Low Tom Before The Storm',
        42: 'Hi-Hat Closed Due To Weather',
        43: 'Low Tom And Jerry',
        44: 'Pedal Hat Metal Detector',
        45: 'Midlife Crisis Tom',
        46: 'Hi-Hat Wide Open Policy',
        47: 'Middle Child Tom',
        48: 'Hi Tom, How Is Your Aunt',
        49: 'Crash Course In Drama',
        50: 'Hi Tom Part Three The Movie',
        51: 'Ride Cymbal Carpool',
        52: 'Takeout Cymbal Extra Spicy',
        53: 'Ride Bell Curve',
        54: 'Tambourine Of Truth',
        55: 'Splash Cymbal Liability Waiver',
        56: 'Prescription Strength Cowbell',
        57: 'Crash Sequel (Worse Reviews)',
        58: 'Vibraslap Your Ethics',
        59: 'Ride Or Die II: Electric Ride',
        60: 'Bongo Unchained',
        61: 'Low Bongo Self-Esteem Workshop',
        62: 'Conga Muted On Zoom',
        63: 'Conga Line To The Void',
        64: 'Low Conga Floor Manager',
        65: 'Timbale High Stakes Poker',
        66: 'Timbale In The Basement',
        67: 'Agogo Gadget Arm',
        68: 'Low Agogo Slow-Motion Zone',
        69: 'Cabasa Driver Ed',
        70: 'Maracas Named Steve & Steve',
        71: 'Short Whistle Plot Twist',
        72: 'Long Whistle Director\'s Cut',
        73: 'Short Guiro Bedtime Story',
        74: 'Long Guiro Unabridged Audiobook',
        75: 'Claves To The Kingdom',
        76: 'Woodblock Who Asked',
        77: 'Low Woodblock Bottom Text',
        78: 'Cuica Library Voice',
        79: 'Cuica Stadium Announcer',
        80: 'Triangle Shh Professional',
        81: 'Triangle Free Speech',
        82: 'Pepper Shaker (Rhythm Section)',
        83: 'Jingle All The Overdraft Fees',
        84: 'Belltree Holiday Special Extended',
        85: 'Castanets Speed Chess',
        86: 'Surdo Stealth Mode',
        87: 'Surdo Honk If You Love Ska',
    };

    /** When h/w exceeds this, the note eases onto its side (π/2) while falling — matches tall vertical-roll notes. */
    const TIP_OVER_MIN_ASPECT = 1.2;
    const TIP_TORQUE = 6;
    const TIP_ANGULAR_DAMP_PER_S = 2.8;

    const knockedIds = new Set();
    let particles = [];
    let lastPhysicsWallMs = 0;

    /** Sequential tier label for the next upgrade (first = Plus, then Pro, …). */
    const FOOLS_TIER_NAMES = ['Plus', 'Pro', 'Pro Plus', 'Deluxe', 'Premier', 'Ultimate', 'Supreme'];
    let foolsUpgradeCount = 0;
    /** Which paywalled features are cleared this session (until page reload). */
    const foolsFeatureUnlocked = {
        middleC: false,
        blackKeys: false,
        verticalRoll: false,
        eraser: false,
        fileNew: false,
    };
    const FOOLS_FEATURE_COPY = {
        middleC: {
            title: 'The note everyone wants',
            subTemplate: function(tier) {
                return 'Upgrade to <strong>PulsePro ' + tier + '</strong> to compose on the most coveted pitch in Western music.';
            },
            bulletHtml: '<strong>Middle C</strong> — MIDI 60; center of the hype cycle',
            successSub: 'Middle C is unlocked. Go make radio hits (or lunch music).',
        },
        blackKeys: {
            title: 'Color outside the lines',
            subTemplate: function(tier) {
                return 'Upgrade to <strong>PulsePro ' + tier + '</strong> for access to the <em>other</em> keys — the dark ones.';
            },
            bulletHtml: '<strong>Black keys</strong> — C#, D#, F#, G#, A# (accidental royalty)',
            successSub: 'Black keys are yours. Sharps and flats just became legal tender.',
        },
        verticalRoll: {
            title: 'Rotate the universe',
            subTemplate: function(tier) {
                return 'Upgrade to <strong>PulsePro ' + tier + '</strong> to flip the piano roll vertical — time goes up, vibes go sideways.';
            },
            bulletHtml: '<strong>Vertical piano roll</strong> — for when horizontal is “too mainstream”',
            successSub: 'Vertical mode unlocked. May your scroll wheel find new purpose.',
        },
        eraser: {
            title: 'Erase with confidence',
            subTemplate: function(tier) {
                return 'Upgrade to <strong>PulsePro ' + tier + '</strong> and finally remove notes without pretending it was intentional.';
            },
            bulletHtml: '<strong>Note eraser tool</strong> — mistakes, meet your budget-friendly nemesis',
            successSub: 'Eraser unlocked. Use your new power for good (mostly).',
        },
        fileNew: {
            title: 'Start completely over',
            subTemplate: function(tier) {
                return 'Upgrade to <strong>PulsePro ' + tier + '</strong> for a pristine project — <strong>File ▸ New</strong> included.';
            },
            bulletHtml: '<strong>File ▸ New</strong> — blank slate energy, now with fewer metaphors',
            successSub: 'You can make new projects again. The old one forgives you (we checked).',
        },
    };

    /** @param {number} midiNote */
    function isMidiBlackKey(midiNote) {
        const k = ((((midiNote | 0) % 12) + 12) % 12);
        return k === 1 || k === 3 || k === 6 || k === 8 || k === 10;
    }

    function isFoolsModeEnabled() {
        try {
            const p = new URLSearchParams(window.location.search).get('fools');
            if (p === '1' || p === 'true' || p === 'yes') return true;
        } catch (e) { /* ignore */ }
        try {
            if (window.localStorage.getItem(FOOLS_LS_KEY) === '1') return true;
        } catch (e) { /* ignore */ }
        const d = new Date();
        return d.getMonth() === 3 && d.getDate() === 1;
    }

    function isFoolsFeatureUnlocked(key) {
        if (!isFoolsModeEnabled()) return true;
        return !!foolsFeatureUnlocked[key];
    }

    function unlockFoolsFeature(key) {
        if (foolsFeatureUnlocked.hasOwnProperty(key)) foolsFeatureUnlocked[key] = true;
    }

    let pendingFoolsUpgradeFeatureId = null;

    /**
     * True when Middle C should be blocked (April Fools on and not yet unlocked this session).
     * @param {number} midiNote 0–127
     */
    function shouldBlockMiddleC(midiNote) {
        if (!isFoolsModeEnabled() || isFoolsFeatureUnlocked('middleC')) return false;
        return (midiNote | 0) === MIDDLE_C_MIDI_NOTE;
    }

    function shouldBlockBlackKey(midiNote) {
        if (!isFoolsModeEnabled() || isFoolsFeatureUnlocked('blackKeys')) return false;
        return isMidiBlackKey(midiNote);
    }

    function shouldBlockVerticalRoll() {
        return isFoolsModeEnabled() && !isFoolsFeatureUnlocked('verticalRoll');
    }

    function shouldBlockEraser() {
        return isFoolsModeEnabled() && !isFoolsFeatureUnlocked('eraser');
    }

    function shouldBlockFileNew() {
        return isFoolsModeEnabled() && !isFoolsFeatureUnlocked('fileNew');
    }

    function updateFoolsSashForTier(tierLabel) {
        let sash = document.getElementById('fools-pro-mode-sash');
        if (!sash) {
            sash = document.createElement('div');
            sash.id = 'fools-pro-mode-sash';
            sash.className = 'fools-pro-mode-sash';
            sash.setAttribute('role', 'status');
            sash.setAttribute('aria-live', 'polite');
            sash.innerHTML =
                '<span class="fools-pro-mode-sash-inner">' +
                '<span class="fools-pro-mode-sash-title"></span>' +
                '</span>';
            document.body.appendChild(sash);
        }
        const upper = String(tierLabel).toUpperCase();
        sash.setAttribute('aria-label', tierLabel);
        const st = sash.querySelector('.fools-pro-mode-sash-title');
        if (st) st.textContent = upper;
        sash.classList.toggle('fools-pro-mode-sash-long', upper.indexOf(' ') >= 0 || upper.length > 7);
        sash.classList.add('fools-pro-mode-sash-visible');
    }

    let proDialogEscapeHandler = null;

    function resetProUpgradeDialogContent(el) {
        if (!el) return;
        pendingFoolsUpgradeFeatureId = null;
        const card = el.querySelector('.fools-pro-upgrade-card');
        if (card) card.classList.remove('fools-pro-upgrade-success-flash');
        const ribbon = el.querySelector('#fools-pro-upgrade-ribbon');
        if (ribbon) ribbon.textContent = 'LIMITED TIME';
        const title2 = el.querySelector('#fools-pro-upgrade-title');
        const sub2 = el.querySelector('#fools-pro-upgrade-sub') || el.querySelector('.fools-pro-upgrade-sub');
        const li = el.querySelector('#fools-pro-upgrade-feature-li');
        const feat = el.querySelector('.fools-pro-upgrade-features');
        const fine = el.querySelector('.fools-pro-upgrade-fine');
        const act = el.querySelector('.fools-pro-upgrade-actions');
        if (title2) title2.textContent = 'Unlock the full experience';
        if (sub2) sub2.innerHTML = '';
        if (li) li.innerHTML = '';
        if (feat) feat.style.display = '';
        if (fine) fine.style.display = '';
        if (act) act.style.display = '';
    }

    function closeProUpgradeDialog(overlay) {
        if (!overlay) return;
        resetProUpgradeDialogContent(overlay);
        overlay.classList.add('hidden');
        overlay.setAttribute('aria-hidden', 'true');
        if (proDialogEscapeHandler) {
            document.removeEventListener('keydown', proDialogEscapeHandler);
            proDialogEscapeHandler = null;
        }
    }

    function applyFoolsUpgradeDialogContent(el, featureKey) {
        const cfg = FOOLS_FEATURE_COPY[featureKey];
        if (!cfg) return;
        pendingFoolsUpgradeFeatureId = featureKey;
        const tierIdx = Math.min(foolsUpgradeCount, FOOLS_TIER_NAMES.length - 1);
        const tier = FOOLS_TIER_NAMES[tierIdx];
        const title = el.querySelector('#fools-pro-upgrade-title');
        if (title) title.textContent = cfg.title;
        const sub = el.querySelector('#fools-pro-upgrade-sub');
        if (sub) sub.innerHTML = cfg.subTemplate(tier);
        const li = el.querySelector('#fools-pro-upgrade-feature-li');
        if (li) li.innerHTML = '<span class="fools-pro-feature-check">✓</span> ' + cfg.bulletHtml;
    }

    function wireFoolsUpgradeDialog(el) {
        const cancel = el.querySelector('#fools-pro-upgrade-cancel');
        const cta = el.querySelector('#fools-pro-upgrade-cta');
        const backdrop = el.querySelector('.fools-pro-upgrade-backdrop');
        cancel.addEventListener('click', function() { closeProUpgradeDialog(el); });
        if (backdrop) backdrop.addEventListener('click', function() { closeProUpgradeDialog(el); });
        cta.addEventListener('click', function() {
            const key = pendingFoolsUpgradeFeatureId;
            const cfg = key && FOOLS_FEATURE_COPY[key];
            if (!cfg) {
                closeProUpgradeDialog(el);
                return;
            }
            const tierSold = FOOLS_TIER_NAMES[Math.min(foolsUpgradeCount, FOOLS_TIER_NAMES.length - 1)];
            unlockFoolsFeature(key);
            foolsUpgradeCount++;
            updateFoolsSashForTier(tierSold);
            const card = el.querySelector('.fools-pro-upgrade-card');
            if (card) {
                card.classList.add('fools-pro-upgrade-success-flash');
                const title = el.querySelector('#fools-pro-upgrade-title');
                const sub = el.querySelector('#fools-pro-upgrade-sub');
                const feat = el.querySelector('.fools-pro-upgrade-features');
                const fine = el.querySelector('.fools-pro-upgrade-fine');
                const act = el.querySelector('.fools-pro-upgrade-actions');
                if (title) title.textContent = 'You\'re in!';
                if (sub) sub.innerHTML = cfg.successSub + ' <span class="fools-pro-upgrade-heart">♥</span>';
                if (feat) feat.style.display = 'none';
                if (fine) fine.style.display = 'none';
                if (act) act.style.display = 'none';
            }
            pendingFoolsUpgradeFeatureId = null;
            window.setTimeout(function() { closeProUpgradeDialog(el); }, 1400);
        });
    }

    function showFoolsUpgradeDialog(featureKey) {
        if (!isFoolsModeEnabled()) return;
        if (!FOOLS_FEATURE_COPY[featureKey] || isFoolsFeatureUnlocked(featureKey)) return;
        let el = document.getElementById('fools-pro-upgrade-dialog');
        if (el && !el.querySelector('#fools-pro-upgrade-feature-li')) {
            el.remove();
            el = null;
        }
        if (el && !el.classList.contains('hidden')) return;
        if (!el) {
            el = document.createElement('div');
            el.id = 'fools-pro-upgrade-dialog';
            el.className = 'hidden';
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-modal', 'true');
            el.setAttribute('aria-labelledby', 'fools-pro-upgrade-title');
            el.innerHTML =
                '<div class="fools-pro-upgrade-backdrop" aria-hidden="true"></div>' +
                '<div class="fools-pro-upgrade-card">' +
                '<div class="fools-pro-upgrade-ribbon" id="fools-pro-upgrade-ribbon" aria-hidden="true">LIMITED TIME</div>' +
                '<div class="fools-pro-upgrade-hero" aria-hidden="true">' +
                '<span class="fools-pro-upgrade-hero-icon">🎹</span>' +
                '<span class="fools-pro-upgrade-hero-rays"></span>' +
                '</div>' +
                '<h2 id="fools-pro-upgrade-title" class="fools-pro-upgrade-title"></h2>' +
                '<p id="fools-pro-upgrade-sub" class="fools-pro-upgrade-sub"></p>' +
                '<ul class="fools-pro-upgrade-features" aria-label="This upgrade includes">' +
                '<li id="fools-pro-upgrade-feature-li"></li>' +
                '</ul>' +
                '<p class="fools-pro-upgrade-fine">* Limited time offer available through April 1st.</p>' +
                '<div class="fools-pro-upgrade-actions">' +
                '<button type="button" class="fools-pro-upgrade-btn fools-pro-upgrade-btn-secondary" id="fools-pro-upgrade-cancel">Cancel</button>' +
                '<button type="button" class="fools-pro-upgrade-btn fools-pro-upgrade-btn-cta" id="fools-pro-upgrade-cta">Upgrade Now</button>' +
                '</div>' +
                '</div>';
            document.body.appendChild(el);
            wireFoolsUpgradeDialog(el);
        }
        applyFoolsUpgradeDialogContent(el, featureKey);
        el.classList.remove('hidden');
        el.setAttribute('aria-hidden', 'false');
        if (proDialogEscapeHandler) document.removeEventListener('keydown', proDialogEscapeHandler);
        proDialogEscapeHandler = function(ev) {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                closeProUpgradeDialog(el);
            }
        };
        document.addEventListener('keydown', proDialogEscapeHandler);
        const ctaFocus = el.querySelector('#fools-pro-upgrade-cta');
        if (ctaFocus) window.setTimeout(function() { ctaFocus.focus(); }, 0);
    }

    function reset() {
        knockedIds.clear();
        particles = [];
        lastPhysicsWallMs = 0;
    }

    /**
     * Silly fake instrument name for display only (real program unchanged in state/audio).
     * @param {number} program 0–127
     * @returns {string|null} substitute name, or null if fools off
     */
    function instrumentDisplayName(program) {
        if (!isFoolsModeEnabled()) return null;
        const i = Math.max(0, Math.min(127, program | 0));
        return FOOLS_SILLY_INSTRUMENT_NAMES[i] || ('Mystery Instrument #' + i);
    }

    /**
     * Silly fake GM drum name for display only (real note unchanged).
     * @param {number} note MIDI note 0–127
     * @returns {string|null} substitute name when fools on and note is in GM map, else null
     */
    function drumDisplayName(note) {
        if (!isFoolsModeEnabled()) return null;
        const n = note | 0;
        const silly = FOOLS_SILLY_DRUM_NAMES[n];
        return silly != null ? silly : null;
    }

    /**
     * Tall particles (height > width) tip onto their side while falling.
     * @param {object} p particle with w, h, mutates tipOver, tipTargetRad, vr
     */
    function applyTipOverIfTall(p) {
        if (p.h <= p.w * TIP_OVER_MIN_ASPECT) return;
        p.tipOver = true;
        p.tipTargetRad = (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2);
        const kickSign = p.tipTargetRad > 0 ? 1 : -1;
        const kickMag = 0.45 + Math.random() * 1.15;
        p.vr = kickSign * kickMag + (Math.random() - 0.5) * 1.2;
        p.tipTorqueMul = 0.42 + Math.random() * 1.28;
        p.tipFallBoostMul = 0.35 + Math.random() * 1.65;
        p.tipDampMul = 0.55 + Math.random() * 0.95;
    }

    function spawnParticle(n) {
        const trk = state.tracks[n.track];
        const vx0 = (Math.random() - 0.5) * 140;
        const vy0 = -100 - Math.random() * 80;
        const vr0 = (Math.random() - 0.5) * 0.12;
        const base = {
            vx: vx0,
            vy: vy0,
            rot: 0,
            vr: vr0,
            color: getTrackColor(n.track),
            velocity: n.velocity ?? 100,
            isMuted: !!(trk && !isTrackAudible(n.track)),
            isLocked: !!(trk && trk.locked),
        };
        if (state.verticalPianoRoll) {
            const h = state.gridHeight;
            const seamY = h - 1;
            const pan = state.verticalTimePanPx;
            const pb = state.playbackTick;
            const xLeft = n.note * NOTE_HEIGHT - state.scrollX;
            const yBottom = seamY - (n.startTick - pb) * SNAP_WIDTH + pan;
            const yTop = seamY - (n.startTick + n.durationTicks - pb) * SNAP_WIDTH + pan;
            const nh = Math.max(4, yBottom - yTop);
            const nw = NOTE_HEIGHT;
            const vertP = Object.assign(base, {
                wx: xLeft,
                wy: yTop,
                w: nw,
                h: nh,
                canvasSpace: true,
            });
            applyTipOverIfTall(vertP);
            particles.push(vertP);
        } else {
            const row = TOTAL_MIDI_NOTES - 1 - n.note;
            const wx = n.startTick * SNAP_WIDTH;
            const wy = row * NOTE_HEIGHT;
            const nw = Math.max(6, n.durationTicks * SNAP_WIDTH);
            const horizP = Object.assign(base, {
                wx: wx,
                wy: wy,
                w: nw,
                h: NOTE_HEIGHT,
                canvasSpace: false,
            });
            applyTipOverIfTall(horizP);
            particles.push(horizP);
        }
        if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
    }

    /** Rotation center Y matches draw: top-left (wx, wy) + half size. */
    function particleCenterY(p) {
        return p.wy + p.h / 2;
    }

    /**
     * Half-extent of the axis-aligned box for a w×h rect rotated by p.rot about its center.
     * Using this for the floor fixes “bands” when notes tip — unrotated wy+h was wrong.
     */
    function particleAabbHalfHeight(p) {
        const c = Math.abs(Math.cos(p.rot));
        const s = Math.abs(Math.sin(p.rot));
        return 0.5 * (p.h * c + p.w * s);
    }

    function particleAabbHalfWidth(p) {
        const c = Math.abs(Math.cos(p.rot));
        const s = Math.abs(Math.sin(p.rot));
        return 0.5 * (p.w * c + p.h * s);
    }

    function particleAabbBottom(p) {
        return particleCenterY(p) + particleAabbHalfHeight(p);
    }

    function maybeSpawnOnTickCrossing(prevTick, currTick) {
        if (!isFoolsModeEnabled() || !state.isPlaying) return;
        if (prevTick == null || currTick <= prevTick) return;
        for (const n of state.notes) {
            if (knockedIds.has(n.id)) continue;
            const trk = state.tracks[n.track];
            if (trk && trk.hidden) continue;
            if (!isTrackAudible(n.track)) continue;
            if (n.startTick > prevTick && n.startTick <= currTick) {
                knockedIds.add(n.id);
                spawnParticle(n);
            }
        }
    }

    function stepPhysics(dt) {
        if (!isFoolsModeEnabled() || particles.length === 0 || dt <= 0) return;
        for (const p of particles) {
            p.vy += GRAVITY_PX * dt;
            p.wx += p.vx * dt;
            p.wy += p.vy * dt;
            if (p.tipOver && p.tipTargetRad != null) {
                const tq = p.tipTorqueMul != null ? p.tipTorqueMul : 1;
                const fb = p.tipFallBoostMul != null ? p.tipFallBoostMul : 1;
                const dm = p.tipDampMul != null ? p.tipDampMul : 1;
                let err = p.tipTargetRad - p.rot;
                while (err > Math.PI) err -= 2 * Math.PI;
                while (err < -Math.PI) err += 2 * Math.PI;
                p.vr += TIP_TORQUE * tq * Math.sin(err) * dt;
                const fallBoost = Math.min(2.2, Math.max(0, p.vy) / 220);
                if (Math.abs(err) > 0.04) p.vr += Math.sign(err) * fallBoost * fb * dt * 4;
                p.vr *= Math.exp(-TIP_ANGULAR_DAMP_PER_S * dm * dt);
                p.rot += p.vr * dt;
            } else {
                p.rot += p.vr * dt;
            }
            const floorBottomY = p.canvasSpace
                ? state.gridHeight
                : (state.scrollY + state.gridHeight);
            const bottom = particleAabbBottom(p);
            if (bottom >= floorBottomY) {
                const halfH = particleAabbHalfHeight(p);
                const cy = floorBottomY - halfH;
                p.wy = cy - p.h / 2;
                p.vy = 0;
                p.vx *= FLOOR_FRICTION;
                p.vr *= ROT_DAMP;
                if (p.tipOver && p.tipTargetRad != null) {
                    let err = p.tipTargetRad - p.rot;
                    while (err > Math.PI) err -= 2 * Math.PI;
                    while (err < -Math.PI) err += 2 * Math.PI;
                    p.rot += err * 0.22;
                    p.vr *= 0.72;
                    const halfH2 = particleAabbHalfHeight(p);
                    const cy2 = floorBottomY - halfH2;
                    p.wy = cy2 - p.h / 2;
                }
            }
        }
    }

    /**
     * @param {CanvasRenderingContext2D} gridCtx
     * @param {number} sx
     * @param {number} sy
     * @param {number} w
     * @param {number} h
     * @param {number} NOTE_RADIUS
     */
    function drawParticles(gridCtx, sx, sy, w, h, NOTE_RADIUS) {
        if (!isFoolsModeEnabled() || particles.length === 0) return;
        const t = getTheme();
        for (const p of particles) {
            const nx = p.canvasSpace ? p.wx : (p.wx - sx);
            const ny = p.canvasSpace ? p.wy : (p.wy - sy);
            const cx = nx + p.w / 2;
            const cy = ny + p.h / 2;
            const hW = particleAabbHalfWidth(p);
            const hH = particleAabbHalfHeight(p);
            if (cx + hW < 0 || cx - hW > w || cy + hH < 0 || cy - hH > h) continue;
            const vel = p.velocity;
            const velAlpha = 0.2 + 0.8 * (vel / 127);
            const baseAlpha = 0.85;
            const r = Math.max(0, Math.min(NOTE_RADIUS, (p.w - 2) / 2, (p.h - 2) / 2));
            gridCtx.save();
            gridCtx.translate(nx + p.w / 2, ny + p.h / 2);
            gridCtx.rotate(p.rot);
            const ox = -p.w / 2;
            const oy = -p.h / 2;
            if (p.isMuted) {
                gridCtx.globalAlpha = baseAlpha * velAlpha * 0.55;
                gridCtx.strokeStyle = p.color;
                gridCtx.lineWidth = 1.5;
                gridCtx.beginPath();
                gridCtx.roundRect(ox + 1.5, oy + 1.5, p.w - 3, p.h - 3, r);
                gridCtx.stroke();
            } else {
                gridCtx.fillStyle = p.color;
                gridCtx.globalAlpha = baseAlpha * velAlpha;
                gridCtx.beginPath();
                gridCtx.roundRect(ox + 1, oy + 1, p.w - 2, p.h - 2, r);
                gridCtx.fill();
            }
            if (p.isLocked && !p.isMuted) {
                gridCtx.beginPath();
                gridCtx.roundRect(ox + 1, oy + 1, p.w - 2, p.h - 2, r);
                gridCtx.clip();
                gridCtx.globalAlpha = 0.35;
                gridCtx.strokeStyle = t.gridBgWhiteKey;
                gridCtx.lineWidth = 1;
                const step = 5;
                for (let d = -p.h; d < p.w + p.h; d += step) {
                    gridCtx.beginPath();
                    gridCtx.moveTo(ox + 1 + d, oy + 1);
                    gridCtx.lineTo(ox + 1 + d + p.h, oy + 1 + p.h - 2);
                    gridCtx.stroke();
                }
            }
            gridCtx.restore();
            gridCtx.globalAlpha = 1;
        }
    }

    window.pulseProFoolsIsEnabled = isFoolsModeEnabled;
    window.pulseProFoolsShouldBlockMiddleC = shouldBlockMiddleC;
    window.pulseProFoolsShouldBlockBlackKey = shouldBlockBlackKey;
    window.pulseProFoolsShouldBlockVerticalRoll = shouldBlockVerticalRoll;
    window.pulseProFoolsShouldBlockEraser = shouldBlockEraser;
    window.pulseProFoolsShouldBlockFileNew = shouldBlockFileNew;
    window.pulseProFoolsShowUpgradeDialog = showFoolsUpgradeDialog;
    /** @deprecated Use pulseProFoolsShowUpgradeDialog('middleC') */
    window.pulseProFoolsShowProUpgradeDialog = function() { showFoolsUpgradeDialog('middleC'); };
    window.pulseProFoolsReset = reset;
    window.pulseProFoolsNoteIsKnocked = function(id) {
        return knockedIds.has(id);
    };
    window.pulseProFoolsInstrumentDisplayName = instrumentDisplayName;
    window.pulseProFoolsDrumDisplayName = drumDisplayName;

    /**
     * @param {number} prevTick playback tick at start of frame
     * @param {number} currTick after advance
     */
    window.pulseProFoolsOnPlaybackFrame = function(prevTick, currTick) {
        if (!isFoolsModeEnabled()) return;
        const now = performance.now();
        const dt = lastPhysicsWallMs > 0 ? (now - lastPhysicsWallMs) / 1000 : 1 / 60;
        lastPhysicsWallMs = now;
        maybeSpawnOnTickCrossing(prevTick, currTick);
        stepPhysics(dt);
    };

    window.pulseProFoolsOnRepeatRewind = function() {
        if (isFoolsModeEnabled()) reset();
    };

    window.pulseProFoolsDrawParticles = drawParticles;
})();

