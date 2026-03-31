/**
 * darknet-boot.js — Darknet Bootstrap (runs on HOME)
 *
 * SCPs darknet-node.js + darknet-solver.js to darkweb and launches the node.
 * Exits immediately after launching.
 *
 * Usage: run darknet-boot.js
 * Compatible with Bitburner 3.0 API.
 */

const DARKWEB = 'darkweb';
const SCRIPTS = ['darknet-node.js', 'darknet-solver.js', 'darknet-actions.js', 'darknet-auth.js', 'darknet-stasis.js', 'darknet-unstasis.js'];

/** @param {NS} ns */
export async function main(ns) {
    ns.tprint('⏳ Bootstrapping darknet...');

    // Restore password files from home to darkweb
    const pwFiles = ns.ls('home').filter(f => f.startsWith('dnet-pw-') || f === 'dnet-passwords.txt');
    for (const f of pwFiles) {
        if (ns.scp(f, DARKWEB, 'home')) ns.tprint(`  🔑 Restored ${f}`);
    }
    if (pwFiles.length === 0) ns.tprint(`  ℹ No saved password files found on home`);

    let ok = 0;
    for (const s of SCRIPTS) {
        if (!ns.fileExists(s, 'home')) { ns.tprint(`⚠ Missing on home: ${s}`); continue; }
        if (await ns.scp(s, DARKWEB, 'home')) { ok++; ns.tprint(`  ✅ ${s}`); }
        else ns.tprint(`  ❌ Failed: ${s}`);
    }

    if (ok < SCRIPTS.length) {
        ns.tprint('ERROR: Not all scripts copied. Aborting.');
        return;
    }

    if (ns.isRunning('darknet-node.js', DARKWEB)) {
        ns.tprint('INFO: darknet-node.js already running on darkweb.');
        return;
    }

    const pid = ns.exec('darknet-node.js', DARKWEB, 1);
    if (pid > 0) ns.tprint(`✅ Launched darknet-node.js on darkweb (PID ${pid})`);
    else ns.tprint(`ERROR: Launch failed — free RAM on darkweb: ${ns.getServerMaxRam(DARKWEB) - ns.getServerUsedRam(DARKWEB)}GB`);
}