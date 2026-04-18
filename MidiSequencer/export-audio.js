// export-audio.js - Export the built-in SoundFont mix using MediaRecorder (OGG or WebM Opus, browser-dependent)

const AUDIO_EXPORT_TAIL_MS = 2200;
const AUDIO_EXPORT_POLL_MS = 40;
const AUDIO_EXPORT_CANCEL_TAIL_MS = 280;

let audioExportUserCancelRequested = false;
let audioExportProgressInterval = null;
let audioExportKeyBlockHandler = null;

function pickMediaRecorderMimeType() {
    const candidates = [
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/webm;codecs=opus',
        'audio/webm',
    ];
    if (typeof MediaRecorder === 'undefined') return '';
    for (let i = 0; i < candidates.length; i++) {
        const mime = candidates[i];
        if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return '';
}

/** User-facing label for the format that {@link pickMediaRecorderMimeType} will choose. */
function describeAudioExportFormat(mime) {
    if (!mime) return 'Audio';
    const low = mime.toLowerCase();
    if (low.indexOf('ogg') >= 0 && low.indexOf('opus') >= 0) return 'OGG Opus (.ogg)';
    if (low.indexOf('ogg') >= 0) return 'OGG (.ogg)';
    if (low.indexOf('webm') >= 0 && low.indexOf('opus') >= 0) return 'WebM Opus (.webm)';
    if (low.indexOf('webm') >= 0) return 'WebM (.webm)';
    if (low.indexOf('mp4') >= 0) return 'MP4 audio (.m4a)';
    return 'Audio';
}

function fileExtensionForMime(mime) {
    if (!mime) return 'bin';
    const m = mime.toLowerCase();
    if (m.indexOf('ogg') >= 0) return 'ogg';
    if (m.indexOf('webm') >= 0) return 'webm';
    if (m.indexOf('mp4') >= 0) return 'm4a';
    return 'audio';
}

function sleep(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
}

function updateAudioExportProgressBar(pct) {
    const fill = document.getElementById('audio-export-progress-fill');
    const bar = document.getElementById('audio-export-progressbar');
    const clamped = Math.min(100, Math.max(0, pct));
    if (fill) fill.style.width = clamped + '%';
    if (bar) bar.setAttribute('aria-valuenow', String(Math.round(clamped)));
}

function stopAudioExportProgressPolling() {
    if (audioExportProgressInterval) {
        clearInterval(audioExportProgressInterval);
        audioExportProgressInterval = null;
    }
}

/**
 * @returns {function} Call once playback has finished to include tail time in the bar.
 */
function startAudioExportProgressPolling(endTick, songSec, tailSec) {
    const total = Math.max(0.0001, songSec + tailSec);
    let tailStartMs = null;
    stopAudioExportProgressPolling();
    audioExportProgressInterval = setInterval(function() {
        if (!state.audioExportInProgress) return;
        if (state.isPlaying) {
            const tick = Math.min(Math.max(0, state.playbackTick), endTick);
            const elapsed = wallSecondsFromTick(tick);
            updateAudioExportProgressBar(100 * Math.min(songSec, elapsed) / total);
        } else if (tailStartMs != null) {
            const tailElapsed = (performance.now() - tailStartMs) / 1000;
            updateAudioExportProgressBar(100 * (songSec + Math.min(tailSec, tailElapsed)) / total);
        }
    }, 80);
    return function beginTailPhase() {
        tailStartMs = performance.now();
    };
}

function pulseProAudioExportRequestCancel() {
    audioExportUserCancelRequested = true;
    const status = document.getElementById('audio-export-dialog-status');
    if (status) status.textContent = 'Canceling…';
    const cancelBtn = document.getElementById('audio-export-cancel');
    if (cancelBtn) cancelBtn.disabled = true;
    if (state.isPlaying) stopPlayback();
}

function showAudioExportModal(formatDescription) {
    if (typeof window.pulseProCloseAllDropdowns === 'function') {
        window.pulseProCloseAllDropdowns();
    }
    const dlg = document.getElementById('audio-export-dialog');
    const sub = document.getElementById('audio-export-dialog-sub');
    const status = document.getElementById('audio-export-dialog-status');
    if (sub) {
        sub.textContent = 'Recording the built-in mix as ' + formatDescription + '. Leave this tab open until export finishes.';
    }
    if (status) status.textContent = '';
    updateAudioExportProgressBar(0);
    audioExportUserCancelRequested = false;
    if (dlg) {
        dlg.classList.remove('hidden');
        dlg.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('pulsepro-audio-export-modal-open');

    audioExportKeyBlockHandler = function(e) {
        if (!state.audioExportInProgress) return;
        const dlgEl = document.getElementById('audio-export-dialog');
        if (dlgEl && dlgEl.classList.contains('hidden')) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            pulseProAudioExportRequestCancel();
            return;
        }
        e.preventDefault();
        e.stopPropagation();
    };
    document.addEventListener('keydown', audioExportKeyBlockHandler, true);

    const cancelBtn = document.getElementById('audio-export-cancel');
    if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.focus();
    }
}

