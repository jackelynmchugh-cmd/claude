/**
 * augment-manager.js — Augmentation manager
 * Semi-auto: tracks available augs, buys in optimal order,
 * respects activity lock, detects gang-primary nodes,
 * cross-references gang vs faction augs, alerts when ready to reset
 * NFG burn after main purchases, best rep target display
 *
 * Usage: run augment-manager.js
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('💊 Augment Manager');

    const LOOP_MS            = 15_000;
    const CASH_RESERVE       = 1_000_000;
    const ACTIVITY_LOCK_PORT = 1;
    const NFG_NAME           = 'NeuroFlux Governor';

    // ─── Color helpers ────────────────────────────────────────────────────────
    const C = {
        reset:   '\x1b[0m', bold:    '\x1b[1m', dim:     '\x1b[2m',
        red:     '\x1b[31m', green:   '\x1b[32m', yellow:  '\x1b[33m',
        cyan:    '\x1b[36m', white:   '\x1b[37m', bred:    '\x1b[91m',
        bgreen:  '\x1b[92m', byellow: '\x1b[93m', bcyan:   '\x1b[96m',
        bwhite:  '\x1b[97m',
    };

    const col     = (c, t) => `${c}${t}${C.reset}`;
    const bold    = (t)    => `${C.bold}${t}${C.reset}`;
    const dim     = (t)    => col(C.dim, t);
    const header  = (t)    => col(C.bcyan, bold(t));
    const divider = (n=60) => col(C.dim, '─'.repeat(n));
    const label   = (t)    => col(C.cyan, t);

    const fmt = (n) => {
        if (Math.abs(n) >= 1e12) return `$${(n/1e12).toFixed(2)}t`;
        if (Math.abs(n) >= 1e9)  return `$${(n/1e9).toFixed(2)}b`;
        if (Math.abs(n) >= 1e6)  return `$${(n/1e6).toFixed(2)}m`;
        if (Math.abs(n) >= 1e3)  return `$${(n/1e3).toFixed(2)}k`;
        return `$${n.toFixed(0)}`;
    };

    const fmtRep = (n) => {
        if (n >= 1e6) return `${(n/1e6).toFixed(2)}m`;
        if (n >= 1e3) return `${(n/1e3).toFixed(1)}k`;
        return n.toFixed(0);
    };

    // ─── Activity lock ────────────────────────────────────────────────────────
    function isActivityLocked() {
        try {
            const data = ns.peek(ACTIVITY_LOCK_PORT);
            if (data === 'NULL PORT DATA') return false;
            return JSON.parse(data)?.reason === 'grafting';
        } catch { return false; }
    }

    // ─── Gang faction ─────────────────────────────────────────────────────────
    function getGangFaction() {
        try {
            return ns.gang.inGang() ? ns.gang.getGangInformation().faction : null;
        } catch { return null; }
    }

    // ─── Gang-primary node detection ──────────────────────────────────────────
    function detectGangPrimary(factions, gangFaction) {
        if (!gangFaction) return false;
        try {
            const gangAugs   = ns.singularity.getAugmentationsFromFaction(gangFaction);
            const totalUnique = new Set();
            for (const f of factions) {
                try {
                    for (const a of ns.singularity.getAugmentationsFromFaction(f)) {
                        totalUnique.add(a);
                    }
                } catch { }
            }
            return gangAugs.length / Math.max(1, totalUnique.size) >= 0.80;
        } catch { return false; }
    }

    // ─── Aug scoring — display only, not used to gate purchases ──────────────
    function scoreAug(aug) {
        try {
            const s = ns.singularity.getAugmentationStats(aug);
            let score = 0;
            if (s.hacking_mult)            score += (s.hacking_mult - 1)            * 100;
            if (s.hacking_money_mult)      score += (s.hacking_money_mult - 1)      * 120;
            if (s.hacking_grow_mult)       score += (s.hacking_grow_mult - 1)       * 80;
            if (s.faction_rep_mult)        score += (s.faction_rep_mult - 1)        * 90;
            if (s.company_rep_mult)        score += (s.company_rep_mult - 1)        * 70;
            if (s.crime_money_mult)        score += (s.crime_money_mult - 1)        * 80;
            if (s.crime_success_mult)      score += (s.crime_success_mult - 1)      * 70;
            if (s.strength_mult)           score += (s.strength_mult - 1)           * 50;
            if (s.defense_mult)            score += (s.defense_mult - 1)            * 50;
            if (s.dexterity_mult)          score += (s.dexterity_mult - 1)          * 50;
            if (s.agility_mult)            score += (s.agility_mult - 1)            * 50;
            if (s.charisma_mult)           score += (s.charisma_mult - 1)           * 40;
            if (s.infiltration_rep_mult)   score += (s.infiltration_rep_mult - 1)   * 60;
            if (s.bladeburner_success_chance_mult) score += (s.bladeburner_success_chance_mult - 1) * 80;
            return Math.round(score * 1000) / 10; // one decimal
        } catch { return 0; }
    }

    // ─── Build aug catalog ────────────────────────────────────────────────────
    function buildCatalog(factions, ownedAugs, gangFaction) {
        const ownedSet = new Set(ownedAugs);
        const augMap   = {};

        for (const faction of factions) {
            let factionAugs;
            try { factionAugs = ns.singularity.getAugmentationsFromFaction(faction); }
            catch { continue; }

            const rep = ns.singularity.getFactionRep(faction);

            for (const aug of factionAugs) {
                if (ownedSet.has(aug)) continue;
                if (aug === NFG_NAME)  continue; // tracked separately

                let price, repReq;
                try {
                    price  = ns.singularity.getAugmentationPrice(aug);
                    repReq = ns.singularity.getAugmentationRepReq(aug);
                } catch { continue; }

                const fromGang = faction === gangFaction;

                if (!augMap[aug]) {
                    augMap[aug] = {
                        name:        aug,
                        price,
                        repReq,
                        bestFaction: faction,
                        bestRep:     rep,
                        hasRep:      rep >= repReq,
                        fromGang,
                        score:       scoreAug(aug),
                    };
                } else if (rep > augMap[aug].bestRep) {
                    augMap[aug].bestRep     = rep;
                    augMap[aug].bestFaction = faction;
                    augMap[aug].hasRep      = rep >= repReq;
                    if (fromGang) augMap[aug].fromGang = true;
                }
            }
        }

        return Object.values(augMap).sort((a, b) => b.price - a.price);
    }

    // ─── Auto-buy ─────────────────────────────────────────────────────────────
    // only gates: has rep + can afford after cash reserve
    // no ROI or value filtering — buy everything we can
    function tryBuy(catalog, cash, isGangPrimary, gangFaction) {
        const bought = [];
        const failed = [];
        let multiplier = 1;

        const buyable = catalog.filter(a => a.hasRep);

        for (const aug of buyable) {
            const cascadePrice = aug.price * multiplier;
            if (cash - cascadePrice < CASH_RESERVE) {
                failed.push({ ...aug, cascadePrice });
                continue;
            }

            // prefer gang faction in gang-primary nodes
            const source = (isGangPrimary && aug.fromGang) ? gangFaction : aug.bestFaction;
            if (!source) { failed.push({ ...aug, cascadePrice }); continue; }

            try {
                if (ns.singularity.purchaseAugmentation(source, aug.name)) {
                    bought.push({ ...aug, cascadePrice, source });
                    cash      -= cascadePrice;
                    multiplier *= 1.9;
                } else {
                    failed.push({ ...aug, cascadePrice });
                }
            } catch {
                failed.push({ ...aug, cascadePrice });
            }
        }

        return { bought, failed, cashRemaining: cash };
    }

    // ─── NFG burn ─────────────────────────────────────────────────────────────
    // buy as many NFG levels as possible after main purchases
    function buyNFG(faction, cash) {
        let count = 0;
        while (true) {
            let price;
            try { price = ns.singularity.getAugmentationPrice(NFG_NAME); }
            catch { break; }
            if (cash - price < CASH_RESERVE) break;
            if (!ns.singularity.purchaseAugmentation(faction, NFG_NAME)) break;
            cash -= price;
            count++;
        }
        return count;
    }

    // ─── Best rep target ──────────────────────────────────────────────────────
    function getBestRepTarget(missingRep) {
        if (missingRep.length === 0) return null;
        return [...missingRep]
            .sort((a, b) => (b.bestRep/b.repReq) - (a.bestRep/a.repReq))[0];
    }

    let lastBought   = [];
    let lastFailed   = [];
    let lastNFG      = 0;
    let resetAlerted = false;
    let cycle        = 0;

    // ─── Main loop ────────────────────────────────────────────────────────────
    while (true) {
        cycle++;

        const player      = ns.getPlayer();
        let   cash        = player.money;
        const factions    = player.factions ?? [];
        const locked      = isActivityLocked();
        const gangFaction = getGangFaction();
        const isGangPrimary = detectGangPrimary(factions, gangFaction);

        let ownedAugs = [];
        try { ownedAugs = ns.singularity.getOwnedAugmentations(true); } catch { }

        const nfgLevel   = ownedAugs.filter(a => a === NFG_NAME).length;
        const ownedNoNfg = ownedAugs.filter(a => a !== NFG_NAME);

        const catalog    = buildCatalog(factions, ownedAugs, gangFaction);
        const buyable    = catalog.filter(a => a.hasRep);
        const missingRep = catalog.filter(a => !a.hasRep);
        const gangAugs   = buyable.filter(a => a.fromGang);
        const factAugs   = buyable.filter(a => !a.fromGang);
        const target     = getBestRepTarget(missingRep);

        // ── Auto-buy ──────────────────────────────────────────────────────────
        lastNFG = 0;
        if (!locked && buyable.length > 0) {
            const result = tryBuy(catalog, cash, isGangPrimary, gangFaction);
            lastBought   = result.bought;
            lastFailed   = result.failed;
            cash         = result.cashRemaining;

            // NFG burn — only after buying everything else
            if (buyable.length === 0 || result.bought.length > 0) {
                const nfgSource = gangFaction ?? factions[0];
                if (nfgSource) lastNFG = buyNFG(nfgSource, cash);
            }
        } else {
            lastBought = [];
            lastFailed = [];
        }

        // ── Reset alert ───────────────────────────────────────────────────────
        const readyToReset = buyable.length === 0;
        if (readyToReset && !resetAlerted) {
            ns.alert('💊 AUGMENT MANAGER: All available augs purchased!\nReady to install and reset.');
            resetAlerted = true;
        }
        if (!readyToReset) resetAlerted = false;

        // ── Display ───────────────────────────────────────────────────────────
        ns.clearLog();

        ns.print(`${header('💊 AUGMENT MANAGER')}  ${dim(`[${isGangPrimary ? '🔫 gang-primary' : '🏛 faction'}]`)}`);
        ns.print(divider());

        // status
        ns.print(`  ${label('Cash:')}       ${col(C.bwhite, fmt(cash))}`);
        ns.print(`  ${label('Owned augs:')} ${col(C.bwhite, String(ownedNoNfg.length))}  ${dim('(excl. NFG)')}`);
        ns.print(`  ${label('NFG level:')}  ${col(nfgLevel > 0 ? C.bgreen : C.dim, String(nfgLevel))}`);
        ns.print(`  ${label('Activity:')}   ${locked ? col(C.bred, '🔒 LOCKED — grafting') : col(C.bgreen, '🟢 open')}`);
        ns.print(`  ${label('Cycle:')}      ${cycle}`);

        // lategame targets
        ns.print(divider());
        ns.print(header('  🎯 LATEGAME TARGETS'));
        const augCount = ownedNoNfg.length;
        const cov  = augCount >= 20;
        const dae  = augCount >= 30;
        const illu = augCount >= 30;
        ns.print(`  The Covenant:  ${col(cov  ? C.bgreen : C.yellow, `${augCount}/20`)}  ${cov  ? col(C.bgreen, '✅') : col(C.yellow, `need ${20-augCount} more`)}`);
        ns.print(`  Daedalus:      ${col(dae  ? C.bgreen : C.yellow, `${augCount}/30`)}  ${dae  ? col(C.bgreen, '✅') : col(C.yellow, `need ${30-augCount} more`)}`);
        ns.print(`  Illuminati:    ${col(illu ? C.bgreen : C.yellow, `${augCount}/30`)}  ${illu ? col(C.bgreen, '✅') : col(C.yellow, `need ${30-augCount} more`)}`);

        // reset status
        ns.print(divider());
        if (readyToReset) {
            ns.print(`  ${col(C.bred, bold('🚨 READY TO RESET — all available augs purchased!'))}`);
            ns.print(`  ${col(C.byellow, 'Install augments and start next BN')}`);
        } else {
            ns.print(`  ${label('Buyable now:')}  ${col(C.bgreen,  String(buyable.length))}`);
            ns.print(`  ${label('Missing rep:')}  ${col(C.byellow, String(missingRep.length))}`);
        }

        // best rep target
        if (target) {
            const pct      = (target.bestRep / target.repReq * 100).toFixed(1);
            const pctColor = Number(pct) >= 75 ? C.bgreen : Number(pct) >= 40 ? C.byellow : C.bred;
            const barFill  = Math.floor(Number(pct) / 5);
            const bar      = '█'.repeat(barFill) + '░'.repeat(20 - barFill);
            ns.print(divider());
            ns.print(header('  🎯 CLOSEST REP TARGET'));
            ns.print(`  ${col(C.bwhite, target.name)}`);
            ns.print(`  ${col(C.cyan,   target.bestFaction)}  ${fmt(target.price)}`);
            ns.print(`  Rep: ${fmtRep(target.bestRep)} / ${fmtRep(target.repReq)}  ${col(pctColor, pct + '%')}`);
            ns.print(`  [${col(pctColor, bar)}]`);
        }

        // gang augs available
        if (gangAugs.length > 0) {
            ns.print(divider());
            ns.print(header(`  🔫 GANG AUGS AVAILABLE (${gangAugs.length})`));
            for (const aug of gangAugs.slice(0, 8)) {
                const scoreStr = aug.score > 0 ? col(C.dim, ` [${aug.score}]`) : '';
                ns.print(
                    `  ${col(C.bwhite, aug.name.padEnd(38))} ` +
                    `${fmt(aug.price).padStart(10)}${scoreStr}`
                );
            }
            if (gangAugs.length > 8) ns.print(`  ${dim(`...+${gangAugs.length-8} more`)}`);
        }

        // faction augs available
        if (factAugs.length > 0) {
            ns.print(divider());
            ns.print(header(`  🏛 FACTION AUGS AVAILABLE (${factAugs.length})`));
            for (const aug of factAugs.slice(0, 6)) {
                const scoreStr = aug.score > 0 ? col(C.dim, ` [${aug.score}]`) : '';
                ns.print(
                    `  ${col(C.bwhite, aug.name.padEnd(28))} ` +
                    `${(aug.bestFaction ?? '').padEnd(18)} ` +
                    `${fmt(aug.price).padStart(10)}${scoreStr}`
                );
            }
            if (factAugs.length > 6) ns.print(`  ${dim(`...+${factAugs.length-6} more`)}`);
        }

        // missing rep
        if (missingRep.length > 0) {
            ns.print(divider());
            ns.print(header(`  ⏳ NEED MORE REP (${missingRep.length})`));
            const sorted = [...missingRep].sort((a,b) =>
                (b.bestRep/b.repReq) - (a.bestRep/a.repReq)
            );
            for (const aug of sorted.slice(0, 6)) {
                const pct = (aug.bestRep / aug.repReq * 100).toFixed(0);
                const pctColor = Number(pct) >= 75 ? C.bgreen : Number(pct) >= 40 ? C.byellow : C.bred;
                ns.print(
                    `  ${col(C.white, aug.name.padEnd(28))} ` +
                    `${(aug.bestFaction ?? '').padEnd(18)} ` +
                    `${col(pctColor, pct + '%').padStart(6)}`
                );
            }
            if (sorted.length > 6) ns.print(`  ${dim(`...+${sorted.length-6} more`)}`);
        }

        // recently bought
        if (lastBought.length > 0) {
            ns.print(divider());
            ns.print(header(`  ✅ JUST BOUGHT (${lastBought.length})`));
            for (const aug of lastBought.slice(0, 5)) {
                ns.print(
                    `  ${col(C.bgreen, aug.name.padEnd(38))} ` +
                    `${fmt(aug.cascadePrice).padStart(10)}  ` +
                    `${dim('via')} ${aug.source}`
                );
            }
            if (lastBought.length > 5) ns.print(`  ${dim(`...+${lastBought.length-5} more`)}`);
        }

        // NFG purchases
        if (lastNFG > 0) {
            ns.print(divider());
            ns.print(`  ${col(C.bgreen, `🧬 NFG BURNED x${lastNFG}`)}  ${dim(`now level ${nfgLevel + lastNFG}`)}`);
        }

        // cant afford
        if (lastFailed.length > 0) {
            ns.print(divider());
            ns.print(header(`  💸 CAN'T AFFORD YET (${lastFailed.length})`));
            for (const aug of lastFailed.slice(0, 4)) {
                ns.print(
                    `  ${col(C.white, aug.name.padEnd(38))} ` +
                    `${col(C.bred, fmt(aug.cascadePrice)).padStart(10)}`
                );
            }
            if (lastFailed.length > 4) ns.print(`  ${dim(`...+${lastFailed.length-4} more`)}`);
        }

        ns.print(divider());
        ns.print(`  ${dim(`Refreshes every ${LOOP_MS/1000}s`)}`);

        await ns.sleep(LOOP_MS);
    }
}