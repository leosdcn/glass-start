const os = require('node:os');

/** @type {Set<() => void>} */
const activeCleanups = new Set();
let exitCleanupRegistered = false;
let signalsRegistered = false;

/** @param {() => void} fn */
function registerCleanup(fn) {
    activeCleanups.add(fn);
    return () => activeCleanups.delete(fn);
}

function executeCleanups() {
    for (const fn of [...activeCleanups].reverse()) {
        try { fn(); } catch {}
    }
    activeCleanups.clear();
}

function ensureExitCleanup() {
    if (exitCleanupRegistered) return;
    exitCleanupRegistered = true;
    process.on('exit', executeCleanups);
}

function ensureSignalHandlers() {
    ensureExitCleanup();
    if (signalsRegistered) return;
    signalsRegistered = true;
    for (const sig of /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])) {
        process.once(sig, () => {
            executeCleanups();
            const sigCode = os.constants?.signals?.[sig] || 1;
            process.exit(128 + sigCode);
        });
    }
}

module.exports = { registerCleanup, executeCleanups, ensureExitCleanup, ensureSignalHandlers };