function hideAudioExportModal() {
    if (audioExportKeyBlockHandler) {
        document.removeEventListener('keydown', audioExportKeyBlockHandler, true);
        audioExportKeyBlockHandler = null;
    }
    stopAudioExportProgressPolling();
    const dlg = document.getElementById('audio-export-dialog');
    if (dlg) {
        dlg.classList.add('hidden');
        dlg.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('pulsepro-audio-export-modal-open');
    const cancelBtn = document.getElementById('audio-export-cancel');
    if (cancelBtn) cancelBtn.disabled = false;
}

function refreshAudioExportMenuLabel() {
    const btn = document.getElementById('btn-export-audio');
    if (!btn) return;
    const mime = pickMediaRecorderMimeType();
    if (typeof MediaRecorder === 'undefined' || !mime) {
        btn.textContent = 'Audio export (not supported)';
        btn.disabled = true;
        btn.title = 'This browser does not support MediaRecorder or an Opus container (OGG / WebM).';
        return;
    }
    const desc = describeAudioExportFormat(mime);
    btn.textContent = 'Audio — ' + desc + '…';
    btn.disabled = false;
    btn.title = 'Record built-in SoundFont mix as ' + desc;
}

window.pulseProRefreshAudioExportMenuLabel = refreshAudioExportMenuLabel;

(function initAudioExportDialogControls() {
    function bind() {
        const cancelBtn = document.getElementById('audio-export-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', pulseProAudioExportRequestCancel);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', refreshAudioExportMenuLabel);
    } else {
        refreshAudioExportMenuLabel();
    }
})();

/**
 * Renders the timeline in real time from tick 0 through the song end, records the synth mix, then downloads a file.
 */
async function exportTimelineAudioToFile() {
    if (typeof MediaRecorder === 'undefined') {
        alert('This browser does not support MediaRecorder, so audio export is unavailable.');
        return;
    }
    const mimeType = pickMediaRecorderMimeType();
    if (!mimeType) {
        alert('This browser does not support an Opus recording container (OGG or WebM). Audio export is unavailable.');
        return;
    }
    if (state.midiRecordArmed) {
        alert('Turn off MIDI record before exporting audio.');
        return;
    }
    const endTick = getEndTick();
    if (endTick <= 0) {
        alert('Nothing to export — add notes or timeline content first.');
        return;
    }
    if (!audioEngine.ready) {
        alert('Wait for the SoundFont to finish loading before exporting audio.');
        return;
    }

    const formatDescription = describeAudioExportFormat(mimeType);
    const wasPlaying = state.isPlaying;
    const savedTick = state.playbackTick;
    const savedRepeat = state.isRepeat;
    const savedLastMouse = state.lastMousePlaybackTick;

    if (wasPlaying) pausePlayback();

    let recorder = null;
    let canceled = false;
    let modalWasShown = false;

    state.audioExportInProgress = true;
    try {
        await audioEngine.init();
        const stream = audioEngine.connectExportMediaDestination();
        if (!stream) {
            alert('Could not attach audio export tap.');
            return;
        }

        if (audioEngine.ctx && audioEngine.ctx.state === 'suspended') {
            await audioEngine.ctx.resume();
        }

        showAudioExportModal(formatDescription);
        modalWasShown = true;

        const songSec = Math.max(0.0001, wallSecondsFromTick(endTick));
        const tailSec = AUDIO_EXPORT_TAIL_MS / 1000;
        const beginTailPhase = startAudioExportProgressPolling(endTick, songSec, tailSec);

        const chunks = [];
        recorder = new MediaRecorder(stream, { mimeType: mimeType });
        recorder.ondataavailable = function(ev) {
            if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        };

        const stopDone = new Promise(function(resolve) {
            recorder.onstop = resolve;
        });

        let recorderStarted = false;
        recorder.start(250);
        recorderStarted = true;

        state.isRepeat = false;
        state.lastMousePlaybackTick = Number.MAX_SAFE_INTEGER;
        seekPlaybackToTick(0);

        startPlayback();

        const maxSongMs = (wallSecondsFromTick(endTick) + 20) * 1000;
        const t0 = performance.now();
        while (state.isPlaying && performance.now() - t0 < maxSongMs && !audioExportUserCancelRequested) {
            await sleep(AUDIO_EXPORT_POLL_MS);
        }

        beginTailPhase();

        if (audioExportUserCancelRequested) {
            canceled = true;
        } else if (state.isPlaying) {
            stopPlayback();
            canceled = true;
        } else {
            canceled = state.playbackTick === 0;
        }

        if (canceled || audioExportUserCancelRequested) {
            await sleep(AUDIO_EXPORT_CANCEL_TAIL_MS);
        } else {
            await sleep(AUDIO_EXPORT_TAIL_MS);
        }

        if (recorder.state !== 'inactive') {
            try {
                recorder.stop();
            } catch (eStop) { /* ignore */ }
        }
        if (recorderStarted) await stopDone;

        updateAudioExportProgressBar(100);

        if (canceled || audioExportUserCancelRequested) {
            if (audioExportUserCancelRequested) {
                alert('Export canceled.');
            } else {
                alert('Audio export was canceled or timed out.');
            }
            return;
        }

        const blob = new Blob(chunks, { type: mimeType });
        const ext = fileExtensionForMime(mimeType);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'song.' + ext;
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('Audio export failed: ' + (err && err.message ? err.message : String(err)));
    } finally {
        state.audioExportInProgress = false;
        if (modalWasShown) hideAudioExportModal();
        audioEngine.disconnectExportMediaDestination();
        if (recorder && recorder.state === 'recording') {
            try {
                recorder.stop();
            } catch (e2) { /* ignore */ }
        }
        state.isRepeat = savedRepeat;
        state.lastMousePlaybackTick = savedLastMouse;
        seekPlaybackToTick(savedTick);
        seekAutomationTo(savedTick);
        if (typeof window.pulseProSyncPlayheadPreviewNotes === 'function') {
            window.pulseProSyncPlayheadPreviewNotes();
        }
        renderAll();
    }
}

window.exportTimelineAudioToFile = exportTimelineAudioToFile;
