/**
 * server-buyer.js — Purchased server manager
 *
 * - Buys up to the max number of purchasable servers (named pserv-0, pserv-1, ...)
 * - Starts all servers at 8GB
 * - Once all slots are filled at the current tier, upgrades all to the next tier
 * - Tiers: 8 → 16 → 32 → 64 → 128 → 256 → 512 → 1024 → 2048 → 4096 → 8192 → ...
 * - Cooldown of 10 minutes between tier upgrades (starts at 32GB+)
 * - Always keeps at least $200k cash reserve
 * - Has its own tail with live status
 *
 * Usage: run server-buyer.js
 * Compatible with Bitburner 3.0 API.
 */

import { formatMoney, formatRam } from 'Utils.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const CASH_RESERVE      = 200_000;       // $200k minimum cash buffer
const COOLDOWN_MS       = 1000; // 10 minutes between tier upgrades
const COOLDOWN_MIN_RAM  = 32;             // cooldown kicks in at 32GB+
const CHECK_INTERVAL    = 15 * 1000;      // check every 15 seconds
const BASE_RAM          = 8;              // starting RAM tier (GB)
const PREFIX            = 'pserv';

// RAM tiers in GB (powers of 2 from 8 up to max)
const RAM_TIERS = [8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serverName(i) {
    return `${PREFIX}-${i}`;
}

function canAfford(ns, cost) {
    return ns.getPlayer().money - cost >= CASH_RESERVE;
}

/**
 * Returns the current RAM tier index for a given RAM value.
 * Returns -1 if not found.
 */
function tierIndexOf(ram) {
    return RAM_TIERS.indexOf(ram);
}

/**
 * Returns the next RAM tier above current, or null if already at max.
 */
function nextTier(currentRam) {
    const idx = RAM_TIERS.indexOf(currentRam);
    if (idx === -1 || idx >= RAM_TIERS.length - 1) return null;
    return RAM_TIERS[idx + 1];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('🖥 Server Buyer');

    const maxServers = ns.cloud.getServerLimit();
    let lastUpgradeTime = 0;
    let cooldownActive  = false;

    while (true) {
        ns.clearLog();

        const now         = Date.now();
        const money       = ns.getPlayer().money;
        const owned       = ns.cloud.getServerNames(); // current pservs
        const ownedCount  = owned.length;

        // ── Phase 1: Buy missing slots at BASE_RAM ────────────────────────────
        let bought = 0;
        for (let i = 0; i < maxServers; i++) {
            const name = serverName(i);
            if (owned.includes(name)) continue;

            const cost = ns.cloud.getServerCost(BASE_RAM);
            if (!canAfford(ns, cost)) break;

            ns.cloud.purchaseServer(name, BASE_RAM);
            bought++;
        }

        // ── Phase 2: Upgrade all to same tier incrementally ───────────────────
        // Find the lowest RAM across all owned servers
        const ramList = owned.map(s => ns.getServerMaxRam(s));
        const minRam  = ramList.length > 0 ? Math.min(...ramList) : BASE_RAM;
        const maxRam  = ramList.length > 0 ? Math.max(...ramList) : BASE_RAM;
        const allSame = ramList.every(r => r === minRam);

        // Cooldown check
        const cooldownRemaining = COOLDOWN_MS - (now - lastUpgradeTime);
        cooldownActive = minRam >= COOLDOWN_MIN_RAM && cooldownRemaining > 0;

        let upgraded = 0;
        if (!cooldownActive && ownedCount === maxServers) {
            // All slots filled — try to upgrade lowest-tier servers
            const targetRam = nextTier(minRam); // always upgrade to next tier above minimum

            if (targetRam !== null) {
                for (const name of owned) {
                    const curRam = ns.getServerMaxRam(name);
                    if (curRam >= targetRam) continue;

                    const cost = ns.cloud.getServerUpgradeCost(name, targetRam);
                    if (!canAfford(ns, cost)) continue;

                    ns.cloud.upgradeServer(name, targetRam);
                    upgraded++;
                }

                if (upgraded > 0 && targetRam >= COOLDOWN_MIN_RAM) {
                    lastUpgradeTime = Date.now();
                }
            }
        }

        // ── Tail display ──────────────────────────────────────────────────────
        const freshOwned   = ns.cloud.getServerNames();
        const freshRamList = freshOwned.map(s => ns.getServerMaxRam(s));
        const freshMin     = freshRamList.length > 0 ? Math.min(...freshRamList) : BASE_RAM;
        const freshMax     = freshRamList.length > 0 ? Math.max(...freshRamList) : BASE_RAM;
        const nextRam      = freshOwned.length > 0 ? nextTier(freshMin) : nextTier(BASE_RAM);
        const upgradeCost  = freshOwned.length > 0 && nextRam
            ? freshOwned
                .filter(s => ns.getServerMaxRam(s) < nextRam)
                .reduce((sum, s) => sum + ns.cloud.getServerUpgradeCost(s, nextRam), 0)
            : 0;

        ns.print('╔══════════════════════════════════════╗');
        ns.print('║         SERVER BUYER STATUS          ║');
        ns.print('╠══════════════════════════════════════╣');
        ns.print(`║  Money:       ${formatMoney(money).padEnd(23)}║`);
        ns.print(`║  Reserve:     ${formatMoney(CASH_RESERVE).padEnd(23)}║`);
        ns.print(`║  Servers:     ${String(freshOwned.length).padEnd(6)} / ${String(maxServers).padEnd(16)}║`);
        ns.print('╠══════════════════════════════════════╣');
        ns.print(`║  Min RAM:     ${formatRam(freshMin).padEnd(23)}║`);
        ns.print(`║  Max RAM:     ${formatRam(freshMax).padEnd(23)}║`);

        if (nextRam) {
            ns.print(`║  Next tier:   ${formatRam(nextRam).padEnd(23)}║`);
            ns.print(`║  Upgrade cost:${formatMoney(upgradeCost).padEnd(23)}║`);
        } else {
            ns.print('║  Next tier:   MAX — fully upgraded!  ║');
        }

        ns.print('╠══════════════════════════════════════╣');

        if (cooldownActive) {
            const remaining = cooldownRemaining / 1000;
            const mins = Math.floor(remaining / 60);
            const secs = Math.floor(remaining % 60);
            ns.print(`║  ⏳ Cooldown: ${String(mins + 'm ' + secs + 's').padEnd(23)}║`);
        } else if (freshOwned.length < maxServers) {
            ns.print(`║  🛒 Buying servers at ${formatRam(BASE_RAM).padEnd(16)}║`);
        } else if (nextRam) {
            ns.print(`║  ⬆ Upgrading to ${formatRam(nextRam).padEnd(21)}║`);
        } else {
            ns.print('║  ✅ All servers at max RAM!           ║');
        }

        if (bought > 0)    ns.print(`║  + Bought ${String(bought).padEnd(28)}║`);
        if (upgraded > 0)  ns.print(`║  ⬆ Upgraded ${String(upgraded).padEnd(26)}║`);

        ns.print('╚══════════════════════════════════════╝');

        await ns.sleep(CHECK_INTERVAL);
    }
}