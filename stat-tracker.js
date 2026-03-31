/**
 * stat-tracker.js — Tracks key stats over time with rate of change
 * Monitors: money/hr, hacking XP/hr, rep/hr per faction,
 * stock portfolio growth, gang income, intelligence XP
 *
 * Usage: run stat-tracker.js
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('📊 Stat Tracker');

    const SAMPLE_MS    = 5_000;   // sample every 5s
    const DISPLAY_MS   = 15_000;  // refresh display every 15s
    const HISTORY_LEN  = 720;     // keep 1 hour of samples at 5s intervals
    const RATE_WINDOW  = 60;      // calculate rate over last 60 samples (5 min)

    const fmt = (n) => {
        if (Math.abs(n) >= 1e12) return `$${(n/1e12).toFixed(2)}t`;
        if (Math.abs(n) >= 1e9)  return `$${(n/1e9).toFixed(2)}b`;
        if (Math.abs(n) >= 1e6)  return `$${(n/1e6).toFixed(2)}m`;
        if (Math.abs(n) >= 1e3)  return `$${(n/1e3).toFixed(2)}k`;
        return `$${n.toFixed(0)}`;
    };

    const fmtRate = (n, unit = '/hr') => {
        const hr = n * (3600 / (SAMPLE_MS / 1000));
        return `${fmt(hr)}${unit}`;
    };

    // ─── Sample history ───────────────────────────────────────────────────────
    const history = {
        timestamps:    [],
        cash:          [],
        hackXp:        [],
        strXp:         [],
        defXp:         [],
        dexXp:         [],
        agiXp:         [],
        intelXp:       [],
        portfolio:     [],
        gangMoney:     [],
        factionRep:    {}, // per faction
    };

    function addSample() {
        const player    = ns.getPlayer();
        const now       = Date.now();

        history.timestamps.push(now);
        history.cash.push(player.money);
        history.hackXp.push(player.exp.hacking ?? 0);
        history.strXp.push(player.exp.strength ?? 0);
        history.defXp.push(player.exp.defense ?? 0);
        history.dexXp.push(player.exp.dexterity ?? 0);
        history.agiXp.push(player.exp.agility ?? 0);
        history.intelXp.push(player.exp.intelligence ?? 0);

        // portfolio
        let portfolio = player.money;
        try {
            for (const sym of ns.stock.getSymbols()) {
                const [lng, lngAvg, shrt, shrtAvg] = ns.stock.getPosition(sym);
                const price = ns.stock.getPrice(sym);
                if (lng  > 0) portfolio += lng  * price;
                if (shrt > 0) portfolio += shrt * (shrtAvg * 2 - price);
            }
        } catch { }
        history.portfolio.push(portfolio);

        // gang income
        let gangIncome = 0;
        try {
            if (ns.gang.inGang()) gangIncome = ns.gang.getGangInformation().moneyGainRate;
        } catch { }
        history.gangMoney.push(gangIncome);

        // faction rep snapshots
        try {
            for (const faction of player.factions) {
                if (!history.factionRep[faction]) history.factionRep[faction] = [];
                history.factionRep[faction].push(ns.singularity.getFactionRep(faction));
            }
        } catch { }

        // trim to history length
        const trim = (arr) => { while (arr.length > HISTORY_LEN) arr.shift(); };
        trim(history.timestamps);
        trim(history.cash);
        trim(history.hackXp);
        trim(history.strXp);
        trim(history.defXp);
        trim(history.dexXp);
        trim(history.agiXp);
        trim(history.intelXp);
        trim(history.portfolio);
        trim(history.gangMoney);
        for (const f of Object.keys(history.factionRep)) trim(history.factionRep[f]);
    }

    function getRate(arr) {
        if (arr.length < 2) return 0;
        const window  = Math.min(RATE_WINDOW, arr.length - 1);
        const recent  = arr[arr.length - 1];
        const past    = arr[arr.length - 1 - window];
        return recent - past;
    }

    function getRatePerHour(arr) {
        if (arr.length < 2) return 0;
        const window    = Math.min(RATE_WINDOW, arr.length - 1);
        const recent    = arr[arr.length - 1];
        const past      = arr[arr.length - 1 - window];
        const deltaTime = window * (SAMPLE_MS / 1000); // seconds
        const delta     = recent - past;
        return (delta / deltaTime) * 3600; // per hour
    }

    let cycle        = 0;
    let lastDisplay  = 0;

    // ─── Main loop ────────────────────────────────────────────────────────────
    while (true) {
        addSample();
        cycle++;

        const now = Date.now();
        if (now - lastDisplay >= DISPLAY_MS) {
            lastDisplay = now;
            const player     = ns.getPlayer();
            const samples    = history.cash.length;
            const windowMins = Math.min(samples * SAMPLE_MS / 60000, RATE_WINDOW * SAMPLE_MS / 60000).toFixed(1);

            // rates per hour
            const cashRate      = getRatePerHour(history.cash);
            const portfolioRate = getRatePerHour(history.portfolio);
            const hackXpRate    = getRatePerHour(history.hackXp);
            const strXpRate     = getRatePerHour(history.strXp);
            const intelXpRate   = getRatePerHour(history.intelXp);

            // gang income is already a rate
            const gangRate = history.gangMoney.length > 0
                ? history.gangMoney[history.gangMoney.length - 1] * 3600
                : 0;

            // stock-only income (portfolio minus cash change)
            const stockRate = portfolioRate - cashRate;

            ns.clearLog();
            ns.print('📊 STAT TRACKER');
            ns.print('─'.repeat(56));
            ns.print(`  Samples: ${samples}  Window: ${windowMins}min  Cycle: ${cycle}`);

            ns.print('─'.repeat(56));
            ns.print('  💰 INCOME:');
            ns.print(`  Cash/hr:       ${fmt(cashRate)}`);
            ns.print(`  Portfolio/hr:  ${fmt(portfolioRate)}`);
            ns.print(`  Stocks/hr:     ${fmt(stockRate)}  (est)`);
            ns.print(`  Gang/hr:       ${fmt(gangRate)}`);
            const hackingIncome = cashRate - gangRate;
            ns.print(`  Hacking/hr:    ${fmt(Math.max(0, hackingIncome))}  (est)`);

            ns.print('─'.repeat(56));
            ns.print('  🧠 EXPERIENCE/HR:');
            ns.print(`  Hacking:   ${fmt(hackXpRate)} xp`);
            ns.print(`  Strength:  ${fmt(getRatePerHour(history.strXp))} xp`);
            ns.print(`  Defense:   ${fmt(getRatePerHour(history.defXp))} xp`);
            ns.print(`  Dexterity: ${fmt(getRatePerHour(history.dexXp))} xp`);
            ns.print(`  Agility:   ${fmt(getRatePerHour(history.agiXp))} xp`);

            if (player.skills.intelligence > 0) {
                ns.print(`  Intel:     ${fmt(intelXpRate)} xp  (level: ${player.skills.intelligence})`);
            }

            // current stats
            ns.print('─'.repeat(56));
            ns.print('  📈 CURRENT STATS:');
            ns.print(`  Cash:      ${fmt(player.money)}`);
            ns.print(`  Portfolio: ${fmt(history.portfolio[history.portfolio.length-1] ?? 0)}`);
            ns.print(`  Hacking:   ${player.skills.hacking}`);
            ns.print(`  Min combat:${Math.min(player.skills.strength, player.skills.defense, player.skills.dexterity, player.skills.agility)}`);

            // top faction rep rates
            const factionRates = [];
            try {
                for (const [faction, reps] of Object.entries(history.factionRep)) {
                    if (reps.length < 2) continue;
                    const rate = getRatePerHour(reps);
                    if (rate > 0) factionRates.push({ faction, rate });
                }
                factionRates.sort((a,b) => b.rate - a.rate);
            } catch { }

            if (factionRates.length > 0) {
                ns.print('─'.repeat(56));
                ns.print('  🏛 FACTION REP/HR:');
                for (const { faction, rate } of factionRates.slice(0, 5)) {
                    ns.print(`  ${faction.padEnd(28)} +${fmt(rate).replace('$','')}`);
                }
            }

            ns.print('─'.repeat(56));
            ns.print('  Refreshes every 15s  (rates over last 5min)');
        }

        await ns.sleep(SAMPLE_MS);
    }
}