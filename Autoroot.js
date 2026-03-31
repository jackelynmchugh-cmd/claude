/**
 * autoroot.js — Autonomous port cracker & nuker
 *
 * - Scans the full network every 30s
 * - Cracks ports and nukes any server it can
 * - Copies worker scripts to newly rooted servers
 * - Maintains its own tail window with live status
 *
 * Usage: run autoroot.js
 * Compatible with Bitburner 3.0 API.
 */

import { getAllServers, tryRoot, countCrackers, formatTime } from 'Utils.js';

const WORKERS = ['hack-only.js', 'grow-only.js', 'weaken-only.js'];
const SCAN_INTERVAL = 30 * 1000; // 30 seconds

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('🔓 Autoroot');

    while (true) {
        ns.clearLog();

        const all = getAllServers(ns);
        const crackers = countCrackers(ns);
        const newlyRooted = [];
        const alreadyRooted = [];
        const cantRoot = [];

        for (const host of all) {
            if (ns.hasRootAccess(host)) {
                alreadyRooted.push(host);
                continue;
            }

            const portsNeeded = ns.getServerNumPortsRequired(host);
            if (portsNeeded <= crackers) {
                const success = tryRoot(ns, host);
                if (success) {
                    newlyRooted.push(host);
                    // Copy worker scripts to the newly rooted server
                    for (const worker of WORKERS) {
                        if (ns.fileExists(worker, 'home')) {
                            await ns.scp(worker, host, 'home');
                        }
                    }
                } else {
                    cantRoot.push(host);
                }
            } else {
                cantRoot.push(host);
            }
        }

        const totalRooted = alreadyRooted.length + newlyRooted.length;
        const lastScan = new Date().toLocaleTimeString();

        // ── Tail output ──────────────────────────────────────────────────────
        ns.print('╔══════════════════════════════════════╗');
        ns.print('║           AUTOROOT  STATUS           ║');
        ns.print('╠══════════════════════════════════════╣');
        ns.print(`║  Last scan:     ${lastScan.padEnd(21)}║`);
        ns.print(`║  Port crackers: ${String(crackers).padEnd(21)}║`);
        ns.print(`║  Total servers: ${String(all.length).padEnd(21)}║`);
        ns.print(`║  Rooted:        ${String(totalRooted).padEnd(21)}║`);
        ns.print(`║  Locked:        ${String(cantRoot.length).padEnd(21)}║`);
        ns.print('╠══════════════════════════════════════╣');

        if (newlyRooted.length > 0) {
            ns.print(`║  ✅ Newly rooted: ${String(newlyRooted.length).padEnd(20)}║`);
            for (const h of newlyRooted) {
                ns.print(`║    + ${h.padEnd(32)}║`);
            }
            ns.print('╠══════════════════════════════════════╣');
        } else {
            ns.print('║  ✅ No new servers rooted this scan  ║');
            ns.print('╠══════════════════════════════════════╣');
        }

        if (cantRoot.length > 0) {
            ns.print(`║  🔒 Still locked (${cantRoot.length}):`.padEnd(39) + '║');
            for (const h of cantRoot) {
                const needed = ns.getServerNumPortsRequired(h);
                const lvl = ns.getServerRequiredHackingLevel(h);
                ns.print(`║    - ${h.padEnd(18)} ports:${String(needed)} lvl:${String(lvl).padStart(4)}  ║`);
            }
            ns.print('╠══════════════════════════════════════╣');
        }

        ns.print(`║  Next scan in:  ${formatTime(SCAN_INTERVAL).padEnd(21)}║`);
        ns.print('╚══════════════════════════════════════╝');

        await ns.sleep(SCAN_INTERVAL);
    }
}