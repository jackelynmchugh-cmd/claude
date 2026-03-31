/**
 * bitnode-advisor.js — Smart BitNode strategy advisor
 * Merged: smart strategy engine + complete BN knowledge base
 * Gang manager no longer depends on this — runs fully standalone
 *
 * Usage: run bitnode-advisor.js
 * Note: ~258GB RAM due to singularity calls — run occasionally
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('🧭 BitNode Advisor');

    const LOOP_MS = 60_000;

    // ─── Color helpers ────────────────────────────────────────────────────────
    const C = {
        reset:   '\x1b[0m', bold:    '\x1b[1m', dim:     '\x1b[2m',
        red:     '\x1b[31m', green:   '\x1b[32m', yellow:  '\x1b[33m',
        cyan:    '\x1b[36m', white:   '\x1b[37m', bred:    '\x1b[91m',
        bgreen:  '\x1b[92m', byellow: '\x1b[93m', bcyan:   '\x1b[96m',
        bwhite:  '\x1b[97m',
    };

    const col    = (c, t) => `${c}${t}${C.reset}`;
    const bold   = (t)    => `${C.bold}${t}${C.reset}`;
    const dim    = (t)    => col(C.dim, t);
    const header = (t)    => col(C.bcyan, bold(t));
    const divider = (n=60) => col(C.dim, '─'.repeat(n));
    const label  = (t)    => col(C.cyan, t);

    const fmt = (n) => {
        if (Math.abs(n) >= 1e12) return `$${(n/1e12).toFixed(2)}t`;
        if (Math.abs(n) >= 1e9)  return `$${(n/1e9).toFixed(2)}b`;
        if (Math.abs(n) >= 1e6)  return `$${(n/1e6).toFixed(2)}m`;
        if (Math.abs(n) >= 1e3)  return `$${(n/1e3).toFixed(2)}k`;
        return `$${n.toFixed(0)}`;
    };

    // ─── BN knowledge base ────────────────────────────────────────────────────
    const BN_INFO = {
        1:  { name: 'Source Genesis',         reward: 'SF1 — extra RAM on home, +8 cores',                                    next: [4, 2, 3] },
        2:  { name: 'Rise of the Underworld', reward: 'SF2 — early gang creation in other BNs',                               next: [4, 3, 12] },
        3:  { name: 'Corporatocracy',         reward: 'SF3 — corporation mechanics unlocked',                                  next: [4, 8, 12] },
        4:  { name: 'The Singularity',        reward: 'SF4 — singularity functions (automation)',                             next: [2, 5, 8] },
        5:  { name: 'Artificial Sweeteners',  reward: 'SF5 — neuroflux governor cheaper, better stats',                       next: [6, 8, 12] },
        6:  { name: 'Bladeburners',           reward: 'SF6 — bladeburner API access',                                         next: [7, 8, 12] },
        7:  { name: 'Bladeburners 2079',      reward: 'SF7 — bladeburner bonuses stack',                                      next: [8, 12, 3] },
        8:  { name: 'Ghost of Wall Street',   reward: 'SF8 — stocks always profitable, 4x stock multiplier',                  next: [12, 4, 9] },
        9:  { name: 'Hacktocracy',            reward: 'SF9 — hacknet server hashes, corp research boost',                     next: [12, 3, 10] },
        10: { name: 'Digital Carbon',         reward: 'SF10 — sleeves (up to 3 per level)',                                   next: [12, 4, 5] },
        11: { name: 'The Big Crash',          reward: 'SF11 — corp dividend multiplier',                                      next: [12, 3, 8] },
        12: { name: 'The Longest Summer',     reward: 'SF12 — start with $1t, 2500 hacking, best augs',                      next: [1, 4, 8] },
        13: { name: 'They\'re lunatics',      reward: 'SF13 — stanek\'s gift (passive multipliers)',                          next: [12, 4, 10] },
    };

    const BN_TIPS = {
        1:  ['Standard BN — all mechanics available', 'Good starting point, no restrictions'],
        2:  ['Gang is automatic — no karma needed', 'Get The Red Pill from gang faction to finish', 'Territory = rep multiplier = aug access'],
        3:  ['Corporation is the main mechanic', 'Hacking multipliers are reduced', 'Corp + stocks = primary income'],
        4:  ['Singularity functions cost extra RAM', 'Automation scripts cost more to run', 'SF4 pays back RAM cost many times over'],
        5:  ['NFG is cheaper — buy many levels', 'Good BN for augment stacking before Daedalus'],
        6:  ['Bladeburner is the main progression path', 'Hacking income is severely reduced', 'Join Bladeburner ASAP after starting'],
        7:  ['Same as BN6 but harder', 'Bladeburner stats matter more here'],
        8:  ['Hacking income is ZERO', 'Stocks are your only income source', 'Run stock trader immediately, nothing else matters early'],
        9:  ['Hacknet servers generate hashes', 'Hashes can be spent on corp research or other bonuses', 'Good BN for passive income'],
        10: ['Sleeves are the main mechanic', 'More sleeve levels = more sleeves (up to 30 total)', 'Stack sleeves on faction work for massive rep gain'],
        11: ['Corporation dividends are the goal', 'Long BN but very profitable'],
        12: ['Start with massive advantages', 'Rush Daedalus and install 30 augs quickly', 'Best BN to farm NFG levels'],
        13: ['Stanek\'s Gift gives passive multipliers', 'Place stanek fragments carefully — layout matters', 'Time-gated — runs for a set duration'],
    };

    // ─── SF recommendations ───────────────────────────────────────────────────
    const SF_PRIORITY = {
        desc: [
            { sf: 4,  reason: 'Automation — singularity functions save enormous time every run' },
            { sf: 1,  reason: 'RAM/cores — faster scripts, more batching threads' },
            { sf: 2,  reason: 'Gang — early gang creation, massive income and rep boost' },
            { sf: 5,  reason: 'NFG cheaper — augment stacking more affordable' },
            { sf: 10, reason: 'Sleeves — passive faction work, karma farming, income' },
            { sf: 8,  reason: 'Stocks — guaranteed profitable trading in all future BNs' },
            { sf: 12, reason: 'Endgame — start each BN with $1t and 2500 hacking' },
        ]
    };

    // ─── Stock stage ──────────────────────────────────────────────────────────
    function getStockStage() {
        try {
            if (!ns.stock.hasWseAccount())    return 'locked';
            if (!ns.stock.hasTixApiAccess())  return 'basic';
            if (!ns.stock.has4SData())        return 'advanced';
            if (!ns.stock.has4SDataTixApi())  return 'pre-optimal';
            const val = getStockValue();
            if (val < 1e9) return 'growing';
            return 'scaled';
        } catch { return 'locked'; }
    }

    function getStockValue() {
        let val = 0;
        try {
            for (const sym of ns.stock.getSymbols()) {
                const [lng, , shrt, shrtAvg] = ns.stock.getPosition(sym);
                const price = ns.stock.getPrice(sym);
                if (lng  > 0) val += lng  * price;
                if (shrt > 0) val += shrt * (shrtAvg * 2 - price);
            }
        } catch { }
        return val;
    }

    // ─── Progress scoring ─────────────────────────────────────────────────────
    function getProgressScore(player, mults, augs) {
        let score = 0;
        score += player.money / 1e9;
        score += player.skills.hacking / 500;
        score += augs * 2;
        score *= (mults.ScriptHackMoney ?? 1);
        return score;
    }

    function detectStage(score) {
        if (score < 10) return 'early';
        if (score < 40) return 'mid';
        return 'late';
    }

    function detectBottleneck(player, augs, factions) {
        if (player.money < 1e9)          return 'money';
        if (player.skills.hacking < 500) return 'hacking';
        if (factions.length < 3)         return 'factions';
        if (augs < 12)                   return 'augs';
        return 'progression';
    }

    // ─── Mechanic unlock detection ────────────────────────────────────────────
    function getUnlockedMechanics(ownedSF, bn) {
        return {
            gang:        bn === 2 || (ownedSF[2] ?? 0) > 0,
            sleeves:     bn === 10 || (ownedSF[10] ?? 0) > 0,
            bladeburner: bn === 6 || bn === 7 || (ownedSF[6] ?? 0) > 0,
            corporation: bn === 3 || (ownedSF[3] ?? 0) > 0,
            hacknet:     bn === 9 || (ownedSF[9] ?? 0) > 0,
            stanek:      bn === 13 || (ownedSF[13] ?? 0) > 0,
        };
    }

    // ─── Strategy engine ──────────────────────────────────────────────────────
    function buildStrategy(ns, context) {
        const { bn, stage, player, augs, factions, karma, mults, ownedSF, mechanics } = context;
        const tips = [];

        const add = (text, priority, color = C.white) =>
            tips.push({ text: col(color, text), priority });

        const bottleneck = detectBottleneck(player, augs, factions);
        const stockStage = getStockStage();

        // ── Infrastructure ────────────────────────────────────────────────────
        const hasOrchestrator = ns.fileExists('orchestrator.js', 'home');
        const pservCount      = (() => { try { return ns.cloud.getServerNames().length; } catch { return 0; } })();

        if (!hasOrchestrator)     add('▶ Start batching — orchestrator.js not running', 95, C.bred);
        if (pservCount < 8)       add(`▶ Buy more pservs (${pservCount}/25)`, 85, C.yellow);

        // ── Bottleneck ────────────────────────────────────────────────────────
        if (bottleneck === 'money')       add('💰 Focus income — batching, stocks, gang', 100, C.byellow);
        if (bottleneck === 'hacking')     add('🧠 Train hacking — unlock higher-tier servers', 95, C.byellow);
        if (bottleneck === 'factions')    add('🤝 Join more factions for aug access', 90, C.byellow);
        if (bottleneck === 'augs')        add(`💉 Buy more augs (${augs}) before reset`, 90, C.byellow);

        // ── Stocks ────────────────────────────────────────────────────────────
        if (bn !== 8) {
            // in BN8 stocks are mandatory and handled separately
            if (stockStage === 'locked')       add('📈 Buy WSE account ($200m)', 80, C.cyan);
            else if (stockStage === 'basic')   add('📈 Unlock TIX API ($5b)', 85, C.cyan);
            else if (stockStage === 'advanced') add('📈 Buy 4S data ($1b)', 90, C.cyan);
            else if (stockStage === 'pre-optimal') add('📈 Buy 4S TIX API ($25b)', 95, C.cyan);
        }

        // ── Gang ──────────────────────────────────────────────────────────────
        if (mechanics.gang) {
            try {
                const inGang = ns.gang.inGang();
                if (!inGang) {
                    if (bn === 2) {
                        add('🔫 Gang available automatically — create via Factions tab', 100, C.bgreen);
                    } else if (karma > -54000) {
                        add(`🔫 Farm karma for gang (${karma.toFixed(0)} / -54000)`, 100, C.yellow);
                    } else {
                        add('🔫 Karma ready — create gang NOW via Factions tab', 100, C.bgreen);
                    }
                }
            } catch { }
        }

        // ── Sleeves ───────────────────────────────────────────────────────────
        if (mechanics.sleeves) {
            add('🧬 Use sleeves: faction work + karma farming + crime', 90, C.cyan);
        }

        // ── Bladeburner ───────────────────────────────────────────────────────
        if (mechanics.bladeburner) {
            add('⚔ Join Bladeburner ASAP — main progression in this BN', 100, C.bred);
        }

        // ── BN-specific ───────────────────────────────────────────────────────
        if (bn === 8) {
            add('⚠ BN8: Hacking income = $0 — stocks are your ONLY income', 110, C.bred);
            add('📈 Run stock-trader.js immediately — nothing else matters early', 110, C.bred);
        }

        if (bn === 2) {
            add('🎯 Get The Red Pill from Slum Snakes to finish BN2', 85, C.bgreen);
            add('🏴 Territory = rep multiplier — push to 100% for max aug access', 80, C.cyan);
        }

        if (bn === 12) {
            add('⚡ Rush Daedalus immediately — you start with 2500 hacking', 100, C.bgreen);
            add('💊 Stack NFG levels — they\'re affordable here', 90, C.cyan);
        }

        // ── Late game ─────────────────────────────────────────────────────────
        if (stage === 'late') {
            if (!factions.includes('Daedalus'))
                add('🏛 Work toward Daedalus (30 augs / $100b / 2500 hack)', 95, C.byellow);
            if (!factions.includes('The Covenant'))
                add('🔺 Work toward The Covenant (20 augs / $75b)', 80, C.yellow);
            if (!factions.includes('Illuminati'))
                add('🔺 Work toward Illuminati (30 augs / $150b / 1500 hack)', 75, C.yellow);
        }

        // ── Pre-reset checklist ───────────────────────────────────────────────
        if (augs >= 10 || stage === 'late') {
            const stockVal = getStockValue();
            tips.push({ text: col(C.bcyan, bold('─── PRE-RESET CHECKLIST ───')), priority: 70 });

            if (!factions.includes('Daedalus') && stage === 'late')
                tips.push({ text: `  ${col(C.bred, '⬜')} Join Daedalus before reset`, priority: 85 });

            if (stockVal > 1e9)
                tips.push({ text: `  ${col(C.yellow, '⬜')} Sell all stocks (${fmt(stockVal)}) — run: sell`, priority: 80 });

            tips.push({ text: `  ${col(C.yellow, '⬜')} Solve remaining contracts — run: contracts`, priority: 75 });
            tips.push({ text: `  ${col(C.yellow, '⬜')} Buy augments most expensive first — run: augmgr`, priority: 90 });
            tips.push({ text: `  ${col(C.yellow, '⬜')} Install augments and destroy BN`, priority: 65 });
        }

        tips.sort((a, b) => b.priority - a.priority);
        return tips.map(t => t.text);
    }

    // ─── Next BN recommendations ──────────────────────────────────────────────
    function getNextBNRecommendations(ownedSF, bn) {
        const recs = SF_PRIORITY.desc
            .filter(r => (ownedSF[r.sf] ?? 0) === 0)
            .slice(0, 3);

        if (recs.length === 0) return ['All priority SFs owned — farm levels or go BN12'];

        return recs.map(r => {
            const info = BN_INFO[r.sf];
            return `BN${r.sf} ${info?.name ?? ''} — ${r.reason}`;
        });
    }

    let cycle = 0;

    // ─── Main loop ────────────────────────────────────────────────────────────
    while (true) {
        cycle++;

        const player    = ns.getPlayer();
        const resetInfo = ns.getResetInfo();
        const bn        = resetInfo.currentNode;

        const sfRaw  = ns.singularity.getOwnedSourceFiles();
        const ownedSF = {};
        for (const sf of sfRaw) ownedSF[sf.n] = sf.lvl;

        const mults    = ns.getBitNodeMultipliers();
        const augs     = ns.singularity.getOwnedAugmentations(false).length;
        const karma    = ns.heart.break();
        const factions = player.factions ?? [];
        const score    = getProgressScore(player, mults, augs);
        const stage    = detectStage(score);
        const mechanics = getUnlockedMechanics(ownedSF, bn);

        const bnInfo   = BN_INFO[bn] ?? { name: 'Unknown', reward: '?', next: [] };
        const bnTips   = BN_TIPS[bn] ?? [];
        const strategy = buildStrategy(ns, { bn, stage, player, augs, factions, karma, mults, ownedSF, mechanics });
        const nextBNs  = getNextBNRecommendations(ownedSF, bn);

        const stockVal   = getStockValue();
        const stockStage = getStockStage();

        // ── Write advisor state ───────────────────────────────────────────────
        ns.write('advisor-state.txt', JSON.stringify({
            updatedAt:        Date.now(),
            bn,
            bnName:           bnInfo.name,
            stage,
            karma,
            augs,
            cash:             player.money,
            hacking:          player.skills.hacking,
            factions,
            mechanics,
            mults: {
                hackMoney:      mults.ScriptHackMoney    ?? 1,
                hackExp:        mults.HackExpGain        ?? 1,
                crimeMoney:     mults.CrimeMoney         ?? 1,
                crimeSuccess:   mults.CrimeSuccess       ?? 1,
                repGain:        mults.FactionWorkRepGain ?? 1,
                augCost:        mults.AugmentationMoneyCost ?? 1,
            },
        }), 'w');

        // ── Display ───────────────────────────────────────────────────────────
        ns.clearLog();

        ns.print(`${header('🧭 BITNODE ADVISOR')}  ${dim(`Cycle: ${cycle}`)}`);
        ns.print(divider());

        // current BN
        ns.print(`  ${label('BitNode:')}   ${col(C.bwhite, `BN${bn}`)}  ${col(C.byellow, bnInfo.name)}`);
        ns.print(`  ${label('Reward:')}    ${col(C.bgreen, bnInfo.reward)}`);
        ns.print(`  ${label('Stage:')}     ${col(C.bcyan,  stage.toUpperCase())}`);
        ns.print(divider());

        // player snapshot
        ns.print(header('  📊 SNAPSHOT'));
        ns.print(`  ${label('Cash:')}      ${col(C.bwhite, fmt(player.money))}`);
        ns.print(`  ${label('Hacking:')}   ${col(C.bwhite, String(player.skills.hacking))}`);
        ns.print(`  ${label('Augs:')}      ${col(C.bwhite, String(augs))}  ${dim('(this run, excl. NFG)')}`);
        ns.print(`  ${label('Karma:')}     ${col(karma <= -54000 ? C.bgreen : C.yellow, karma.toFixed(0))}`);
        ns.print(`  ${label('Stocks:')}    ${fmt(stockVal)}  ${dim(`[${stockStage}]`)}`);
        ns.print(`  ${label('Factions:')}  ${factions.length > 0 ? factions.slice(0, 4).join(', ') + (factions.length > 4 ? ` +${factions.length-4}` : '') : dim('none')}`);
        ns.print(divider());

        // unlocked mechanics
        ns.print(header('  🔧 MECHANICS'));
        const mechList = Object.entries(mechanics)
            .map(([k, v]) => v ? col(C.bgreen, `✅ ${k}`) : col(C.dim, `❌ ${k}`));
        ns.print(`  ${mechList.join('  ')}`);
        ns.print(divider());

        // BN-specific notes
        if (bnTips.length > 0) {
            ns.print(header(`  📋 BN${bn} NOTES`));
            for (const tip of bnTips) ns.print(`  ${dim('•')} ${tip}`);
            ns.print(divider());
        }

        // strategy tips
        ns.print(header('  🎯 STRATEGY'));
        for (const tip of strategy) ns.print(`  ${tip}`);
        ns.print(divider());

        // BN multipliers
        ns.print(header('  ⚙ BN MULTIPLIERS'));
        ns.print(`  ${label('Hack$:')}    ${col(mults.ScriptHackMoney >= 0.8 ? C.bgreen : C.bred, `${((mults.ScriptHackMoney??1)*100).toFixed(0)}%`)}  ` +
                 `${label('Crime$:')}   ${col(mults.CrimeMoney >= 0.8 ? C.bgreen : C.bred, `${((mults.CrimeMoney??1)*100).toFixed(0)}%`)}  ` +
                 `${label('Rep:')}      ${col(mults.FactionWorkRepGain >= 0.8 ? C.bgreen : C.bred, `${((mults.FactionWorkRepGain??1)*100).toFixed(0)}%`)}`);
        ns.print(`  ${label('AugCost:')} ${col(mults.AugmentationMoneyCost <= 1.2 ? C.bgreen : C.bred, `${((mults.AugmentationMoneyCost??1)*100).toFixed(0)}%`)}  ` +
                 `${label('HackExp:')}  ${col(mults.HackExpGain >= 0.8 ? C.bgreen : C.bred, `${((mults.HackExpGain??1)*100).toFixed(0)}%`)}`);
        ns.print(divider());

        // next BN recommendations
        ns.print(header('  🗺 NEXT BN RECOMMENDATIONS'));
        for (const rec of nextBNs) {
            ns.print(`  ${col(C.byellow, '→')} ${rec}`);
        }
        ns.print(divider());

        // owned SFs
        ns.print(header('  🏆 OWNED SOURCE FILES'));
        const sfDisplay = Object.entries(ownedSF)
            .sort((a,b) => Number(a[0]) - Number(b[0]))
            .map(([n, lvl]) => `SF${n}.${lvl}`)
            .join('  ');
        ns.print(`  ${col(C.bgreen, sfDisplay || 'none')}`);

        ns.print(divider());
        ns.print(`  ${dim(`Refreshes every ${LOOP_MS/1000}s — state written to advisor-state.txt`)}`);

        await ns.sleep(LOOP_MS);
    }
}