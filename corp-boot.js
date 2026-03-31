/**
 * corp-boot.js — Bootstrap corp automation suite
 *
 * RAM: ~3GB
 * Usage: run corp-boot.js
 */

const SCRIPTS = [
    'corp-manager.js',
    'corp-actions.js',
    'corp-tea.js',
    'corp-invest.js',
    'corp-products.js',
];

/** @param {NS} ns */
export async function main(ns) {
    ns.tprint('🏢 Corp boot starting...');

    let ok = true;
    for (const s of SCRIPTS) {
        if (!ns.fileExists(s, 'home')) { ns.tprint(`❌ Missing: ${s}`); ok = false; }
        else ns.tprint(`✅ ${s}`);
    }
    if (!ok) { ns.tprint('ERROR: Missing scripts. Aborting.'); return; }

    if (ns.isRunning('corp-manager.js', 'home')) {
        ns.kill('corp-manager.js', 'home');
        await ns.sleep(500);
        ns.tprint('🔄 Restarted corp-manager');
    }

    const pid = ns.exec('corp-manager.js', 'home', 1);
    if (pid > 0) ns.tprint(`✅ corp-manager launched (PID ${pid})`);
    else         ns.tprint('❌ Launch failed — check RAM');
}