/**
 * corp-manager.js — Main corp controller
 *
 * RAM: ~45GB (reads + exec + ps)
 *
 * Phases:
 *   1 — Agriculture bootstrap → investor round 1 ($210b+)
 *   2 — Expand Agriculture → investor round 2 ($5t+)
 *   3 — Tobacco + dummies + products → IPO ($1q+)
 *
 * Usage: run corp-manager.js
 */

const LOOP_SLEEP      = 5_000;
const ACTION_INTERVAL = 30_000;
const ALL_CITIES      = ['Aevum', 'Chongqing', 'Sector-12', 'New Tokyo', 'Ishima', 'Volhaven'];
const MAIN_CITY       = 'Aevum';
const DUMMY_DIVS      = ['Noodle Bar', 'Quick Bites', 'Street Eats'];
const WORKER_SCRIPTS  = ['corp-actions.js', 'corp-products.js'];

// ─── ANSI colors ──────────────────────────────────────────────────────────────
const R     = '\u001b[0m';
const BOLD  = '\u001b[1m';
const DIM   = '\u001b[2m';
const RED   = '\u001b[31m';
const GREEN = '\u001b[32m';
const GOLD  = '\u001b[33m';
const CYAN  = '\u001b[36m';
const WHITE = '\u001b[97m';
const GRAY  = '\u001b[90m';

const STATE_COLOR = {
    START:      '\u001b[32m',
    PURCHASE:   '\u001b[36m',
    PRODUCTION: '\u001b[33m',
    EXPORT:     '\u001b[35m',
    SALE:       '\u001b[34m',
};

const PHASE_LABEL = {
    1: '🌾  Agriculture Bootstrap',
    2: '🌾  Expand Agriculture',
    3: '🚬  Tobacco & Products',
};

// ─── Read helpers ─────────────────────────────────────────────────────────────

const hasCorp   = ns => { try { ns.corporation.getCorporation(); return true; } catch { return false; } };
const funds     = ns => ns.corporation.getCorporation().funds;
const nextState = ns => ns.corporation.getCorporation().nextState;
const isPublic  = ns => ns.corporation.getCorporation().public;
const valuation = ns => ns.corporation.getCorporation().valuation;

function getDivByType(ns, type) {
    try {
        for (const name of ns.corporation.getCorporation().divisions) {
            try { if (ns.corporation.getDivision(name).type === type) return name; } catch {}
        }
    } catch {}
    return null;
}

function hasDivision(ns, name) {
    try { return ns.corporation.getCorporation().divisions.includes(name); } catch { return false; }
}

function getOfficeSize(ns, div, city) {
    try { return ns.corporation.getOffice(div, city).size; } catch { return 0; }
}

function hasUnlock(ns, name) {
    try { return ns.corporation.hasUnlock(name); } catch { return false; }
}

function anyWorkerRunning(ns) {
    try {
        const procs = ns.ps('home');
        return WORKER_SCRIPTS.some(s => procs.some(p => p.filename === s));
    } catch { return false; }
}

function spawn(ns, script, ...args) {
    if (!ns.fileExists(script, 'home')) return false;
    if (ns.isRunning(script, 'home', ...args)) return false;
    const pid = ns.exec(script, 'home', 1, ...args);
    return pid > 0;
}

// ─── Phase actions ────────────────────────────────────────────────────────────

function phase1Action(ns, agri) {
    return JSON.stringify({
        phase: 1, agri,
        unlocks: ['Smart Supply'],
        setup: [agri],
        staff: [{ div: agri, size: 9 }],
        sell: [{ div: agri, mats: ['Food', 'Plants'] }],
        warehouses: ALL_CITIES.map(c => ({ div: agri, city: c, level: 3 })),
        upgrades: true,
    });
}

function phase2Action(ns, agri) {
    return JSON.stringify({
        phase: 2, agri,
        unlocks: ['Export'],
        staff: [{ div: agri, size: 18 }],
        warehouses: ALL_CITIES.map(c => ({ div: agri, city: c, level: 10 })),
        upgrades: true,
        advert: [agri],
        research: [agri],
    });
}

