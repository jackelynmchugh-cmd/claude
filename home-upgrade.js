/**
 * home-upgrade.js — Home server RAM & core upgrader
 *
 * - Tries to upgrade home RAM first
 * - Falls back to upgrading cores if RAM is too expensive but cores are affordable
 * - Keeps at least $1m cash reserve at all times
 * - 30 minute cooldown between upgrade checks
 * - Has its own tail with live status
 *
 * Usage: run home-upgrade.js
 * Compatible with Bitburner 3.0 API.
 */

import { formatMoney, formatRam } from 'Utils.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const CASH_RESERVE    = 1_000_000;        // $1m minimum cash buffer
const COOLDOWN_MS     = 30 * 60 * 1000;  // 30 minutes between checks
const LOOP_SLEEP      = 10 * 1000;       // 10s loop just for tail refresh

// ─── Helpers ──────────────────────────────────────────────────────────────────

function canAfford(ns, cost) {
    return ns.getPlayer().money - cost >= CASH_RESERVE;
}

function formatTime(ms) {
    const s   = Math.floor(ms / 1000);
    const m   = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m ${sec}s`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('🏠 Home Upgrade');

    let lastUpgradeTime = 0;

    while (true) {
        const now    = Date.now();
        const money  = ns.getPlayer().money;
        const server = ns.getServer('home');
        const curRam = server.maxRam;
        const curCores = server.cpuCores;

        const ramCost  = ns.singularity.getUpgradeHomeRamCost();
        const coreCost = ns.singularity.getUpgradeHomeCoresCost();

        const cooldownRemaining = COOLDOWN_MS - (now - lastUpgradeTime);
        const onCooldown        = lastUpgradeTime > 0 && cooldownRemaining > 0;

        let action = 'none';

        if (!onCooldown) {
            if (canAfford(ns, ramCost)) {
                // RAM is affordable — upgrade it
                ns.singularity.upgradeHomeRam();
                lastUpgradeTime = Date.now();
                action = 'ram';
            } else if (canAfford(ns, coreCost)) {
                // Can't afford RAM but can afford cores
                ns.singularity.upgradeHomeCores();
                lastUpgradeTime = Date.now();
                action = 'cores';
            }
            // else: can't afford either — just wait
        }

        // ── Tail display ──────────────────────────────────────────────────────
        const freshServer = ns.getServer('home');
        const freshRam    = freshServer.maxRam;
        const freshCores  = freshServer.cpuCores;
        const freshRamCost  = ns.singularity.getUpgradeHomeRamCost();
        const freshCoreCost = ns.singularity.getUpgradeHomeCoresCost();
        const freshMoney    = ns.getPlayer().money;

        ns.clearLog();
        ns.print('╔══════════════════════════════════════╗');
        ns.print('║        HOME UPGRADE STATUS           ║');
        ns.print('╠══════════════════════════════════════╣');
        ns.print(`║  Money:       ${formatMoney(freshMoney).padEnd(23)}║`);
        ns.print(`║  Reserve:     ${formatMoney(CASH_RESERVE).padEnd(23)}║`);
        ns.print('╠══════════════════════════════════════╣');
        ns.print(`║  RAM:         ${formatRam(freshRam).padEnd(23)}║`);
        ns.print(`║  RAM cost:    ${formatMoney(freshRamCost).padEnd(23)}║`);
        ns.print(`║  Cores:       ${String(freshCores).padEnd(23)}║`);
        ns.print(`║  Core cost:   ${formatMoney(freshCoreCost).padEnd(23)}║`);
        ns.print('╠══════════════════════════════════════╣');

        if (action === 'ram') {
            ns.print(`║  ✅ Upgraded RAM → ${formatRam(freshRam).padEnd(19)}║`);
        } else if (action === 'cores') {
            ns.print(`║  ✅ Upgraded Cores → ${String(freshCores).padEnd(17)}║`);
        }

        if (onCooldown) {
            ns.print(`║  ⏳ Cooldown: ${formatTime(cooldownRemaining).padEnd(24)}║`);
        } else if (action === 'none') {
            if (!canAfford(ns, Math.min(freshRamCost, freshCoreCost))) {
                ns.print('║  💰 Waiting for funds...             ║');
            }
        }

        ns.print('╚══════════════════════════════════════╝');

        await ns.sleep(LOOP_SLEEP);
    }
}