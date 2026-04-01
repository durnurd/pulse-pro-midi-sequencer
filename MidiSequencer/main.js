// main.js - Initialization
(function() {
    const KEY_SIGNATURE_STORAGE_KEY = 'pulsepro-key-signature';

    /** Remove focus from a control so Space triggers transport instead of re-activating the widget. */
    function blurIfActive(el) {
        if (el && document.activeElement === el) el.blur();
    }

    // --- Track List (dynamic) ---
    const chRows = document.getElementById('channel-list-rows');
    const conductorStripEl = document.getElementById('channel-list-conductor');
    let _conductorStripSig = '';

    function updateKeyboardHeaderTrack() {
        const dot = document.getElementById('kbd-header-track-dot');
        const nameEl = document.getElementById('kbd-header-track-name');
        if (!dot || !nameEl) return;
        const ti = state.activeTrack;
        const trk = state.tracks[ti];
        dot.style.background = getTrackColor(ti);
        nameEl.textContent = trk ? trk.name : '';
    }
    window.updateKeyboardHeaderTrack = updateKeyboardHeaderTrack;

    /** Lowercase text for matching: program number + instrument name (fools mode may substitute display name). */
    function instrumentSearchText(program) {
        let name = GM_INSTRUMENTS[program];
        if (typeof window.pulseProFoolsInstrumentDisplayName === 'function') {
            const alt = window.pulseProFoolsInstrumentDisplayName(program);
            if (alt) name = alt;
        }
        return (program + ': ' + name).toLowerCase();
    }

    /** True if every character of query appears in haystack in order (subsequence). */
    function isSubsequenceMatch(queryLower, haystackLower) {
        if (queryLower.length === 0) return true;
        let j = 0;
        for (let i = 0; i < haystackLower.length && j < queryLower.length; i++) {
            if (haystackLower.charCodeAt(i) === queryLower.charCodeAt(j)) j++;
        }
        return j === queryLower.length;
    }

    function formatInstrumentLabel(program) {
        return program + ': ' + GM_INSTRUMENTS[program];
    }

    /** Channel list / picker label; may show April Fools substitute name while state keeps true program. */
    function displayInstrumentLabel(program) {
        let name = GM_INSTRUMENTS[program];
        if (typeof window.pulseProFoolsInstrumentDisplayName === 'function') {
            const alt = window.pulseProFoolsInstrumentDisplayName(program);
            if (alt) name = alt;
        }
        return program + ': ' + name;
    }

    const instrumentComboOpenState = { close: null };

    function closeInstrumentComboIfOpen() {
        if (instrumentComboOpenState.close) {
            instrumentComboOpenState.close();
            instrumentComboOpenState.close = null;
        }
    }

    /**
     * Searchable instrument picker (subsequence filter on name + program prefix).
     * @param {number} initialProgram
     * @param {(program: number) => void} onPick
     */
    function createInstrumentSearchCombo(initialProgram, onPick) {
        const wrap = document.createElement('div');
        wrap.className = 'ch-col ch-instr-col ch-instr-combo';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ch-instr-trigger';
        trigger.title = 'Instrument — type to search when open';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.textContent = displayInstrumentLabel(initialProgram);

        const popover = document.createElement('div');
        popover.className = 'ch-instr-popover';
        popover.hidden = true;
        popover.setAttribute('role', 'presentation');

        const filterInput = document.createElement('input');
        filterInput.type = 'text';
        filterInput.className = 'ch-instr-filter';
        filterInput.placeholder = 'Search instruments…';
        filterInput.setAttribute('autocomplete', 'off');
        filterInput.setAttribute('spellcheck', 'false');

        const optionsEl = document.createElement('div');
        optionsEl.className = 'ch-instr-options';
        optionsEl.setAttribute('role', 'listbox');

        popover.appendChild(filterInput);
        popover.appendChild(optionsEl);
        wrap.appendChild(trigger);
        wrap.appendChild(popover);

        let highlightedListIndex = 0;

        function positionPopover() {
            const r = trigger.getBoundingClientRect();
            const w = Math.max(r.width, 240);
            popover.style.left = Math.min(r.left, window.innerWidth - w - 8) + 'px';
            popover.style.top = (r.bottom + 2) + 'px';
            popover.style.width = w + 'px';
        }

        function getFilteredPrograms() {
            const q = filterInput.value.trim().toLowerCase();
            const out = [];
            for (let i = 0; i < GM_INSTRUMENTS.length; i++) {
                if (isSubsequenceMatch(q, instrumentSearchText(i))) out.push(i);
            }
            return out;
        }

        function scrollHighlightedIntoView() {
            const active = optionsEl.querySelector('.ch-instr-option-active');
            if (active) active.scrollIntoView({ block: 'nearest' });
        }

        function setHighlight(listIndex, programs) {
            const opts = optionsEl.querySelectorAll('.ch-instr-option');
            if (programs.length === 0) return;
            highlightedListIndex = Math.max(0, Math.min(listIndex, programs.length - 1));
            opts.forEach((el, i) => {
                el.classList.toggle('ch-instr-option-active', i === highlightedListIndex);
            });
            scrollHighlightedIntoView();
        }

        function rebuildOptions() {
            const programs = getFilteredPrograms();
            optionsEl.innerHTML = '';
            highlightedListIndex = 0;
            if (programs.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'ch-instr-option-empty';
                empty.textContent = 'No instruments match';
                optionsEl.appendChild(empty);
                return;
            }
            programs.forEach((program, listIdx) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'ch-instr-option';
                if (listIdx === 0) btn.classList.add('ch-instr-option-active');
                btn.setAttribute('role', 'option');
                btn.dataset.program = String(program);
                btn.textContent = displayInstrumentLabel(program);
                btn.addEventListener('mousedown', function(e) {
                    e.preventDefault();
                });
                btn.addEventListener('click', function() {
                    applyProgram(program);
                });
                optionsEl.appendChild(btn);
            });
        }

        function applyProgram(program) {
            closePopover();
            trigger.textContent = displayInstrumentLabel(program);
            onPick(program);
            trigger.blur();
        }

        function closePopover() {
            popover.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
            if (instrumentComboOpenState.close === closePopover) {
                instrumentComboOpenState.close = null;
            }
        }

        function openPopover() {
            closeInstrumentComboIfOpen();
            popover.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
            positionPopover();
            filterInput.value = '';
            rebuildOptions();
            filterInput.focus();
            instrumentComboOpenState.close = closePopover;
        }

        wrap.syncInstrument = function(program) {
            trigger.textContent = displayInstrumentLabel(program);
        };

        wrap.addEventListener('focusout', function() {
            requestAnimationFrame(function() {
                if (popover.hidden) return;
                const ae = document.activeElement;
                if (ae && wrap.contains(ae)) return;
                closeInstrumentComboIfOpen();
            });
        });

        trigger.addEventListener('click', function(e) {
            e.stopPropagation();
            if (!popover.hidden) {
                closeInstrumentComboIfOpen();
                return;
            }
            openPopover();
        });

        filterInput.addEventListener('input', function() {
            rebuildOptions();
        });

        filterInput.addEventListener('keydown', function(e) {
            const programs = getFilteredPrograms();
            if (e.key === 'Escape') {
                e.preventDefault();
                closeInstrumentComboIfOpen();
                trigger.focus();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (programs.length === 0) return;
                setHighlight(highlightedListIndex + 1, programs);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (programs.length === 0) return;
                setHighlight(highlightedListIndex - 1, programs);
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                if (programs.length === 0) return;
                const prog = programs[highlightedListIndex];
                applyProgram(prog);
            }
        });

        return wrap;
    }

    document.addEventListener('mousedown', function(e) {
        if (e.target.closest && e.target.closest('.ch-instr-combo')) return;
        closeInstrumentComboIfOpen();
    }, true);

    window.addEventListener('resize', closeInstrumentComboIfOpen);
    chRows.addEventListener('scroll', closeInstrumentComboIfOpen, { passive: true });

    /** Builds the conductor strip (above the channel list header). */
    function buildConductorStripInner() {
        const inner = document.createElement('div');
        inner.className = 'channel-list-conductor-inner';

        const title = document.createElement('span');
        title.className = 'ch-conductor-strip-title';
        title.textContent = 'Conductor';
        inner.appendChild(title);

        const ctrls = document.createElement('div');
        ctrls.className = 'ch-conductor-controls';

        function addLabeledCheckbox(labelText, checked, titleAttr, onChange) {
            const lab = document.createElement('label');
            lab.title = titleAttr;
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = checked;
            cb.addEventListener('change', function() {
                onChange(cb.checked);
                blurIfActive(cb);
            });
            lab.appendChild(cb);
            lab.appendChild(document.createTextNode(labelText));
            ctrls.appendChild(lab);
        }

        addLabeledCheckbox('Lock', state.conductor.locked, 'Lock conductor map and insert', function(v) {
            state.conductor.locked = v;
            if (v) {
                state.conductorPlacementMode = null;
                state.conductorPlacementHoverTick = null;
                if (typeof window.cancelConductorInsertUi === 'function') window.cancelConductorInsertUi();
                if (typeof window.cancelConductorHeaderInteraction === 'function') window.cancelConductorHeaderInteraction();
            }
            if (window.updateChannelListUI) window.updateChannelListUI();
            renderAll();
        });

        const btnClear = document.createElement('button');
        btnClear.type = 'button';
        btnClear.className = 'ch-conductor-btn';
        btnClear.textContent = 'Clear all';
        btnClear.title = 'Remove all tempo and time signature changes';
        btnClear.addEventListener('click', function() {
            if (state.conductor.locked) return;
            if (!conductorTrackVisible()) return;
            if (!confirm('Remove all conductor tempo and time signature changes?')) return;
            pushUndoState('clear conductor changes');
            state.tempoChanges = [];
            state.timeSigChanges = [];
            if (typeof window.cancelConductorInsertUi === 'function') window.cancelConductorInsertUi();
            if (window.updateChannelListUI) window.updateChannelListUI();
            if (typeof window.reanchorPlaybackClockIfPlaying === 'function') {
                window.reanchorPlaybackClockIfPlaying();
            }
            renderAll();
        });
        ctrls.appendChild(btnClear);

        inner.appendChild(ctrls);
        return inner;
    }

    function renderConductorStrip() {
        if (!conductorStripEl) return;
        const vis = conductorTrackVisible();
        if (!vis) {
            conductorStripEl.classList.add('hidden');
            conductorStripEl.innerHTML = '';
            _conductorStripSig = '';
            return;
        }
        const sig = JSON.stringify([state.conductor.locked]);
        if (sig === _conductorStripSig && conductorStripEl.childNodes.length > 0) return;
        _conductorStripSig = sig;
        conductorStripEl.classList.remove('hidden');
        conductorStripEl.innerHTML = '';
        conductorStripEl.appendChild(buildConductorStripInner());
    }

    function buildTrackListRows() {
        closeInstrumentComboIfOpen();
        chRows.innerHTML = '';
        for (let ti = 0; ti < state.tracks.length; ti++) {
            const trk = state.tracks[ti];
            const row = document.createElement('div');
            row.className = 'ch-row';
            if (ti === state.activeTrack) {
                row.classList.add('ch-active');
            }
            row.dataset.track = ti;

            // Color dot + editable name
            const dot = document.createElement('span');
            dot.className = 'ch-color-dot';
            dot.style.background = getTrackColor(ti);

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.value = trk.name;
            nameInput.title = 'Track name';
            nameInput.addEventListener('change', (function(idx) { return function() {
                const v = this.value;
                if (v === state.tracks[idx].name) return;
                pushUndoState('rename track');
                state.tracks[idx].name = v;
                updateKeyboardHeaderTrack();
                blurIfActive(this);
            }; })(ti));
            nameInput.addEventListener('focus', (function(idx) { return function() {
                setActiveTrack(idx);
                if (window.updateChannelListUI) window.updateChannelListUI();
                renderAll();
            }; })(ti));

            const nameWrap = document.createElement('span');
            nameWrap.className = 'ch-col ch-name-col';
            nameWrap.appendChild(dot);
            nameWrap.appendChild(nameInput);
            nameWrap.addEventListener('mousedown', (function(idx) { return function(e) {
                if (e.target === nameInput) return;
                setActiveTrack(idx);
                if (window.updateChannelListUI) window.updateChannelListUI();
                renderAll();
            }; })(ti));
            row.appendChild(nameWrap);

            // Channel dropdown (1-16)
            const chanSel = document.createElement('select');
            chanSel.className = 'ch-col ch-chan-col';
            chanSel.title = 'MIDI Channel';
            for (let c = 0; c < 16; c++) {
                const o = document.createElement('option');
                o.value = c;
                o.textContent = c + 1;
                chanSel.appendChild(o);
            }
            chanSel.value = trk.channel;
            chanSel.addEventListener('change', (function(idx) { return function() {
                const val = parseInt(this.value);
                if (val === state.tracks[idx].channel) return;
                pushUndoState('change channel');
                state.tracks[idx].channel = val;
                // If this is the active track, sync state.activeChannel
                if (idx === state.activeTrack) {
                    state.activeChannel = val;
                }
                // Toggle row instrument dropdown visibility
                const rowInstr = row.querySelector('.ch-instr-col');
                if (rowInstr) rowInstr.style.visibility = (val === 9) ? 'hidden' : '';
                blurIfActive(this);
                renderAll();
            }; })(ti));
            row.appendChild(chanSel);

            // Instrument searchable combo
            const instrWrap = createInstrumentSearchCombo(trk.instrument, (function(idx) { return function(val) {
                const ch = state.tracks[idx].channel;
                pushUndoState('change instrument');
                for (let j = 0; j < state.tracks.length; j++) {
                    if (state.tracks[j].channel === ch) {
                        state.tracks[j].instrument = val;
                        const otherWrap = chRows.querySelector(`.ch-row[data-track="${j}"] .ch-instr-col`);
                        if (otherWrap && typeof otherWrap.syncInstrument === 'function') {
                            otherWrap.syncInstrument(val);
                        }
                    }
                }
                audioEngine.setInstrument(ch, val);
                if (typeof window.pulseProMidiOutProgramChange === 'function') {
                    window.pulseProMidiOutProgramChange(ch, val);
                }
            }; })(ti));
            if (trk.channel === 9) {
                instrWrap.style.visibility = 'hidden';
            }
            row.appendChild(instrWrap);

            // Hide checkbox
            const hideCb = document.createElement('input');
            hideCb.type = 'checkbox';
            hideCb.className = 'ch-col ch-check-col';
            hideCb.title = 'Hide';
            hideCb.checked = trk.hidden;
            hideCb.addEventListener('change', (function(idx) { return function() {
                state.tracks[idx].hidden = this.checked;
                blurIfActive(this);
                if (typeof window.markEditorDirtyForAutoSave === 'function') window.markEditorDirtyForAutoSave();
                renderAll();
            }; })(ti));
            row.appendChild(hideCb);

            // Lock checkbox
            const lockCb = document.createElement('input');
            lockCb.type = 'checkbox';
            lockCb.className = 'ch-col ch-check-col';
            lockCb.title = 'Lock';
            lockCb.checked = trk.locked;
            lockCb.addEventListener('change', (function(idx) { return function() {
                state.tracks[idx].locked = this.checked;
                blurIfActive(this);
                if (typeof window.markEditorDirtyForAutoSave === 'function') window.markEditorDirtyForAutoSave();
            }; })(ti));
            row.appendChild(lockCb);

            // Mute checkbox
            const muteCb = document.createElement('input');
            muteCb.type = 'checkbox';
            muteCb.className = 'ch-col ch-check-col';
            muteCb.title = 'Mute';
            muteCb.checked = trk.muted;
            muteCb.addEventListener('change', (function(idx) { return function() {
                state.tracks[idx].muted = this.checked;
                blurIfActive(this);
                if (typeof window.markEditorDirtyForAutoSave === 'function') window.markEditorDirtyForAutoSave();
            }; })(ti));
            row.appendChild(muteCb);

            // Solo checkbox (radio-like behavior)
            const soloCb = document.createElement('input');
            soloCb.type = 'checkbox';
            soloCb.className = 'ch-col ch-check-col';
            soloCb.title = 'Solo';
            soloCb.checked = trk.solo;
            soloCb.addEventListener('change', (function(idx) { return function() {
                if (this.checked) {
                    for (let j = 0; j < state.tracks.length; j++) {
                        if (j !== idx) {
                            state.tracks[j].solo = false;
                            const otherCb = chRows.querySelector(`.ch-row[data-track="${j}"] input[title="Solo"]`);
                            if (otherCb) otherCb.checked = false;
                        }
                    }
                }
                state.tracks[idx].solo = this.checked;
                blurIfActive(this);
                if (typeof window.markEditorDirtyForAutoSave === 'function') window.markEditorDirtyForAutoSave();
            }; })(ti));
            row.appendChild(soloCb);

            chRows.appendChild(row);
        }
        renderConductorStrip();
    }
    buildTrackListRows();

    // --- Update track list UI (empty/active state) ---
    function updateChannelListUI() {
        renderConductorStrip();
        // Count notes per track
        const noteCounts = new Array(state.tracks.length).fill(0);
        for (const n of state.notes) {
            if (n.track >= 0 && n.track < noteCounts.length) noteCounts[n.track]++;
        }
        let rows = chRows.querySelectorAll('.ch-row[data-track]');
        if (rows.length !== state.tracks.length) {
            buildTrackListRows();
            rows = chRows.querySelectorAll('.ch-row[data-track]');
        }
        rows.forEach(row => {
            const ti = parseInt(row.dataset.track, 10);
            const empty = noteCounts[ti] === 0;
            row.classList.toggle('ch-empty', empty && ti !== state.activeTrack);
            row.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.disabled = empty;
            });
            // Update color dot + playback “sounding” ring (full-brightness track color)
            const dot = row.querySelector('.ch-color-dot');
            if (dot) {
                const col = getTrackColor(ti);
                dot.style.background = col;
                const playing = state.isPlaying && state.playbackSoundingTracks.has(ti);
                dot.classList.toggle('ch-dot-playing', playing);
                if (playing) {
                    dot.style.setProperty('--ch-dot-ring', col);
                } else {
                    dot.style.removeProperty('--ch-dot-ring');
                }
            }
            // Active track highlight
            if (ti === state.activeTrack) {
                row.classList.add('ch-active');
            } else {
                row.classList.remove('ch-active');
            }
        });
        updateKeyboardHeaderTrack();
    }
    // Expose for renderAll
    window.updateChannelListUI = updateChannelListUI;
    window.rebuildTrackList = function() { buildTrackListRows(); };

    // --- Channel list resize handle ---
    const resizeHandle = document.getElementById('channel-resize-handle');
    const channelList = document.getElementById('channel-list');
    let resizing = false;
    resizeHandle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        resizing = true;
        document.body.style.cursor = 'col-resize';
    });
    document.addEventListener('mousemove', function(e) {
        if (!resizing) return;
        const newWidth = Math.max(180, Math.min(600, e.clientX));
        channelList.style.width = newWidth + 'px';
        resizeCanvases();
        renderAll();
    });
    document.addEventListener('mouseup', function() {
        if (resizing) { resizing = false; document.body.style.cursor = ''; }
    });

    // BPM
    const bpmInput = document.getElementById('bpm');
    bpmInput.addEventListener('change', function() {
        const newBpm = Math.max(20, Math.min(999, parseInt(this.value) || 120));
        if (newBpm === state.bpm) return;
        pushUndoStateForBpm();
        state.bpm = newBpm;
        this.value = state.bpm;
        if (typeof window.reanchorPlaybackClockIfPlaying === 'function') {
            window.reanchorPlaybackClockIfPlaying();
        }
        blurIfActive(this);
        renderAll();
    });
    bpmInput.addEventListener('blur', function() {
        if (typeof endBpmUndoCoalesceSession === 'function') endBpmUndoCoalesceSession();
    });

    const gridSnapSelect = document.getElementById('grid-snap');
    function syncGridSnapUi() {
        if (gridSnapSelect) {
            gridSnapSelect.value = state.snapGridPower < 0 ? 'none' : String(state.snapGridPower);
        }
    }
    if (gridSnapSelect) {
        gridSnapSelect.addEventListener('change', function() {
            const raw = this.value;
            if (raw === 'none') {
                if (state.snapGridPower < 0) return;
                pushUndoState('change grid snap');
                state.snapGridPower = setSnapGridPower(SNAP_GRID_POWER_NONE);
                syncGridSnapUi();
                blurIfActive(this);
                renderAll();
                return;
            }
            const p = parseInt(raw, 10);
            if (p === state.snapGridPower) return;
            pushUndoState('change grid snap');
            state.snapGridPower = setSnapGridPower(Number.isFinite(p) ? p : 2);
            syncGridSnapUi();
            blurIfActive(this);
            renderAll();
        });
    }
    syncGridSnapUi();

    // Time signature (combined toolbar control + popover with two native selects)
    const tsNum = document.getElementById('timesig-num');
    const tsDen = document.getElementById('timesig-den');
    const tsCombo = document.getElementById('timesig-combo');
    const tsComboTrigger = document.getElementById('timesig-combo-trigger');
    const tsComboDisplay = document.getElementById('timesig-combo-display');

    function syncTimesigComboDisplay() {
        if (!tsComboDisplay || !tsNum || !tsDen) return;
        tsComboDisplay.textContent = tsNum.value + ' / ' + tsDen.value;
    }

    function setTimesigComboOpen(open) {
        if (!tsCombo || !tsComboTrigger) return;
        tsCombo.classList.toggle('open', open);
        tsComboTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open && tsNum && !tsNum.disabled) {
            requestAnimationFrame(function() {
                if (tsCombo.classList.contains('open')) tsNum.focus();
            });
        }
    }

    if (tsComboTrigger && tsCombo) {
        tsComboTrigger.addEventListener('click', function(e) {
            e.stopPropagation();
            if (tsComboTrigger.disabled) return;
            setTimesigComboOpen(!tsCombo.classList.contains('open'));
        });
        document.addEventListener('mousedown', function(e) {
            if (!tsCombo.classList.contains('open')) return;
            if (tsCombo.contains(e.target)) return;
            setTimesigComboOpen(false);
        });
        document.addEventListener('keydown', function(e) {
            if (e.key !== 'Escape') return;
            if (!tsCombo.classList.contains('open')) return;
            setTimesigComboOpen(false);
            tsComboTrigger.focus();
        });
    }

    tsNum.addEventListener('change', function() {
        const v = parseInt(this.value);
        if (v === state.timeSigNumerator) return;
        pushUndoState('change time signature');
        state.timeSigNumerator = v;
        if (typeof window.reanchorPlaybackClockIfPlaying === 'function') {
            window.reanchorPlaybackClockIfPlaying();
        }
        syncTimesigComboDisplay();
        blurIfActive(this);
        renderAll();
    });
    tsDen.addEventListener('change', function() {
        const v = parseInt(this.value);
        if (v === state.timeSigDenominator) return;
        pushUndoState('change time signature');
        state.timeSigDenominator = v;
        if (typeof window.reanchorPlaybackClockIfPlaying === 'function') {
            window.reanchorPlaybackClockIfPlaying();
        }
        syncTimesigComboDisplay();
        blurIfActive(this);
        renderAll();
    });
    syncTimesigComboDisplay();

    /** Toolbar BPM / time signature: live values while playing; disabled if conductor map exists. */
    function updateToolbarPlaybackTempoDisplay() {
        if (!bpmInput || !tsNum || !tsDen) return;
        const lockFields = state.isPlaying && conductorTrackVisible();
        const editingTransport = document.activeElement === bpmInput
            || document.activeElement === tsNum
            || document.activeElement === tsDen
            || document.activeElement === tsComboTrigger;
        if (state.isPlaying) {
            const t = Math.max(0, Math.floor(state.playbackTick));
            bpmInput.value = String(Math.round(getEffectiveBpmAtTick(t)));
            const sig = getEffectiveTimeSigAtTick(t);
            tsNum.value = String(sig.numerator);
            tsDen.value = String(sig.denominator);
        } else if (!editingTransport) {
            bpmInput.value = String(state.bpm);
            tsNum.value = String(state.timeSigNumerator);
            tsDen.value = String(state.timeSigDenominator);
        }
        bpmInput.disabled = lockFields;
        tsNum.disabled = lockFields;
        tsDen.disabled = lockFields;
        if (tsComboTrigger) {
            tsComboTrigger.disabled = lockFields;
            if (lockFields) setTimesigComboOpen(false);
        }
        syncTimesigComboDisplay();
        const lockedHint = 'Conductor map is active — values follow playback position while playing.';
        bpmInput.title = lockFields ? lockedHint : 'Project tempo (tick 0); editable when stopped.';
        const tsLocked = lockFields ? lockedHint : '';
        tsNum.title = tsLocked || 'Beats per bar (numerator)';
        tsDen.title = tsLocked || 'Beat unit (denominator)';
        if (tsComboTrigger) {
            tsComboTrigger.title = lockFields
                ? lockedHint
                : 'Time signature — click to choose beats and unit';
        }
    }
    window.updateToolbarPlaybackTempoDisplay = updateToolbarPlaybackTempoDisplay;

    // Playback controls
    document.getElementById('btn-play').addEventListener('click', function() {
        audioEngine.init();
        blurIfActive(this);
        startPlayback();
    });
    document.getElementById('btn-pause').addEventListener('click', function() {
        blurIfActive(this);
        pausePlayback();
    });
    document.getElementById('btn-stop').addEventListener('click', function() {
        blurIfActive(this);
        stopPlayback();
    });
    const btnRepeat = document.getElementById('btn-repeat');
    btnRepeat.addEventListener('click', function() {
        blurIfActive(this);
        state.isRepeat = !state.isRepeat;
        btnRepeat.classList.toggle('active', state.isRepeat);
        renderAll();
    });
    const btnMidiRecord = document.getElementById('btn-midi-record');
    if (btnMidiRecord && typeof window.pulseProApplyMidiRecordArmed === 'function') {
        btnMidiRecord.addEventListener('click', function() {
            blurIfActive(this);
            const next = !state.midiRecordArmed;
            void window.pulseProApplyMidiRecordArmed(next);
        });
        if (typeof window.pulseProUpdateMidiRecordButton === 'function') {
            window.pulseProUpdateMidiRecordButton();
        }
    }

    // --- Playback time display (M:S ↔ measure.beat, editable seek) ---
    const TIME_FORMAT_STORAGE_KEY = 'pulsepro-time-format';
    const btnTimeFormat = document.getElementById('btn-time-format');
    const playbackTimeInput = document.getElementById('playback-time-current');
    const playbackTimeMax = document.getElementById('playback-time-max');

    function getTimeDisplayMode() {
        return localStorage.getItem(TIME_FORMAT_STORAGE_KEY) === 'mb' ? 'mb' : 'time';
    }

    function setTimeDisplayMode(mode) {
        localStorage.setItem(TIME_FORMAT_STORAGE_KEY, mode === 'mb' ? 'mb' : 'time');
        if (btnTimeFormat) btnTimeFormat.textContent = mode === 'mb' ? 'M.B' : 'M:S';
        if (btnTimeFormat) {
            btnTimeFormat.title = mode === 'mb'
                ? 'Showing measure.beat — click for minutes:seconds'
                : 'Showing minutes:seconds — click for measure.beat';
        }
    }

    function tickToSeconds(tick) {
        return wallSecondsFromTick(Math.max(0, tick));
    }

    function secondsToTick(sec) {
        return tickFromWallSeconds(Math.max(0, sec));
    }

    function formatTickAsTime(tick) {
        const sec = Math.max(0, tickToSeconds(tick));
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return m + ':' + String(s).padStart(2, '0');
    }

    function formatTickAsMeasureBeat(tick) {
        const t = Math.max(0, tick);
        const ms = measureStartTickContaining(t);
        const measure = measureIndexAtTick(t) + 1;
        const tickInMeasure = t - ms;
        const beat = Math.floor(tickInMeasure / MIDI_TPQN) + 1;
        return measure + '.' + beat;
    }

    function formatTickForDisplay(tick) {
        return getTimeDisplayMode() === 'mb' ? formatTickAsMeasureBeat(tick) : formatTickAsTime(tick);
    }

    function parseTimeStringToTick(text) {
        const s = text.trim();
        if (!s) return null;
        const parts = s.split(':').map(function(p) { return p.trim(); });
        if (parts.length === 1) {
            const x = parseFloat(parts[0]);
            return isNaN(x) ? null : secondsToTick(x);
        }
        if (parts.length === 2) {
            const minutes = parseInt(parts[0], 10);
            const secPart = parseFloat(parts[1]);
            if (isNaN(secPart)) return null;
            const mins = isNaN(minutes) ? 0 : minutes;
            return secondsToTick(mins * 60 + secPart);
        }
        if (parts.length === 3) {
            const h = parseInt(parts[0], 10) || 0;
            const m = parseInt(parts[1], 10) || 0;
            const secPart = parseFloat(parts[2]);
            if (isNaN(secPart)) return null;
            return secondsToTick(h * 3600 + m * 60 + secPart);
        }
        return null;
    }

    function parseMeasureBeatStringToTick(text) {
        const s = text.trim().replace(',', '.');
        const match = s.match(/^(\d+)\s*[.:]\s*(\d+)$/);
        if (!match) return null;
        const measure = parseInt(match[1], 10);
        const beat = parseInt(match[2], 10);
        if (measure < 1 || beat < 1) return null;
        let tick = 0;
        for (let m = 0; m < measure - 1; m++) {
            tick += ticksPerMeasureAtTick(tick);
        }
        const tpm = ticksPerMeasureAtTick(tick);
        const beatTicks = (beat - 1) * MIDI_TPQN;
        if (beatTicks >= tpm) return null;
        return tick + beatTicks;
    }

    let playbackTimeInputFocused = false;

    function updatePlaybackTimeDisplay() {
        if (!playbackTimeMax || !playbackTimeInput) return;
        const maxTick = typeof window.getPlaybackMaxTick === 'function' ? window.getPlaybackMaxTick() : 0;
        playbackTimeMax.textContent = formatTickForDisplay(maxTick);
        if (!playbackTimeInputFocused) {
            playbackTimeInput.value = formatTickForDisplay(state.playbackTick);
        }
    }
    window.updatePlaybackTimeDisplay = updatePlaybackTimeDisplay;

    function commitPlaybackTimeFromInput() {
        if (!playbackTimeInput) return;
        const raw = playbackTimeInput.value;
        let tick = getTimeDisplayMode() === 'mb' ? parseMeasureBeatStringToTick(raw) : parseTimeStringToTick(raw);
        if (tick === null) {
            playbackTimeInput.value = formatTickForDisplay(state.playbackTick);
            return;
        }
        if (typeof window.seekPlaybackToTick === 'function') {
            window.seekPlaybackToTick(tick);
        }
        blurIfActive(playbackTimeInput);
    }

    setTimeDisplayMode(getTimeDisplayMode());
    if (btnTimeFormat) {
        btnTimeFormat.addEventListener('click', function() {
            const next = getTimeDisplayMode() === 'mb' ? 'time' : 'mb';
            setTimeDisplayMode(next);
            updatePlaybackTimeDisplay();
            blurIfActive(btnTimeFormat);
        });
    }
    if (playbackTimeInput) {
        playbackTimeInput.addEventListener('focus', function() {
            playbackTimeInputFocused = true;
            playbackTimeInput.select();
        });
        playbackTimeInput.addEventListener('blur', function() {
            playbackTimeInputFocused = false;
            commitPlaybackTimeFromInput();
        });
        playbackTimeInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitPlaybackTimeFromInput();
                playbackTimeInput.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                playbackTimeInput.value = formatTickForDisplay(state.playbackTick);
                playbackTimeInput.blur();
            }
        });
    }

    // MIDI Export/Import
    document.getElementById('btn-export-midi').addEventListener('click', downloadMidiFile);
    document.getElementById('btn-import-midi').addEventListener('click', openMidiFile);

    // Sync UI after MIDI import (called from midi.js)
    window.syncUIAfterImport = function() {
        // BPM
        document.getElementById('bpm').value = state.bpm;
        // Time signature
        document.getElementById('timesig-num').value = state.timeSigNumerator;
        document.getElementById('timesig-den').value = state.timeSigDenominator;
        syncTimesigComboDisplay();
        state.snapGridPower = setSnapGridPower(state.snapGridPower);
        syncGridSnapUi();
        // Rebuild track list
        buildTrackListRows();
    };

    function applyInstrumentsFromTrackState() {
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
        if (typeof window.pulseProMidiOutSendProgramsFromAudioEngine === 'function') {
            window.pulseProMidiOutSendProgramsFromAudioEngine();
        }
    }

    window.afterUndoRedoRestore = function() {
        if (window.syncUIAfterImport) window.syncUIAfterImport();
        applyInstrumentsFromTrackState();
        if (typeof window.reanchorPlaybackClockIfPlaying === 'function') {
            window.reanchorPlaybackClockIfPlaying();
        }
    };

    function peekUndoRedoActionLabel(stack) {
        if (!stack || stack.length === 0) return null;
        const raw = stack[stack.length - 1];
        if (typeof raw === 'string') return 'edit';
        if (raw && raw.label && String(raw.label).trim()) return String(raw.label).trim();
        return 'edit';
    }

    function updateEditMenuUndoRedoLabels() {
        const btnUndo = document.getElementById('btn-edit-undo');
        const btnRedo = document.getElementById('btn-edit-redo');
        const uText = btnUndo && btnUndo.querySelector('.menu-action-text');
        const rText = btnRedo && btnRedo.querySelector('.menu-action-text');
        const lu = peekUndoRedoActionLabel(state.undoStack);
        const lr = peekUndoRedoActionLabel(state.redoStack);
        if (uText) {
            uText.textContent = lu ? 'Undo ' + lu : 'Undo';
            if (btnUndo) {
                btnUndo.disabled = !lu;
                btnUndo.title = lu ? 'Undo ' + lu + ' (Ctrl+Z)' : 'Undo (Ctrl+Z)';
            }
        }
        if (rText) {
            rText.textContent = lr ? 'Redo ' + lr : 'Redo';
            if (btnRedo) {
                btnRedo.disabled = !lr;
                btnRedo.title = lr ? 'Redo ' + lr + ' (Ctrl+Shift+Z / Ctrl+Y)' : 'Redo (Ctrl+Y)';
            }
        }
    }
    window.updateEditMenuUndoRedoLabels = updateEditMenuUndoRedoLabels;

    window.copySelection = function() {
        if (typeof tryCopyAutomation === 'function' && tryCopyAutomation()) return;
        void copySelectedNotes();
    };
    window.pasteSelection = function() {
        if (typeof tryPasteAutomation === 'function' && tryPasteAutomation()) return;
        return pasteNotes();
    };
    window.deleteSelection = function() {
        if (state.selectedNoteIds.size === 0) return;
        pushUndoState('delete notes');
        removeSelectedNotes();
    };

    async function tryLoadNewSongMidForFools() {
        try {
            const r = await fetch('NewSong.mid', { cache: 'no-store' });
            if (!r.ok) return false;
            const buf = await r.arrayBuffer();
            if (!buf || buf.byteLength < 14) return false;
            applyMidiImportFromArrayBuffer(buf, { skipUndo: true, clearSessionAutosave: false });
            return true;
        } catch (e) {
            console.warn('NewSong.mid:', e);
            return false;
        }
    }

    function applyAfterNewProjectChromeReset() {
        state.undoStack = [];
        state.redoStack = [];
        state.clipboard = [];
        state.automationClipboard = null;
        state.automationSelectTicks = null;
        if (typeof window.aeSetTool === 'function') window.aeSetTool('line');
        NOTE_HEIGHT = NOTE_HEIGHT_DEFAULT;
        TOTAL_HEIGHT = TOTAL_MIDI_NOTES * NOTE_HEIGHT;
        BEAT_WIDTH = BEAT_WIDTH_DEFAULT;
        SNAP_WIDTH = BEAT_WIDTH / MIDI_TPQN;
        state.scrollY = TOTAL_HEIGHT / 2 - 300;
        state.automationExpandedHeightPx = 168;
        state.automationEditorExpanded = false;
        if (typeof window.aeSetAutomationEditorExpanded === 'function') {
            window.aeSetAutomationEditorExpanded(false);
        }
        setAutomationOverlayFromUi('');
        state.mode = 'idle';
        state.interactionNote = null;
        state.interactionData = null;
        state.highlightedKeys.clear();
        setTool('pencil');
        syncUIAfterImport();
        resizeCanvases();
        renderAll();
    }

    // Clear all
    const confirmDialog = document.getElementById('confirm-dialog');
    document.getElementById('btn-clear-all').addEventListener('click', function() {
        confirmDialog.classList.remove('hidden');
    });
    document.getElementById('confirm-yes').addEventListener('click', async function() {
        // Stop playback first
        stopPlayback();
        if (typeof window.pulseProClearSessionAutosave === 'function') {
            void window.pulseProClearSessionAutosave();
        }

        if (typeof window.pulseProFoolsIsEnabled === 'function' && window.pulseProFoolsIsEnabled()) {
            const loadedNew = await tryLoadNewSongMidForFools();
            if (loadedNew) {
                applyAfterNewProjectChromeReset();
                confirmDialog.classList.add('hidden');
                if (window.pulseProClearLibrarySongContext) window.pulseProClearLibrarySongContext();
                return;
            }
        }

        // Clear all note/automation data
        clearAllNotes();

        // Reset playback state
        state.playbackTick = 0;
        state.playbackStartTick = 0;
        state.lastMousePlaybackTick = 0;

        // Reset BPM and time signature
        state.bpm = 120;
        state.timeSigNumerator = 4;
        state.timeSigDenominator = 4;
        state.snapGridPower = setSnapGridPower(2);
        bpmInput.value = 120;
        tsNum.value = 4;
        tsDen.value = 4;
        syncGridSnapUi();

        // Reset tracks to 16 defaults (Track 1-16, channels 0-15)
        state.tracks = createDefaultTracks();
        setActiveTrack(0);
        for (let ch = 0; ch < 16; ch++) audioEngine.setInstrument(ch, 0);
        if (typeof window.pulseProMidiOutSendProgramsFromAudioEngine === 'function') {
            window.pulseProMidiOutSendProgramsFromAudioEngine();
        }

        // Reset automation overlay and collapse automation editor strip
        state.automationExpandedHeightPx = 168;
        state.automationEditorExpanded = false;
        if (typeof window.aeSetAutomationEditorExpanded === 'function') {
            window.aeSetAutomationEditorExpanded(false);
        }
        setAutomationOverlayFromUi('');

        // Clear undo/redo and clipboard
        state.undoStack = [];
        state.redoStack = [];
        state.clipboard = [];
        state.automationClipboard = null;
        state.automationSelectTicks = null;
        if (typeof window.aeSetTool === 'function') window.aeSetTool('line');

        // Reset zoom levels
        NOTE_HEIGHT = NOTE_HEIGHT_DEFAULT;
        TOTAL_HEIGHT = TOTAL_MIDI_NOTES * NOTE_HEIGHT;
        BEAT_WIDTH = BEAT_WIDTH_DEFAULT;
        SNAP_WIDTH = BEAT_WIDTH / MIDI_TPQN;

        // Reset scroll position
        state.scrollX = 0;
        state.scrollY = TOTAL_HEIGHT / 2 - 300;
        state.verticalPianoRoll = false;
        state.verticalTimePanPx = 0;
        state.timelineHeaderScrollPx = 0;
        _layoutSavedScrollYForVertical = null;
        const seqReset = document.getElementById('sequencer-container');
        if (seqReset) seqReset.classList.remove('layout-vertical');
        try { localStorage.removeItem('pulsepro-vertical-piano-roll'); } catch (e2) { /* ignore */ }
        state.keySignature = null;
        try { localStorage.removeItem(KEY_SIGNATURE_STORAGE_KEY); } catch (e3) { /* ignore */ }
        updateVerticalRollMenuCheck();
        updateKeySignatureMenuChecks();

        // Reset interaction state
        state.mode = 'idle';
        state.interactionNote = null;
        state.interactionData = null;
        state.highlightedKeys.clear();

        // Reset tool
        setTool('pencil');

        // Sync channel list UI
        syncUIAfterImport();

        confirmDialog.classList.add('hidden');
        if (window.pulseProClearLibrarySongContext) window.pulseProClearLibrarySongContext();
        renderAll();
    });
    document.getElementById('confirm-no').addEventListener('click', function() {
        confirmDialog.classList.add('hidden');
    });

    // File and Edit menu toggles
    const btnFileMenu = document.getElementById('btn-file-menu');
    const fileDropdown = document.getElementById('file-dropdown');
    const btnEditMenu = document.getElementById('btn-edit-menu');
    const editDropdown = document.getElementById('edit-dropdown');
    
    function closeAllDropdowns() {
        const dropdowns = document.getElementsByClassName("dropdown");
        for (let i = 0; i < dropdowns.length; i++) {
            const openDropdown = dropdowns[i];
            if (openDropdown.classList.contains('show')) {
                openDropdown.classList.remove('show');
            }
        }
    }

    function isAnyMenuOpen() {
        return document.querySelector('.dropdown.show') !== null;
    }

    btnFileMenu.addEventListener('click', function(e) {
        e.stopPropagation();
        const wasOpen = fileDropdown.parentElement.classList.contains('show');
        closeAllDropdowns();
        if (!wasOpen) {
            fileDropdown.parentElement.classList.add('show');
            if (typeof window.pulseProRefreshOpenRecentMenu === 'function') {
                window.pulseProRefreshOpenRecentMenu();
            }
        }
    });

    const btnOpenRecent = document.getElementById('btn-open-recent');
    if (btnOpenRecent) {
        btnOpenRecent.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }
    
    btnFileMenu.addEventListener('mouseenter', function(e) {
        if (isAnyMenuOpen() && !fileDropdown.parentElement.classList.contains('show')) {
            closeAllDropdowns();
            fileDropdown.parentElement.classList.add('show');
            if (typeof window.pulseProRefreshOpenRecentMenu === 'function') {
                window.pulseProRefreshOpenRecentMenu();
            }
        }
    });
    
    btnEditMenu.addEventListener('click', function(e) {
        e.stopPropagation();
        const wasOpen = editDropdown.parentElement.classList.contains('show');
        closeAllDropdowns();
        if (!wasOpen) {
            editDropdown.parentElement.classList.add('show');
            updateEditMenuUndoRedoLabels();
        }
    });

    btnEditMenu.addEventListener('mouseenter', function(e) {
        if (isAnyMenuOpen() && !editDropdown.parentElement.classList.contains('show')) {
            closeAllDropdowns();
            editDropdown.parentElement.classList.add('show');
        }
        updateEditMenuUndoRedoLabels();
    });

    function updateVerticalRollMenuCheck() {
        const el = document.getElementById('vertical-roll-check');
        if (!el) return;
        el.classList.toggle('checked', !!state.verticalPianoRoll);
    }

    function updateMidiKeyboardMonitorMenuCheck() {
        const el = document.getElementById('midi-keyboard-monitor-check');
        if (!el) return;
        el.classList.toggle('checked', !!state.midiKeyboardMonitor);
    }

    function populateKeySignaturePanel() {
        const panel = document.getElementById('key-signature-panel');
        if (!panel || panel.dataset.pulseproPopulated) return;
        panel.dataset.pulseproPopulated = '1';
        const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        function addRow(label, ks) {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('role', 'menuitem');
            const check = document.createElement('span');
            check.className = 'menu-check key-sig-menu-check';
            check.textContent = '✓';
            check.setAttribute('aria-hidden', 'true');
            b.appendChild(check);
            b.appendChild(document.createTextNode(' ' + label));
            b.addEventListener('click', function(e) {
                e.stopPropagation();
                setKeySignature(ks);
                closeAllDropdowns();
            });
            panel.appendChild(b);
        }
        addRow('None (chromatic)', null);
        for (let r = 0; r < 12; r++) {
            addRow(names[r] + ' major', { root: r, mode: 'major' });
        }
        for (let r = 0; r < 12; r++) {
            addRow(names[r] + ' minor', { root: r, mode: 'minor' });
        }
    }

    function updateKeySignatureMenuChecks() {
        const panel = document.getElementById('key-signature-panel');
        if (!panel) return;
        const buttons = panel.querySelectorAll('button');
        for (let idx = 0; idx < buttons.length; idx++) {
            const check = buttons[idx].querySelector('.key-sig-menu-check');
            if (!check) continue;
            let on = false;
            if (idx === 0) {
                on = !isKeySignatureActive(state.keySignature);
            } else if (idx <= 12) {
                const r = idx - 1;
                on = isKeySignatureActive(state.keySignature) &&
                    state.keySignature.root === r && state.keySignature.mode === 'major';
            } else {
                const r = idx - 13;
                on = isKeySignatureActive(state.keySignature) &&
                    state.keySignature.root === r && state.keySignature.mode === 'minor';
            }
            check.classList.toggle('checked', on);
        }
    }

    function setKeySignature(ks) {
        if (ks == null) {
            state.keySignature = null;
        } else {
            const r = ((ks.root % 12) + 12) % 12;
            const m = ks.mode === 'minor' ? 'minor' : 'major';
            state.keySignature = { root: r, mode: m };
        }
        try {
            if (state.keySignature) {
                localStorage.setItem(KEY_SIGNATURE_STORAGE_KEY, JSON.stringify(state.keySignature));
            } else {
                localStorage.removeItem(KEY_SIGNATURE_STORAGE_KEY);
            }
        } catch (err) { /* ignore */ }
        updateKeySignatureMenuChecks();
        renderAll();
    }
    window.setKeySignature = setKeySignature;

    function loadKeySignatureFromStorage() {
        try {
            const raw = localStorage.getItem(KEY_SIGNATURE_STORAGE_KEY);
            if (!raw) {
                updateKeySignatureMenuChecks();
                return;
            }
            const o = JSON.parse(raw);
            if (o && typeof o.root === 'number' && (o.mode === 'major' || o.mode === 'minor')) {
                state.keySignature = { root: ((o.root % 12) + 12) % 12, mode: o.mode };
            }
        } catch (e) { /* ignore */ }
        updateKeySignatureMenuChecks();
    }

    const btnKeySigMenu = document.getElementById('btn-key-signature-menu');
    if (btnKeySigMenu) {
        btnKeySigMenu.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }

    const btnViewMenu = document.getElementById('btn-view-menu');
    const viewDropdown = document.getElementById('view-dropdown');
    if (btnViewMenu && viewDropdown) {
        btnViewMenu.addEventListener('click', function(e) {
            e.stopPropagation();
            const wasOpen = viewDropdown.parentElement.classList.contains('show');
            closeAllDropdowns();
            if (!wasOpen) {
                viewDropdown.parentElement.classList.add('show');
                populateKeySignaturePanel();
                updateVerticalRollMenuCheck();
                updateMidiKeyboardMonitorMenuCheck();
                updateKeySignatureMenuChecks();
            }
        });
        btnViewMenu.addEventListener('mouseenter', function() {
            if (isAnyMenuOpen() && !viewDropdown.parentElement.classList.contains('show')) {
                closeAllDropdowns();
                viewDropdown.parentElement.classList.add('show');
                populateKeySignaturePanel();
                updateVerticalRollMenuCheck();
                updateMidiKeyboardMonitorMenuCheck();
                updateKeySignatureMenuChecks();
            }
        });
    }

    // Close dropdown when clicking outside
    window.addEventListener('click', function(e) {
        if (!e.target.matches('.dropbtn')) {
            closeAllDropdowns();
        }
    });

    const btnInsertMenu = document.getElementById('btn-insert-menu');
    const insertDropdown = document.getElementById('insert-dropdown');
    if (btnInsertMenu && insertDropdown) {
        btnInsertMenu.addEventListener('click', function(e) {
            e.stopPropagation();
            const wasOpen = insertDropdown.parentElement.classList.contains('show');
            closeAllDropdowns();
            if (!wasOpen) {
                insertDropdown.parentElement.classList.add('show');
            }
        });
        btnInsertMenu.addEventListener('mouseenter', function() {
            if (isAnyMenuOpen() && !insertDropdown.parentElement.classList.contains('show')) {
                closeAllDropdowns();
                insertDropdown.parentElement.classList.add('show');
            }
        });
    }

    let conductorPendingKind = null;
    let conductorPendingTick = null;
    const conductorValueDialog = document.getElementById('conductor-value-dialog');
    const conductorDialogHeading = document.getElementById('conductor-dialog-heading');
    const conductorDialogSub = document.getElementById('conductor-dialog-sub');
    const conductorInsertBpm = document.getElementById('conductor-insert-bpm');
    const conductorInsertTsNum = document.getElementById('conductor-insert-ts-num');
    const conductorInsertTsDen = document.getElementById('conductor-insert-ts-den');
    const conductorInsertOk = document.getElementById('conductor-insert-ok');
    const conductorInsertCancel = document.getElementById('conductor-insert-cancel');

    function setConductorDialogFieldMode(isBpm) {
        const bpmW = document.getElementById('conductor-insert-bpm-wrap');
        const tsW = document.getElementById('conductor-insert-ts-wrap');
        if (bpmW) bpmW.classList.toggle('hidden', !isBpm);
        if (tsW) tsW.classList.toggle('hidden', isBpm);
    }

    function hideConductorValueDialog() {
        if (conductorValueDialog) {
            conductorValueDialog.classList.add('hidden');
            conductorValueDialog.setAttribute('aria-hidden', 'true');
        }
    }

    function showConductorValueDialog() {
        if (conductorValueDialog) {
            conductorValueDialog.classList.remove('hidden');
            conductorValueDialog.setAttribute('aria-hidden', 'false');
        }
    }

    function focusConductorDialogPrimary() {
        if (conductorPendingKind === 'bpm' && conductorInsertBpm) {
            requestAnimationFrame(function() {
                conductorInsertBpm.focus();
                conductorInsertBpm.select();
            });
        } else if (conductorPendingKind === 'timesig' && conductorInsertTsNum) {
            requestAnimationFrame(function() {
                conductorInsertTsNum.focus();
            });
        }
    }

    function cancelConductorInsertUi() {
        conductorPendingKind = null;
        conductorPendingTick = null;
        hideConductorValueDialog();
        if (conductorInsertBpm) conductorInsertBpm.value = '';
        state.conductorPlacementMode = null;
        state.conductorPlacementHoverTick = null;
        renderAll();
    }
    window.cancelConductorInsertUi = cancelConductorInsertUi;

    function beginConductorInsert(kind) {
        if (state.conductor.locked) return;
        closeAllDropdowns();
        hideConductorValueDialog();
        if (conductorInsertBpm) conductorInsertBpm.value = '';
        conductorPendingKind = kind;
        conductorPendingTick = null;
        state.conductorPlacementMode = kind;
        state.conductorPlacementHoverTick = Math.max(0, Math.round(state.playbackTick));
        if (window.updateChannelListUI) window.updateChannelListUI();
        renderAll();
    }

    window.openConductorValuePrompt = function(tick) {
        if (state.conductor.locked || !conductorPendingKind) return;
        conductorPendingTick = tick;
        state.conductorPlacementMode = null;
        state.conductorPlacementHoverTick = null;
        if (!conductorValueDialog || !conductorInsertBpm || !conductorInsertTsNum || !conductorInsertTsDen) return;
        if (conductorPendingKind === 'bpm') {
            setConductorDialogFieldMode(true);
            if (conductorDialogHeading) conductorDialogHeading.textContent = 'Insert BPM change';
            if (conductorDialogSub) conductorDialogSub.textContent = 'Position: tick ' + tick;
            conductorInsertBpm.value = String(Math.round(getEffectiveBpmAtTick(tick)));
        } else {
            setConductorDialogFieldMode(false);
            if (conductorDialogHeading) conductorDialogHeading.textContent = 'Insert time signature change';
            if (conductorDialogSub) conductorDialogSub.textContent = 'Position: tick ' + tick;
            const sig = getEffectiveTimeSigAtTick(tick);
            conductorInsertTsNum.value = String(sig.numerator);
            conductorInsertTsDen.value = String(sig.denominator);
        }
        showConductorValueDialog();
        focusConductorDialogPrimary();
        renderAll();
    };

    /**
     * Open the value modal to edit an existing conductor marker (playback header).
     * @param {'bpm'|'ts'} kind
     * @param {number} tick
     */
    window.openConductorMarkerEdit = function(kind, tick) {
        if (state.conductor.locked) return;
        conductorPendingKind = kind === 'bpm' ? 'bpm' : 'timesig';
        conductorPendingTick = tick;
        state.conductorPlacementMode = null;
        state.conductorPlacementHoverTick = null;
        if (!conductorValueDialog || !conductorInsertBpm || !conductorInsertTsNum || !conductorInsertTsDen) return;
        if (conductorPendingKind === 'bpm') {
            const ev = state.tempoChanges.find(function(e) { return e.tick === tick; });
            if (!ev) return;
            setConductorDialogFieldMode(true);
            if (conductorDialogHeading) conductorDialogHeading.textContent = 'Edit BPM change';
            if (conductorDialogSub) conductorDialogSub.textContent = 'Tick ' + tick;
            conductorInsertBpm.value = String(ev.bpm);
        } else {
            const ev = state.timeSigChanges.find(function(e) { return e.tick === tick; });
            if (!ev) return;
            setConductorDialogFieldMode(false);
            if (conductorDialogHeading) conductorDialogHeading.textContent = 'Edit time signature change';
            if (conductorDialogSub) conductorDialogSub.textContent = 'Tick ' + tick;
            conductorInsertTsNum.value = String(ev.numerator);
            conductorInsertTsDen.value = String(ev.denominator);
        }
        showConductorValueDialog();
        focusConductorDialogPrimary();
        renderAll();
    };

    function commitConductorInsertFromInput() {
        if (conductorPendingTick == null || !conductorPendingKind) return;
        if (conductorPendingKind === 'bpm') {
            if (!conductorInsertBpm) return;
            const bpm = parseInt(String(conductorInsertBpm.value), 10);
            if (isNaN(bpm) || bpm < 20 || bpm > 999) {
                alert('Enter a BPM between 20 and 999.');
                return;
            }
            pushUndoState('insert BPM change');
            const t = Math.max(0, conductorPendingTick);
            if (t === 0) {
                state.bpm = bpm;
                document.getElementById('bpm').value = bpm;
                state.tempoChanges = state.tempoChanges.filter(function(e) { return e.tick !== 0; });
            } else {
                state.tempoChanges = state.tempoChanges.filter(function(e) { return e.tick !== t; });
                state.tempoChanges.push({ tick: t, bpm: bpm });
                sortTempoChanges();
            }
        } else {
            if (!conductorInsertTsNum || !conductorInsertTsDen) return;
            const n = parseInt(conductorInsertTsNum.value, 10);
            const d = parseInt(conductorInsertTsDen.value, 10);
            const logd = Math.log2(d);
            if (n < 1 || n > 32 || !Number.isFinite(logd) || logd < 0 || logd > 6 || !Number.isInteger(logd)) {
                alert('Invalid time signature.');
                return;
            }
            pushUndoState('insert time signature change');
            const t = Math.max(0, conductorPendingTick);
            if (t === 0) {
                state.timeSigNumerator = n;
                state.timeSigDenominator = d;
                document.getElementById('timesig-num').value = n;
                document.getElementById('timesig-den').value = d;
                syncTimesigComboDisplay();
                state.timeSigChanges = state.timeSigChanges.filter(function(e) { return e.tick !== 0; });
            } else {
                state.timeSigChanges = state.timeSigChanges.filter(function(e) { return e.tick !== t; });
                state.timeSigChanges.push({ tick: t, numerator: n, denominator: d });
                sortTimeSigChanges();
            }
        }
        conductorPendingKind = null;
        conductorPendingTick = null;
        hideConductorValueDialog();
        if (typeof window.reanchorPlaybackClockIfPlaying === 'function') {
            window.reanchorPlaybackClockIfPlaying();
        }
        if (window.updateChannelListUI) window.updateChannelListUI();
        renderAll();
    }

    function conductorDialogKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitConductorInsertFromInput();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelConductorInsertUi();
        }
    }

    const btnInsertBpm = document.getElementById('btn-insert-bpm');
    const btnInsertTimesig = document.getElementById('btn-insert-timesig');
    if (btnInsertBpm) btnInsertBpm.addEventListener('click', function() { beginConductorInsert('bpm'); });
    if (btnInsertTimesig) btnInsertTimesig.addEventListener('click', function() { beginConductorInsert('timesig'); });
    if (conductorInsertOk) conductorInsertOk.addEventListener('click', function() { commitConductorInsertFromInput(); });
    if (conductorInsertCancel) conductorInsertCancel.addEventListener('click', cancelConductorInsertUi);
    if (conductorValueDialog) {
        conductorValueDialog.addEventListener('click', function(e) {
            if (e.target === conductorValueDialog) cancelConductorInsertUi();
        });
    }
    if (conductorInsertBpm) conductorInsertBpm.addEventListener('keydown', conductorDialogKeydown);
    if (conductorInsertTsNum) conductorInsertTsNum.addEventListener('keydown', conductorDialogKeydown);
    if (conductorInsertTsDen) conductorInsertTsDen.addEventListener('keydown', conductorDialogKeydown);

    // Edit menu actions
    document.getElementById('btn-edit-undo').addEventListener('click', function() {
        undo();
    });
    document.getElementById('btn-edit-redo').addEventListener('click', function() {
        redo();
    });
    document.getElementById('btn-edit-copy').addEventListener('click', function() {
        copySelection();
    });
    document.getElementById('btn-edit-paste').addEventListener('click', function() {
        void pasteSelection();
    });
    document.getElementById('btn-edit-select-all').addEventListener('click', function() {
        state.selectedNoteIds.clear();
        for (const n of state.notes) state.selectedNoteIds.add(n.id);
        renderAll();
    });
    document.getElementById('btn-edit-delete').addEventListener('click', function() {
        deleteSelection();
        renderAll();
    });

    function applyResetZoom() {
        NOTE_HEIGHT = NOTE_HEIGHT_DEFAULT;
        TOTAL_HEIGHT = TOTAL_MIDI_NOTES * NOTE_HEIGHT;
        BEAT_WIDTH = BEAT_WIDTH_DEFAULT;
        SNAP_WIDTH = BEAT_WIDTH / MIDI_TPQN;
        resizeCanvases();
        clampScrollToViewport();
        if (state.verticalPianoRoll) {
            state.scrollX = 0;
            state.verticalTimePanPx = 0;
            state.timelineHeaderScrollPx = 0;
        } else {
            state.scrollX = 0;
            const maxSY = Math.max(0, TOTAL_HEIGHT - state.gridHeight);
            state.scrollY = Math.max(0, Math.min(maxSY, (TOTAL_HEIGHT - state.gridHeight) / 2));
        }
        renderAll();
    }

    function applyZoomToFit() {
        resizeCanvases();
        const spanTicks = typeof window.getTimelineSpanTicks === 'function'
            ? window.getTimelineSpanTicks()
            : Math.max(MIDI_TPQN * 4, getEndTick());
        const gw = state.gridWidth;
        if (gw <= 8 || spanTicks < 1) {
            renderAll();
            return;
        }
        const wIdeal = (gw * MIDI_TPQN) / spanTicks;
        BEAT_WIDTH = Math.max(BEAT_WIDTH_MIN, Math.min(BEAT_WIDTH_MAX, wIdeal));
        SNAP_WIDTH = BEAT_WIDTH / MIDI_TPQN;
        resizeCanvases();
        clampScrollToViewport();
        if (state.verticalPianoRoll) {
            state.scrollX = 0;
            state.verticalTimePanPx = 0;
            state.timelineHeaderScrollPx = 0;
        } else {
            state.scrollX = 0;
            const maxSY = Math.max(0, TOTAL_HEIGHT - state.gridHeight);
            state.scrollY = Math.max(0, Math.min(maxSY, (TOTAL_HEIGHT - state.gridHeight) / 2));
        }
        renderAll();
    }

    const btnViewResetZoom = document.getElementById('btn-view-reset-zoom');
    if (btnViewResetZoom) {
        btnViewResetZoom.addEventListener('click', function() {
            blurIfActive(this);
            applyResetZoom();
        });
    }
    const btnViewZoomFit = document.getElementById('btn-view-zoom-fit');
    if (btnViewZoomFit) {
        btnViewZoomFit.addEventListener('click', function() {
            blurIfActive(this);
            applyZoomToFit();
        });
    }

    // Theme toggle (View menu)
    const btnThemeMenu = document.getElementById('btn-theme-menu');
    const themeCheck = document.getElementById('theme-check');

    function updateThemeUI() {
        if (!themeCheck) return;
        if (currentTheme === 'dark') {
            themeCheck.classList.add('checked');
        } else {
            themeCheck.classList.remove('checked');
        }
    }

    if (btnThemeMenu) {
        btnThemeMenu.addEventListener('click', function() {
            blurIfActive(this);
            toggleTheme();
            updateThemeUI();
        });
    }

    const VERTICAL_ROLL_STORAGE_KEY = 'pulsepro-vertical-piano-roll';
    const MIDI_KEYBOARD_MONITOR_STORAGE_KEY = 'pulsepro-midi-keyboard-monitor';
    let _layoutSavedScrollYForVertical = null;

    function applySequencerLayoutClass() {
        const seq = document.getElementById('sequencer-container');
        if (seq) seq.classList.toggle('layout-vertical', !!state.verticalPianoRoll);
        if (typeof resizeCanvases === 'function') resizeCanvases();
        if (typeof clampScrollToViewport === 'function') clampScrollToViewport();
        if (typeof window.pulseProSyncAeExpandButtonVisibility === 'function') {
            window.pulseProSyncAeExpandButtonVisibility();
        }
    }

    function setVerticalPianoRoll(on) {
        const next = !!on;
        if (next === !!state.verticalPianoRoll) {
            updateVerticalRollMenuCheck();
            return;
        }
        if (next) {
            _layoutSavedScrollYForVertical = state.scrollY;
            state.timelineHeaderScrollPx = state.scrollX;
            state.verticalTimePanPx = 0;
            state.verticalPianoRoll = true;
            applySequencerLayoutClass();
            const maxPX = typeof getMaxPitchScrollPx === 'function' ? getMaxPitchScrollPx() : 0;
            state.scrollX = Math.max(0, Math.min(maxPX, 60 * NOTE_HEIGHT - state.gridWidth / 2));
            if (typeof window.aeSetAutomationEditorExpanded === 'function') {
                window.aeSetAutomationEditorExpanded(false);
            }
        } else {
            state.verticalPianoRoll = false;
            state.scrollX = state.timelineHeaderScrollPx;
            state.scrollY = _layoutSavedScrollYForVertical != null
                ? _layoutSavedScrollYForVertical
                : Math.max(0, Math.min(TOTAL_HEIGHT - state.gridHeight, TOTAL_HEIGHT / 2 - 300));
            state.timelineHeaderScrollPx = 0;
            state.verticalTimePanPx = 0;
            _layoutSavedScrollYForVertical = null;
            applySequencerLayoutClass();
        }
        try {
            localStorage.setItem(VERTICAL_ROLL_STORAGE_KEY, state.verticalPianoRoll ? '1' : '0');
        } catch (err) { /* ignore */ }
        updateVerticalRollMenuCheck();
        if (typeof window.pulseProFoolsReset === 'function') window.pulseProFoolsReset();
        renderAll();
    }
    window.setVerticalPianoRoll = setVerticalPianoRoll;

    const btnViewVerticalRoll = document.getElementById('btn-view-vertical-roll');
    if (btnViewVerticalRoll) {
        btnViewVerticalRoll.addEventListener('click', function() {
            blurIfActive(this);
            setVerticalPianoRoll(!state.verticalPianoRoll);
        });
    }

    const btnViewMidiKeyboardMonitor = document.getElementById('btn-view-midi-keyboard-monitor');
    if (btnViewMidiKeyboardMonitor && typeof window.pulseProSetMidiKeyboardMonitor === 'function') {
        btnViewMidiKeyboardMonitor.addEventListener('click', async function() {
            blurIfActive(this);
            const wantOn = !state.midiKeyboardMonitor;
            await window.pulseProSetMidiKeyboardMonitor(wantOn);
            try {
                localStorage.setItem(MIDI_KEYBOARD_MONITOR_STORAGE_KEY, state.midiKeyboardMonitor ? '1' : '0');
            } catch (err) { /* ignore */ }
            updateMidiKeyboardMonitorMenuCheck();
        });
    }

    try {
        if (localStorage.getItem(VERTICAL_ROLL_STORAGE_KEY) === '1') {
            setVerticalPianoRoll(true);
        } else {
            updateVerticalRollMenuCheck();
        }
    } catch (e) {
        updateVerticalRollMenuCheck();
    }

    try {
        if (localStorage.getItem(MIDI_KEYBOARD_MONITOR_STORAGE_KEY) === '1' && typeof window.pulseProSetMidiKeyboardMonitor === 'function') {
            void window.pulseProSetMidiKeyboardMonitor(true).then(function() {
                try {
                    localStorage.setItem(MIDI_KEYBOARD_MONITOR_STORAGE_KEY, state.midiKeyboardMonitor ? '1' : '0');
                } catch (e3) { /* ignore */ }
                updateMidiKeyboardMonitorMenuCheck();
            });
        } else {
            updateMidiKeyboardMonitorMenuCheck();
        }
    } catch (e2) {
        updateMidiKeyboardMonitorMenuCheck();
    }

    populateKeySignaturePanel();
    loadKeySignatureFromStorage();

    // Automation overlay dropdown
    const autoOverlaySelect = document.getElementById('automation-overlay-select');
    autoOverlaySelect.addEventListener('change', function() {
        setAutomationOverlayFromUi(this.value);
        blurIfActive(this);
    });

    const soundfontSelect = document.getElementById('soundfont-select');
    if (soundfontSelect) {
        soundfontSelect.addEventListener('change', function() {
            blurIfActive(this);
        });
    }

    const midiOutputSelect = document.getElementById('midi-output-select');
    if (midiOutputSelect && typeof window.pulseProEnsureMidiOutputAccess === 'function') {
        async function refreshMidiOutUi() {
            const ok = await window.pulseProEnsureMidiOutputAccess();
            if (ok && typeof window.pulseProRefreshMidiOutputSelect === 'function') {
                window.pulseProRefreshMidiOutputSelect(midiOutputSelect);
            } else {
                midiOutputSelect.innerHTML = '';
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = ok ? 'Off (built-in only)' : 'Web MIDI unavailable';
                midiOutputSelect.appendChild(opt);
                if (typeof window.pulseProSetMidiOutputId === 'function') {
                    window.pulseProSetMidiOutputId('', midiOutputSelect);
                }
            }
        }
        midiOutputSelect.addEventListener('focus', function() { void refreshMidiOutUi(); });
        midiOutputSelect.addEventListener('mousedown', function() { void refreshMidiOutUi(); });
        midiOutputSelect.addEventListener('change', function() {
            blurIfActive(this);
            if (typeof window.pulseProSetMidiOutputId === 'function') {
                window.pulseProSetMidiOutputId(this.value, midiOutputSelect);
            }
        });
        void refreshMidiOutUi();
    }

    if (window.pulseProInitSongLibrary) window.pulseProInitSongLibrary();

    initMidiDragDrop(document.getElementById('main-container'));

    // Initial setup (first paint after optional library restore)
    document.documentElement.setAttribute('data-theme', currentTheme);
    updateThemeUI();

    void (async function() {
        resizeCanvases();
        let loadedNewSongFools = false;
        if (typeof window.pulseProFoolsIsEnabled === 'function' && window.pulseProFoolsIsEnabled()) {
            loadedNewSongFools = await tryLoadNewSongMidForFools();
            if (loadedNewSongFools) {
                state.undoStack = [];
                state.redoStack = [];
                if (typeof window.pulseProClearLibrarySongContext === 'function') {
                    window.pulseProClearLibrarySongContext();
                }
                applyAfterNewProjectChromeReset();
            }
        }
        let restoredAutosave = false;
        if (!loadedNewSongFools && typeof window.pulseProTryRestoreSessionAutosave === 'function') {
            restoredAutosave = await window.pulseProTryRestoreSessionAutosave();
        }
        if (!loadedNewSongFools && !restoredAutosave && typeof window.pulseProRestoreLastLibrarySongOnLoad === 'function') {
            await window.pulseProRestoreLastLibrarySongOnLoad();
        }
        resizeCanvases();
        updatePlaybackButtons();
        renderAll();
        if (typeof window.pulseProStartSessionAutosave === 'function') {
            window.pulseProStartSessionAutosave();
        }
    })();

    window.addEventListener('resize', function() {
        resizeCanvases();
        renderAll();
    });
})();