function phase3Action(ns, agri, tobacco) {
    const mainSz  = getOfficeSize(ns, tobacco, MAIN_CITY);
    const targetSz = Math.min(mainSz + 3, 120);
    const dummies  = DUMMY_DIVS.filter(n => !hasDivision(ns, n) && funds(ns) > 80e9);
    return JSON.stringify({
        phase: 3, agri, tobacco,
        createTobacco: !getDivByType(ns, 'Tobacco'),
        setup: [tobacco],
        staff: [
            { div: tobacco, size: 9 },
            { div: tobacco, city: MAIN_CITY, size: targetSz, extraEng: 3 },
        ],
        warehouses: ALL_CITIES.map(c => ({ div: tobacco, city: c, level: 5, type: 'tobacco' })),
        export: hasUnlock(ns, 'Export') ? { agri, tobacco } : null,
        dummies,
        upgrades: true,
        advert: [agri, tobacco],
        research: [agri, tobacco],
    });
}

// ─── Display ──────────────────────────────────────────────────────────────────

function progressBar(pct, width = 20) {
    const filled = Math.floor(Math.min(pct, 100) / 100 * width);
    const empty  = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

function pad(str, len) {
    return String(str).padEnd(len);
}

function printStatus(ns, c, phase, agri, tobacco, workerRunning, nextActMs, offer) {
    const f        = n => ns.format.number(n);
    const profit   = c.revenue - c.expenses;
    const profCol  = profit >= 0 ? GREEN : RED;
    const stateCol = STATE_COLOR[c.nextState] ?? WHITE;

    ns.clearLog();

    // Header
    ns.print(`${BOLD}${CYAN}╔══════════════════════════════════════════╗${R}`);
    ns.print(`${BOLD}${CYAN}║  🏢  CORPORATION MANAGER                 ║${R}`);
    ns.print(`${BOLD}${CYAN}╚══════════════════════════════════════════╝${R}`);
    ns.print('');

    // Phase
    ns.print(`${BOLD}${WHITE}  Phase ${phase}  ${CYAN}${PHASE_LABEL[phase] ?? ''}${R}`);
    ns.print('');

    // Financials
    ns.print(`${GRAY}  ┌─ Financials ─────────────────────────────┐${R}`);
    ns.print(`${GRAY}  │${R}  ${pad('Funds', 12)}${GOLD}${BOLD}$${f(c.funds)}${R}`);
    ns.print(`${GRAY}  │${R}  ${pad('Valuation', 12)}${GOLD}$${f(c.valuation)}${R}`);
    ns.print(`${GRAY}  │${R}  ${pad('Revenue', 12)}${GREEN}$${f(c.revenue)}/s${R}`);
    ns.print(`${GRAY}  │${R}  ${pad('Expenses', 12)}${RED}$${f(c.expenses)}/s${R}`);
    ns.print(`${GRAY}  │${R}  ${pad('Profit', 12)}${profCol}${BOLD}$${f(profit)}/s${R}`);
    ns.print(`${GRAY}  └──────────────────────────────────────────┘${R}`);
    ns.print('');

    // Corp cycle state
    const actStatus = workerRunning
        ? `${GOLD}⚙ running${R}`
        : nextActMs > 0
            ? `${GRAY}next in ${Math.ceil(nextActMs / 1000)}s${R}`
            : `${GREEN}● ready${R}`;

    ns.print(`${GRAY}  ┌─ Status ──────────────────────────────────┐${R}`);
    ns.print(`${GRAY}  │${R}  ${pad('Cycle', 12)}${stateCol}${BOLD}${c.nextState}${R}`);
    ns.print(`${GRAY}  │${R}  ${pad('Actions', 12)}${actStatus}`);
    if (agri)    ns.print(`${GRAY}  │${R}  ${pad('Agri', 12)}${GREEN}✓ ${GRAY}${agri}${R}`);
    if (tobacco && tobacco !== 'Tobacco')
                 ns.print(`${GRAY}  │${R}  ${pad('Tobacco', 12)}${GREEN}✓ ${GRAY}${tobacco}${R}`);
    else if (phase < 3)
                 ns.print(`${GRAY}  │${R}  ${pad('Tobacco', 12)}${DIM}○ phase 3${R}`);
    ns.print(`${GRAY}  └──────────────────────────────────────────┘${R}`);
    ns.print('');

    // Investor offer progress bar
    if (offer && !c.public) {
        const threshold = phase === 1 ? 200e9 : 5e12;
        const pct       = Math.min(100, offer.funds / threshold * 100);
        const bar       = progressBar(pct, 24);
        const barCol    = pct >= 100 ? GREEN : GOLD;
        ns.print(`${GRAY}  ┌─ Investor Round ${offer.round} ────────────────────┐${R}`);
        ns.print(`${GRAY}  │${R}  ${pad('Offer', 12)}${GOLD}$${f(offer.funds)}${R}`);
        ns.print(`${GRAY}  │${R}  ${pad('Target', 12)}${GRAY}$${f(threshold)}${R}`);
        ns.print(`${GRAY}  │${R}  ${barCol}[${bar}] ${pct.toFixed(1)}%${R}`);
        ns.print(`${GRAY}  └──────────────────────────────────────────┘${R}`);
        ns.print('');
    }

    // IPO progress
    if (!c.public && phase === 3) {
        const ipoTarget = 1e15;
        const pct       = Math.min(100, c.valuation / ipoTarget * 100);
        const bar       = progressBar(pct, 24);
        const barCol    = pct >= 100 ? GREEN : CYAN;
        ns.print(`${GRAY}  ┌─ IPO Progress ────────────────────────────┐${R}`);
        ns.print(`${GRAY}  │${R}  ${pad('Target', 12)}${GRAY}$${f(ipoTarget)}${R}`);
        ns.print(`${GRAY}  │${R}  ${barCol}[${bar}] ${pct.toFixed(1)}%${R}`);
        ns.print(`${GRAY}  └──────────────────────────────────────────┘${R}`);
    }

    // Public
    if (c.public) {
        ns.print(`${BOLD}${GREEN}  🚀 CORPORATION IS PUBLIC${R}`);
        ns.print(`  ${pad('Share Price', 14)}${GOLD}$${f(c.sharePrice)}${R}`);
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('🏢 Corp Manager');
    ns.tprint('🏢 Corp Manager starting...');

    let phase      = 1;
    let lastAction = 0;

    while (true) {
        try {
            if (!hasCorp(ns)) {
                ns.clearLog();
                ns.print(`${RED}⚠ No corporation — create one first${R}`);
                await ns.sleep(30_000);
                continue;
            }

            const agri    = getDivByType(ns, 'Agriculture');
            const tobacco = getDivByType(ns, 'Tobacco') ?? 'Tobacco';

            if (!agri) {
                ns.clearLog();
                ns.print(`${RED}⚠ No Agriculture division — create one first${R}`);
                await ns.sleep(LOOP_SLEEP);
                continue;
            }

            // Phase detection
            if (getDivByType(ns, 'Tobacco')) phase = 3;
            else {
                try {
                    const offer = ns.corporation.getInvestmentOffer();
                    if (offer.round >= 2) phase = Math.max(phase, 2);
                } catch {}
            }

            const now     = Date.now();
            const running = anyWorkerRunning(ns);
            const nextAct = Math.max(0, ACTION_INTERVAL - (now - lastAction));

            // Spawn action worker
            if (!running && now - lastAction > ACTION_INTERVAL) {
                let action;
                if (phase === 1)      action = phase1Action(ns, agri);
                else if (phase === 2) action = phase2Action(ns, agri);
                else                  action = phase3Action(ns, agri, tobacco);

                if (spawn(ns, 'corp-actions.js', action)) lastAction = now;
            }

            // Tea on START state
            if (nextState(ns) === 'START') {
                const divs = [agri, getDivByType(ns, 'Tobacco')].filter(Boolean);
                spawn(ns, 'corp-tea.js', ...divs);
            }

            // Investor watcher
            if (phase < 3) {
                const round  = phase === 1 ? '1' : '2';
                const thresh = phase === 1 ? String(200e9) : String(5e12);
                spawn(ns, 'corp-invest.js', round, thresh);
            }

            // Products in phase 3
            if (phase === 3 && getDivByType(ns, 'Tobacco')) {
                spawn(ns, 'corp-products.js', tobacco);
            }

            // IPO
            if (!isPublic(ns) && valuation(ns) >= 1e15) {
                spawn(ns, 'corp-actions.js', JSON.stringify({ ipo: true }));
            }

            // Display
            let offer = null;
            if (phase < 3) {
                try { offer = ns.corporation.getInvestmentOffer(); } catch {}
            }
            const c = ns.corporation.getCorporation();
            printStatus(ns, c, phase, agri, tobacco, running, nextAct, offer);

        } catch (e) {
            ns.print(`${RED}⚠ ${e}${R}`);
        }

        await ns.sleep(LOOP_SLEEP);
    }
}