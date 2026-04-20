// vr-gamepad-bridge.js - Standard Gamepad API: thumbsticks pan/scroll; extra buttons map to editing shortcuts.
// Meta Quest Browser (2D pages): Touch controllers are usually NOT exposed as navigator.getGamepads() — the laser maps to pointer only. This file helps desktop/console gamepads (Xbox, etc.). Rich Quest controller input needs a WebXR session (different architecture).
// When a gamepad appears: sticks = pan; grip (btn 1) = cycle tool; stick click (btn 2) = redo; btn 3 = play/pause; btn 4 = undo (Touch-style layouts in Chromium).

(function () {
    const DEADZONE = 0.2;
    const STICK_PX_PER_SEC = 520;
    let lastTs = performance.now();
    /** Per-gamepad index: previous bitmask of watched buttons (bits 1 grip, 2 stick, 3 primary, 4 secondary). */
    const prevMask = new Map();

    function applyDeadzone(v) {
        const a = Math.abs(v);
        if (a < DEADZONE) {
            return 0;
        }
        const s = v < 0 ? -1 : 1;
        return s * ((a - DEADZONE) / (1 - DEADZONE));
    }

    function readStickXY(gp) {
        const ax = gp.axes;
        if (!ax || ax.length < 2) {
            return { x: 0, y: 0 };
        }
        return { x: applyDeadzone(ax[0]), y: applyDeadzone(ax[1]) };
    }

    function pressed(gp, i) {
        const b = gp.buttons && gp.buttons[i];
        return !!(b && b.pressed);
    }

    function watchMask(gp) {
        let m = 0;
        if (pressed(gp, 1)) {
            m |= 1;
        }
        if (pressed(gp, 2)) {
            m |= 2;
        }
        if (pressed(gp, 3)) {
            m |= 4;
        }
        if (pressed(gp, 4)) {
            m |= 8;
        }
        return m;
    }

    function onRisingEdge(prev, cur, bit, fn) {
        const was = (prev & bit) !== 0;
        const now = (cur & bit) !== 0;
        if (now && !was) {
            fn();
        }
    }

    function applyStickScroll(dt, sumX, sumY) {
        if (sumX === 0 && sumY === 0) {
            return false;
        }
        const scale = STICK_PX_PER_SEC * dt;
        const dx = sumX * scale;
        const dy = sumY * scale;
        if (typeof state === 'undefined' || typeof renderAll !== 'function') {
            return false;
        }
        if (!state.verticalPianoRoll) {
            const maxSX = typeof getMaxScrollX === 'function' ? getMaxScrollX() : 0;
            state.scrollX = Math.max(0, Math.min(Math.max(0, maxSX), state.scrollX + dx));
            state.scrollY = Math.max(0, Math.min(TOTAL_HEIGHT - state.gridHeight, state.scrollY + dy));
        } else {
            const maxPX = typeof getMaxPitchScrollPx === 'function' ? getMaxPitchScrollPx() : 0;
            state.scrollX = Math.max(0, Math.min(maxPX, state.scrollX + dx));
            if (typeof window.applyVerticalRollWheelToPlayhead === 'function' && dy !== 0) {
                window.applyVerticalRollWheelToPlayhead(-dy * 0.35, false);
            }
            if (typeof clampScrollToViewport === 'function') {
                clampScrollToViewport();
            }
        }
        return true;
    }

    function cycleEditTool() {
        if (typeof window.setTool !== 'function' || typeof state === 'undefined') {
            return;
        }
        const order = ['cursor', 'pencil', 'eraser'];
        const i = Math.max(0, order.indexOf(state.activeTool));
        window.setTool(order[(i + 1) % order.length]);
    }

    function tick(now) {
        requestAnimationFrame(tick);
        if (typeof navigator.getGamepads !== 'function') {
            return;
        }
        const dt = Math.min(0.08, (now - lastTs) / 1000);
        lastTs = now;
        if (typeof state === 'undefined' || typeof renderAll !== 'function') {
            return;
        }
        const pads = navigator.getGamepads();
        let sumX = 0;
        let sumY = 0;
        for (let i = 0; i < pads.length; i++) {
            const gp = pads[i];
            if (!gp || !gp.connected) {
                continue;
            }
            const s = readStickXY(gp);
            sumX += s.x;
            sumY += s.y;
            const cur = watchMask(gp);
            const prev = prevMask.get(i) || 0;
            onRisingEdge(prev, cur, 1, cycleEditTool);
            onRisingEdge(prev, cur, 2, function () {
                if (typeof redo === 'function') {
                    redo();
                }
            });
            onRisingEdge(prev, cur, 4, function () {
                if (typeof togglePlayPause === 'function') {
                    togglePlayPause();
                }
            });
            onRisingEdge(prev, cur, 8, function () {
                if (typeof undo === 'function') {
                    undo();
                }
            });
            prevMask.set(i, cur);
        }
        if (sumX !== 0 || sumY !== 0) {
            const n = pads.filter(function (g) { return g && g.connected; }).length;
            const damp = n > 1 ? 0.55 : 1;
            if (applyStickScroll(dt, sumX * damp, sumY * damp)) {
                renderAll();
            }
        }
    }

    window.addEventListener('gamepadconnected', function (ev) {
        const gp = ev.gamepad;
        const label = gp && gp.id ? gp.id : 'gamepad';
        console.log('[PulsePro] Gamepad connected — thumbsticks pan the grid; grip cycles tool; stick click redo; face buttons play/undo:', label);
    });

    requestAnimationFrame(tick);
})();

