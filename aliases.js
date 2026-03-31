/**
 * aliases.js — Prints all alias commands to type into the terminal
 *
 * Run this after each BitNode reset, then copy/paste the commands
 * into the terminal to restore all shortcuts.
 *
 * Usage: run aliases.js
 */

/** @param {NS} ns */
export async function main(ns) {
    const aliases = [
        ['sell',      'run stock-sell.js'],
        ['trader',    'run stock-trader.js'],
        ['autoroot',  'run autoroot.js'],
        ['backdoor',  'run backdoor.js'],
        ['orch',      'run orchestrator.js'],
        ['buyer',     'run server-buyer.js'],
        ['upgrade',   'run home-upgrade.js'],
        ['dnet',      'run darknet-boot.js'],
        ['contracts', 'run contract-solver.js'],
    ];

    ns.tprint('');
    ns.tprint('════ STEP 1 — run each line in the terminal ════');
    ns.tprint('');
    for (const [name, cmd] of aliases) {
        ns.tprint(`alias -g ${name}="${cmd}"`);
    }
    ns.tprint('');
    ns.tprint('════ STEP 2 — quick reference ════');
    ns.tprint('');
    ns.tprint('  Command                   What it does');
    ns.tprint('  ───────────────────────   ──────────────────────────────');
    ns.tprint('  sell JGN                  sell all shares of JGN');
    ns.tprint('  sell all                  sell every held position');
    ns.tprint('  trader                    start stock trader');
    ns.tprint('  autoroot                  start autoroot daemon');
    ns.tprint('  backdoor                  backdoor all rooted servers');
    ns.tprint('  orch                      start orchestrator + batchers');
    ns.tprint('  buyer                     start server buyer');
    ns.tprint('  upgrade                   start home upgrader');
    ns.tprint('  dnet                      bootstrap darknet crawler');
    ns.tprint('  contracts                 scan + solve all contracts');
    ns.tprint('');
}