// spessasynth-audio-worker.js — module worker for SpessaSynth WorkerSynthesizer (fallback when the bundled worklet processor cannot register on older browsers).
import { WorkerSynthesizerCore } from 'https://cdn.jsdelivr.net/npm/spessasynth_lib@4.2.2/dist/index.js';

let workerSynthCore;

self.onmessage = (event) => {
    if (event.ports[0]) {
        workerSynthCore = new WorkerSynthesizerCore(
            event.data,
            event.ports[0],
            self.postMessage.bind(self)
        );
    } else if (workerSynthCore) {
        void workerSynthCore.handleMessage(event.data);
    }
};
