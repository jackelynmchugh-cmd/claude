/**
 * stock-manipulator.js — Stock price manipulation via hack/grow
 *
 * - Pumps long positions by growing their linked servers
 * - Dumps short positions by hacking their linked servers
 * - Auto-detects positions from the stock trader
 * - Spreads workers across all rooted servers
 *
 * Usage: run stock-manipulator.js
 * Compatible with Bitburner 3.0 API.
 */

const STOCK_MAP = {
    'ecorp':            'ECP',
    'megacorp':         'MGCP',
    'blade':            'BLD',
    'clarkinc':         'CLRK',
    'omnitek':          'OMTK',
    'four-sigma':       'FSIG',
    'kuai-gong':        'KGI',
    'fulcrumtech':      'FLCM',
    'stormtech':        'STM',
    'defcomm':          'DCOMM',
    'helios':           'HLS',
    'vitalife':         'VITA',
    'icarus':           'ICRS',
    'univ-energy':      'UNV',
    'aerocorp':         'AERO',
    'omnia':            'OMN',
    'solaris':          'SLRS',
    'deltaone':         'DELT',
    'global-pharm':     'GPH',
    'nova-med':         'NVMD',
    'lexo-corp':        'LXO',
    'rho-construction': 'RHOC',
    'alpha-ent':        'APHE',
    'syscore':          'SYSC',
    'comptek':          'CTYS',
    'netlink':          'NTLK',
    'omega-net':        'OMGA',
    'foodnstuff':       'FSIG',
    'joesguns':         'JGN',
    'sigma-cosmetics':  'SGC',
    'catalyst':         'CTYS',
    'zer0':             'ZERO',
};

