/**
 * hacknet-manager.js — Hacknet node and server manager
 * Auto-detects nodes vs servers, manages upgrades, spends hashes intelligently
 *
 * Usage: run hacknet-manager.js
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('⚙ Hacknet Manager');

    const LOOP_MS          = 10_000;
    const LIQUID_FLOOR_PCT = 0.30;
    const CASH_RESERVE     = 1_000_000;
    const ROI_PAYBACK_DAYS = 1.0;  // only buy if pays back within 1 day
    const MAX_NODES        = 20;   // max nodes to buy

    const fmt = (n) => {
        if (Math.abs(n) >= 1e12) return `$${(n/1e12).toFixed(2)}t`;
        if (Math.abs(n) >= 1e9)  return `$${(n/1e9).toFixed(2)}b`;
        if (Math.abs(n) >= 1e6)  return `$${(n/1e6).toFixed(2)}m`;
        if (Math.abs(n) >= 1e3)  return `$${(n/1e3).toFixed(2)}k`;
        return `$${n.toFixed(0)}`;
    };

    // ─── Portfolio value for liquid floor ────────────────────────────────────
    function getPortfolioValue() {
        let total = ns.getPlayer().money;
        try {
            for (const sym of ns.stock.getSymbols()) {
                const [lng, lngAvg, shrt, shrtAvg] = ns.stock.getPosition(sym);
                const price = ns.stock.getPrice(sym);
                if (lng  > 0) total += lng  * price;
                if (shrt > 0) total += shrt * (shrtAvg * 2 - price);
            }
        } catch { }
        return total;
    }

    function getLiquidFloor() {
        const portfolio = getPortfolioValue();
        return Math.max(CASH_RESERVE, portfolio * LIQUID_FLOOR_PCT);
    }

    function getSpendableCash() {
        return Math.max(0, ns.getPlayer().money - getLiquidFloor());
    }

    // ─── Auto-detect mode ─────────────────────────────────────────────────────
    function detectMode() {
    try {
        if (ns.hacknet.numNodes() > 0) {
            const stats = ns.hacknet.getNodeStats(0);
            if (stats.totalHashes !== undefined) return 'servers';
        }
        const cost = ns.hacknet.getPurchaseNodeCost();
        if (cost === Infinity) return 'servers';
    } catch { }
    return 'nodes';
}

    // ─── Hash spending priority ───────────────────────────────────────────────
    // auto-detects best use of hashes based on current game state
    function getBestHashSpend(player) {
        const factions   = player.factions ?? [];
        const hacking    = player.skills.hacking;
        const cash       = player.money;

        // check what's unlocked
        let hasCorp       = false;
        let hasBladeburner = false;
        try { hasCorp       = ns.corporation !== undefined; } catch { }
        try { hasBladeburner = ns.bladeburner !== undefined && ns.bladeburner.inBladeburner?.(); } catch { }

        // priority logic based on game state
        // 1. bladeburner rank if active
        if (hasBladeburner) return 'Sell for Bladeburner Rank';
        // 2. corp research if corp running
        if (hasCorp) return 'Exchange for Corporation Research';
        // 3. hacking exp if hacking level is low
        if (hacking < 500) return 'Sell for Hacking Exp';
        // 4. default — sell for money
        return 'Sell for Money';
    }

    // ─── Node manager ─────────────────────────────────────────────────────────
    function manageNodes() {
        const actions  = [];
        const budget   = getSpendableCash();
        const numNodes = ns.hacknet.numNodes();

   // buy new node if ROI is good
if (numNodes < MAX_NODES) {
    const cost = ns.hacknet.getPurchaseNodeCost();

    // estimate production — use existing node 0 if available, otherwise just buy it
    // first node is always worth buying since any income > 0
    let shouldBuy = false;
    if (numNodes === 0) {
        // no nodes yet — always buy first one if we can afford it
        shouldBuy = cost <= budget;
    } else {
        const production = ns.hacknet.getNodeStats(0).production ?? 1;
        const roiSeconds = cost / production;
        const roiDays    = roiSeconds / 86400;
        shouldBuy = cost <= budget && roiDays <= ROI_PAYBACK_DAYS;
    }

    if (shouldBuy) {
        if (ns.hacknet.purchaseNode() !== -1) {
            actions.push(`✅ Bought new node (${numNodes + 1})`);
        }
    }
}

        // upgrade existing nodes
        for (let i = 0; i < numNodes; i++) {
            const stats     = ns.hacknet.getNodeStats(i);
            const remaining = getSpendableCash();

            // level upgrade
            const levelCost = ns.hacknet.getLevelUpgradeCost(i, 1);
            if (levelCost <= remaining && levelCost !== Infinity) {
                if (ns.hacknet.upgradeLevel(i, 1)) {
                    actions.push(`⬆ Node ${i} level → ${stats.level + 1}`);
                }
            }

            // RAM upgrade
            const ramCost = ns.hacknet.getRamUpgradeCost(i, 1);
            if (ramCost <= remaining && ramCost !== Infinity) {
                if (ns.hacknet.upgradeRam(i, 1)) {
                    actions.push(`⬆ Node ${i} RAM → ${stats.ram * 2}GB`);
                }
            }

            // core upgrade
            const coreCost = ns.hacknet.getCoreUpgradeCost(i, 1);
            if (coreCost <= remaining && coreCost !== Infinity) {
                if (ns.hacknet.upgradeCore(i, 1)) {
                    actions.push(`⬆ Node ${i} cores → ${stats.cores + 1}`);
                }
            }
        }

        return actions;
    }

    // ─── Server manager ───────────────────────────────────────────────────────
    function manageServers(player) {
        const actions   = [];
        const budget    = getSpendableCash();
        const numNodes  = ns.hacknet.numNodes();
        const hashSpend = getBestHashSpend(player);

        // buy new server
        if (numNodes < MAX_NODES) {
            const cost = ns.hacknet.getPurchaseNodeCost();
            if (cost <= budget && cost !== Infinity) {
                if (ns.hacknet.purchaseNode() !== -1) {
                    actions.push(`✅ Bought new server (${numNodes + 1})`);
                }
            }
        }

        // upgrade existing servers
        for (let i = 0; i < numNodes; i++) {
            const stats     = ns.hacknet.getNodeStats(i);
            const remaining = getSpendableCash();

            const levelCost = ns.hacknet.getLevelUpgradeCost(i, 1);
            if (levelCost <= remaining && levelCost !== Infinity) {
                if (ns.hacknet.upgradeLevel(i, 1)) {
                    actions.push(`⬆ Server ${i} level → ${stats.level + 1}`);
                }
            }

            const ramCost = ns.hacknet.getRamUpgradeCost(i, 1);
            if (ramCost <= remaining && ramCost !== Infinity) {
                if (ns.hacknet.upgradeRam(i, 1)) {
                    actions.push(`⬆ Server ${i} RAM`);
                }
            }

            const coreCost = ns.hacknet.getCoreUpgradeCost(i, 1);
            if (coreCost <= remaining && coreCost !== Infinity) {
                if (ns.hacknet.upgradeCore(i, 1)) {
                    actions.push(`⬆ Server ${i} cores`);
                }
            }

            const cacheCost = ns.hacknet.getCacheUpgradeCost?.(i, 1);
            if (cacheCost && cacheCost <= remaining && cacheCost !== Infinity) {
                if (ns.hacknet.upgradeCache?.(i, 1)) {
                    actions.push(`⬆ Server ${i} cache`);
                }
            }
        }

        // spend hashes
        try {
            const hashes    = ns.hacknet.numHashes();
            const hashCap   = ns.hacknet.hashCapacity();
            const spendCost = ns.hacknet.hashCost(hashSpend);

            // spend if above 80% capacity to avoid wasting hashes
            if (hashes >= hashCap * 0.80 || hashes >= spendCost) {
                while (ns.hacknet.numHashes() >= ns.hacknet.hashCost(hashSpend)) {
                    if (!ns.hacknet.spendHashes(hashSpend)) break;
                    actions.push(`💰 Spent hashes: ${hashSpend}`);
                }
            }
        } catch { }

        return actions;
    }

    let cycle        = 0;
    let recentActions = [];

    // ─── Main loop ────────────────────────────────────────────────────────────
    while (true) {
        cycle++;
        const player   = ns.getPlayer();
        const mode     = detectMode();
        const numNodes = ns.hacknet.numNodes();
        const budget   = getSpendableCash();
        const floor    = getLiquidFloor();

        // run appropriate manager
        const newActions = mode === 'servers'
            ? manageServers(player)
            : manageNodes();

        if (newActions.length > 0) {
            recentActions = [...newActions, ...recentActions].slice(0, 10);
        }

        // gather stats for display
        let totalProduction = 0;
        let totalLevel      = 0;
        let totalRam        = 0;
        let totalCores      = 0;
        let totalHashes     = 0;
        let hashCap         = 0;
        const nodeStats     = [];

        for (let i = 0; i < numNodes; i++) {
            try {
                const s = ns.hacknet.getNodeStats(i);
                totalProduction += s.production ?? 0;
                totalLevel      += s.level;
                totalRam        += s.ram ?? 0;
                totalCores      += s.cores;
                if (s.totalHashes !== undefined) totalHashes = ns.hacknet.numHashes();
                nodeStats.push(s);
            } catch { }
        }

        try { hashCap = ns.hacknet.hashCapacity(); } catch { }

        ns.clearLog();
        ns.print(`⚙ HACKNET MANAGER  [${mode.toUpperCase()}]  Cycle: ${cycle}`);
        ns.print('─'.repeat(56));
        ns.print(`  Cash:       ${fmt(player.money)}`);
        ns.print(`  Floor:      ${fmt(floor)}  Spendable: ${fmt(budget)}`);
        ns.print(`  Nodes:      ${numNodes}/${MAX_NODES}`);

        if (mode === 'nodes') {
            ns.print(`  Production: ${fmt(totalProduction)}/s`);
            ns.print(`  Avg level:  ${numNodes > 0 ? (totalLevel/numNodes).toFixed(1) : 0}`);
        } else {
            ns.print(`  Hashes:     ${totalHashes.toFixed(0)} / ${hashCap}`);
            ns.print(`  Hash spend: ${getBestHashSpend(player)}`);
            ns.print(`  Production: ${totalProduction.toFixed(2)} h/s`);
        }

        // node list
        if (numNodes > 0 && numNodes <= 10) {
            ns.print('─'.repeat(56));
            ns.print(`  ${mode === 'servers' ? 'SERVERS' : 'NODES'}:`);
            for (let i = 0; i < numNodes; i++) {
                const s = nodeStats[i];
                if (!s) continue;
                if (mode === 'servers') {
                    ns.print(`  [${i}] lv:${s.level} ram:${s.ram}GB cores:${s.cores} cache:${s.cache??0} prod:${s.production?.toFixed(2)}h/s`);
                } else {
                    ns.print(`  [${i}] lv:${s.level} ram:${s.ram}GB cores:${s.cores} prod:${fmt(s.production)}/s`);
                }
            }
        } else if (numNodes > 10) {
            ns.print('─'.repeat(56));
            ns.print(`  Avg stats: lv:${(totalLevel/numNodes).toFixed(0)} ram:${(totalRam/numNodes).toFixed(0)}GB cores:${(totalCores/numNodes).toFixed(1)}`);
        }

        if (recentActions.length > 0) {
            ns.print('─'.repeat(56));
            ns.print('  RECENT:');
            for (const a of recentActions.slice(0, 5)) ns.print(`  ${a}`);
        }

        ns.print('─'.repeat(56));
        ns.print(`  Refreshes every ${LOOP_MS/1000}s`);

        await ns.sleep(LOOP_MS);
    }
}