const SYMBOL_TO_SERVER = {};
for (const [server, sym] of Object.entries(STOCK_MAP)) {
    SYMBOL_TO_SERVER[sym] = server;
}

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('🎲 Stock Manipulator');

    const LOOP_SLEEP       = 5000;
    const GROW_SCRIPT      = 'grow-only.js';
    const HACK_SCRIPT      = 'hack-only.js';
    const RAM_BUFFER       = 2;
    const HOME_RAM_RESERVE = 32;

    const formatMoney = (n) => {
        if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(3)}t`;
        if (Math.abs(n) >= 1e9)  return `$${(n / 1e9).toFixed(3)}b`;
        if (Math.abs(n) >= 1e6)  return `$${(n / 1e6).toFixed(3)}m`;
        if (Math.abs(n) >= 1e3)  return `$${(n / 1e3).toFixed(3)}k`;
        return `$${n.toFixed(2)}`;
    };

    function has4S() {
        return ns.stock.has4SDataTixApi();
    }

    function getAllRootedServers() {
        const visited = new Set(['home']);
        const queue   = ['home'];
        const result  = [];

        while (queue.length) {
            const host = queue.shift();
            for (const n of ns.scan(host)) {
                if (visited.has(n)) continue;
                visited.add(n);
                queue.push(n);
                if (ns.hasRootAccess(n)) result.push(n);
            }
        }

        result.unshift('home');
        return result;
    }

    function getFreeRam(host) {
        const max     = ns.getServerMaxRam(host);
        const used    = ns.getServerUsedRam(host);
        const reserve = host === 'home' ? HOME_RAM_RESERVE : RAM_BUFFER;
        return Math.max(0, max - used - reserve);
    }

    function dispatch(workers, script, target, totalThreads) {
        let remaining = totalThreads;
        const cost    = ns.getScriptRam(script);
        let placed    = 0;

        for (const host of workers) {
            if (remaining <= 0) break;
            const free    = getFreeRam(host);
            const threads = Math.min(Math.floor(free / cost), remaining);
            if (threads <= 0) continue;

            if (!ns.fileExists(script, host)) ns.scp(script, host, 'home');

            const pid = ns.exec(script, host, threads, target);
            if (pid > 0) {
                placed    += threads;
                remaining -= threads;
            }
        }

        return placed;
    }

    function getCurrentPositions() {
        const longs  = [];
        const shorts = [];

        for (const sym of ns.stock.getSymbols()) {
            const [lng, , shrt] = ns.stock.getPosition(sym);
            if (lng  > 0) longs.push(sym);
            if (shrt > 0) shorts.push(sym);
        }

        return { longs, shorts };
    }

    function getLinkedServer(sym) {
        return SYMBOL_TO_SERVER[sym] ?? null;
    }

    function serverIsValid(host) {
        if (!host) return false;
        try {
            if (!ns.hasRootAccess(host))                   return false;
            if (ns.getServerMaxRam(host) < 2)              return false;
            if (ns.getServerRequiredHackingLevel(host) >
                ns.getHackingLevel())                      return false;
            return true;
        } catch { return false; }
    }

    let cycle      = 0;
    let totalGrows = 0;
    let totalHacks = 0;

    while (true) {
        cycle++;
        ns.clearLog();

        const using4S               = has4S();
        const workers               = getAllRootedServers();
        const { longs, shorts }     = getCurrentPositions();
        const actions               = [];

        // ── Pump longs ────────────────────────────────────────────────────────
        const longTargets = [];
        for (const sym of longs) {
            const server = getLinkedServer(sym);
            if (!serverIsValid(server)) continue;

            const moneyMax = ns.getServerMaxMoney(server);
            const moneyNow = ns.getServerMoneyAvailable(server);
            const growMult = moneyMax / Math.max(moneyNow, 1);
            const threads  = Math.max(1, Math.ceil(ns.growthAnalyze(server, growMult)));
            const placed   = dispatch(workers, GROW_SCRIPT, server, threads);

            if (placed > 0) {
                totalGrows++;
                actions.push(`🟢 GROW  ${server.padEnd(20)} → ${sym.padEnd(5)} ${placed} threads`);
            }

            longTargets.push({ sym, server, threads, placed });
        }

        // ── Dump shorts ───────────────────────────────────────────────────────
        const shortTargets = [];
        for (const sym of shorts) {
            const server = getLinkedServer(sym);
            if (!serverIsValid(server)) continue;

            const hackPct = ns.hackAnalyze(server);
            const threads = hackPct > 0
                ? Math.max(1, Math.floor(0.90 / hackPct))
                : 1;
            const placed  = dispatch(workers, HACK_SCRIPT, server, threads);

            if (placed > 0) {
                totalHacks++;
                actions.push(`🔴 HACK  ${server.padEnd(20)} → ${sym.padEnd(5)} ${placed} threads`);
            }

            shortTargets.push({ sym, server, threads, placed });
        }

        // ── Display ───────────────────────────────────────────────────────────
        ns.print(`🎲 STOCK MANIPULATOR  [${using4S ? '4S' : 'NO 4S'}]`);
        ns.print('─'.repeat(56));
        ns.print(`  Cycle:       ${cycle}`);
        ns.print(`  Workers:     ${workers.length} rooted servers`);
        ns.print(`  Long pumps:  ${totalGrows}  Short dumps: ${totalHacks}`);
        ns.print('─'.repeat(56));

        if (longTargets.length > 0) {
            ns.print('  PUMPING LONGS:');
            for (const { sym, server, placed } of longTargets) {
                const price         = ns.stock.getPrice(sym);
                const [lng, lngAvg] = ns.stock.getPosition(sym);
                const pl            = (price - lngAvg) * lng;
                const sign          = pl >= 0 ? '+' : '';
                const fc            = using4S ? ` fc:${(ns.stock.getForecast(sym) * 100).toFixed(0)}%` : '';
                ns.print(`  ${sym.padEnd(6)} ← ${server.padEnd(20)} threads:${placed}${fc} P/L:${sign}${formatMoney(pl)}`);
            }
        } else {
            ns.print('  No long positions to pump');
        }

        ns.print('─'.repeat(56));

        if (shortTargets.length > 0) {
            ns.print('  DUMPING SHORTS:');
            for (const { sym, server, placed } of shortTargets) {
                const price             = ns.stock.getPrice(sym);
                const [,,shrt, shrtAvg] = ns.stock.getPosition(sym);
                const pl                = (shrtAvg - price) * shrt;
                const sign              = pl >= 0 ? '+' : '';
                const fc                = using4S ? ` fc:${(ns.stock.getForecast(sym) * 100).toFixed(0)}%` : '';
                ns.print(`  ${sym.padEnd(6)} ← ${server.padEnd(20)} threads:${placed}${fc} P/L:${sign}${formatMoney(pl)}`);
            }
        } else {
            ns.print('  No short positions to dump');
        }

        if (actions.length > 0) {
            ns.print('─'.repeat(56));
            ns.print('  THIS CYCLE:');
            for (const a of actions) ns.print(`  ${a}`);
        }

        if (longTargets.length === 0 && shortTargets.length === 0) {
            ns.print('─'.repeat(56));
            ns.print('  ⏳ No positions open — waiting for trader to buy...');
        }

        await ns.sleep(LOOP_SLEEP);
    }
}