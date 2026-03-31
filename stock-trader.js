/**
 * stock-trader.js — v6.0
 *
 * Features:
 *  - Pre-4S: hardcoded symbol list, TIX forecast, 12-tick trend confirmation
 *  - Post-4S: full forecast + volatility filtering, dynamic symbol discovery
 *  - Forecast-scaled position sizing
 *  - Portfolio-stage-based cash reserve + position limits
 *  - Stop loss (4%) — only after stock hits +5% threshold
 *  - Trailing stop (5%) — only after +5% threshold
 *  - Profit confirmation — must hit +2%, sell if stays below for 12 ticks
 *  - Shorts support (when unlocked)
 *  - Session log written to stock-trader.txt on startup
 *
 * @param {NS} ns
 */

// ─── Pre-4S symbol whitelist ──────────────────────────────────────────────────
const PRE4S_SYMBOLS = [
    'ECP','MGCP','BLD','CLRK','OMTK','FSIG','KGI','FLCM','STM','DCOMM',
    'HLS','VITA','ICRS','UNV','AERO','OMN','SLRS','GPH','NVMD','WDS',
    'LXO','RHOC','APHE','SYSC','CTYS','MDYN','TITN','GAIA','FNS','JGN',
    'SGC','CTK','NTLK','OMGA',
];

// ─── Constants ────────────────────────────────────────────────────────────────
const LOOP_SLEEP          = 2_000;
const COMMISSION          = 100_000;
const TICK_HISTORY        = 12;
const TREND_CONFIRM_TICKS = 12;
const PROFIT_THRESHOLD    = 0.02;   // +2% to confirm position
const ACTIVATION_THRESH   = 0.05;   // +5% to activate stops
const STOP_LOSS_PCT       = 0.04;   // 4% hard stop (post-activation)
const TRAIL_PCT           = 0.05;   // 5% trailing stop (post-activation)
const SHORT_TRAIL_PCT     = 0.05;
const MAX_VOLATILITY      = 0.05;   // post-4S only
const MIN_VOLATILITY      = 0.001;  // post-4S only
const BUY_FORECAST        = 0.55;
const SHORT_FORECAST      = 0.45;
const COVER_FORECAST      = 0.50;

// Portfolio stages
const STAGES = [
    { threshold: 500e6,    reserve: 0.80, maxPos: 3 }, // early  < $500m
    { threshold: 250e9,    reserve: 0.60, maxPos: 5 }, // mid    < $250b
    { threshold: Infinity, reserve: 0.40, maxPos: 7 }, // late   > $250b
];

const LOG_FILE = 'stock-trader.txt';

// ─── ANSI ─────────────────────────────────────────────────────────────────────
const R     = '\u001b[0m';
const BOLD  = '\u001b[1m';
const DIM   = '\u001b[2m';
const GREEN = '\u001b[32m';
const RED   = '\u001b[31m';
const GOLD  = '\u001b[33m';
const CYAN  = '\u001b[36m';
const GRAY  = '\u001b[90m';
const WHITE = '\u001b[97m';

// ─── Main ─────────────────────────────────────────────────────────────────────
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('📈 Stock Trader v6.0');

    // Session log — overwrite on start
    ns.write(LOG_FILE,
        `=== Stock Trader v6.0 ===\n` +
        `Started: ${new Date().toLocaleString()}\n` +
        `Pre-4S symbols: ${PRE4S_SYMBOLS.length}\n\n`,
        'w'
    );

    function log(msg) {
        ns.write(LOG_FILE, `[${new Date().toLocaleTimeString()}] ${msg}\n`, 'a');
    }

    // ── API guards ────────────────────────────────────────────────────────────
    const has4S = () => { try { return ns.stock.has4SDataTixApi(); } catch { return false; } };

    function getVolatility(sym) {
        if (!has4S()) return null;
        try { return ns.stock.getVolatility(sym); } catch { return null; }
    }

    function getForecast(sym) {
        try { return ns.stock.getForecast(sym); } catch { return null; }
    }

    function getSymbols() {
        if (has4S()) { try { return ns.stock.getSymbols(); } catch {} }
        return PRE4S_SYMBOLS;
    }

    function hasShorts() {
        try { ns.stock.buyShort; return has4S(); } catch { return false; }
    }

    // ── Portfolio ─────────────────────────────────────────────────────────────
    function getPortfolioValue() {
        let total = ns.getPlayer().money;
        try {
            for (const sym of getSymbols()) {
                const [lng, lngAvg, shrt, shrtAvg] = ns.stock.getPosition(sym);
                const price = ns.stock.getPrice(sym);
                if (lng  > 0) total += lng  * price;
                if (shrt > 0) total += shrt * (shrtAvg * 2 - price);
            }
        } catch {}
        return total;
    }

    function getStage(pv) {
        for (const s of STAGES) if (pv < s.threshold) return s;
        return STAGES[STAGES.length - 1];
    }

    function getCash() { return ns.getPlayer().money; }

    // ── Price history + trend ─────────────────────────────────────────────────
    /** @type {Map<string, number[]>} */
    const priceHistory = new Map();

    function updateHistory(sym, price) {
        if (!priceHistory.has(sym)) priceHistory.set(sym, []);
        const h = priceHistory.get(sym);
        h.push(price);
        if (h.length > TICK_HISTORY) h.shift();
    }

    function getTrend(sym) {
        const h = priceHistory.get(sym);
        if (!h || h.length < TICK_HISTORY) return null;
        const high    = Math.max(...h);
        const low     = Math.min(...h);
        const range   = high - low;
        const current = h[h.length - 1];

        // Upper 40% of range
        const inUpperRange = range === 0 || (current - low) / range >= 0.60;

        // Majority up ticks
        let upTicks = 0;
        for (let i = 1; i < h.length; i++) if (h[i] > h[i - 1]) upTicks++;
        const mostlyUp = upTicks >= 6;

        // Rising lows: second half min >= first half min
        const risingLows = Math.min(...h.slice(6)) >= Math.min(...h.slice(0, 6));

        return { inUpperRange, mostlyUp, risingLows, upTicks, high, low, current, range };
    }

    function isUptrend(sym) {
        const t = getTrend(sym);
        return t ? (t.inUpperRange && t.mostlyUp && t.risingLows) : false;
    }

    // ── Position state ────────────────────────────────────────────────────────
    /**
     * @type {Map<string, {
     *   entryPrice: number, shares: number, isShort: boolean,
     *   highPrice: number, lowPrice: number, stopPrice: number,
     *   activated: boolean, peakReached: boolean, belowThresholdTicks: number
     * }>}
     */
    const posState = new Map();

    function initPos(sym, entryPrice, shares, isShort) {
        posState.set(sym, {
            entryPrice, shares, isShort,
            highPrice:           entryPrice,
            lowPrice:            entryPrice,
            stopPrice:           isShort
                ? entryPrice * (1 + SHORT_TRAIL_PCT)
                : entryPrice * (1 - TRAIL_PCT),
            activated:           false,
            peakReached:         false,
            belowThresholdTicks: 0,
        });
        log(`OPEN ${isShort ? 'SHORT' : 'LONG'} ${sym}: ${shares}x @ $${ns.format.number(entryPrice)}`);
    }

    function updatePos(sym, price) {
        const p = posState.get(sym);
        if (!p) return;

        const gain = p.isShort
            ? (p.entryPrice - price) / p.entryPrice
            : (price - p.entryPrice) / p.entryPrice;

        // Activate once +5% hit
        if (!p.activated && gain >= ACTIVATION_THRESH) {
            p.activated = true;
            log(`ACTIVATED stops: ${sym} (+${(gain*100).toFixed(2)}%)`);
        }

        // Update trailing stop
        if (!p.isShort) {
            if (price > p.highPrice) {
                p.highPrice = price;
                const newStop = price * (1 - TRAIL_PCT);
                if (newStop > p.stopPrice) p.stopPrice = newStop;
            }
        } else {
            if (price < p.lowPrice) {
                p.lowPrice = price;
                const newStop = price * (1 + SHORT_TRAIL_PCT);
                if (newStop < p.stopPrice) p.stopPrice = newStop;
            }
        }

        // Profit confirmation tracking
        if (gain >= PROFIT_THRESHOLD) {
            p.peakReached = true;
            p.belowThresholdTicks = 0;
        } else if (p.peakReached) {
            p.belowThresholdTicks++;
        }
    }

    function checkSell(sym, price, histLen) {
        const p = posState.get(sym);
        if (!p) return null;

        const gain = p.isShort
            ? (p.entryPrice - price) / p.entryPrice
            : (price - p.entryPrice) / p.entryPrice;

        // Never confirmed +2% within 12 ticks
        if (!p.peakReached && histLen >= TICK_HISTORY && gain < PROFIT_THRESHOLD) {
            return 'no-confirm';
        }

        // Was above +2%, now below for 12 consecutive ticks
        if (p.peakReached && p.belowThresholdTicks >= TREND_CONFIRM_TICKS) {
            return `below-threshold (${p.belowThresholdTicks}t)`;
        }

        // Stop loss + trailing stop only after activation
        if (p.activated) {
            const slPrice = p.isShort
                ? p.entryPrice * (1 + STOP_LOSS_PCT)
                : p.entryPrice * (1 - STOP_LOSS_PCT);

            if (!p.isShort && price <= slPrice) return `stop-loss (${(gain*100).toFixed(2)}%)`;
            if ( p.isShort && price >= slPrice) return `stop-loss-short (${(gain*100).toFixed(2)}%)`;
            if (!p.isShort && price <= p.stopPrice) return `trail-stop (peak $${ns.format.number(p.highPrice)})`;
            if ( p.isShort && price >= p.stopPrice) return `trail-stop-short (low $${ns.format.number(p.lowPrice)})`;
        }

        return null;
    }

    // ── Position sizing ───────────────────────────────────────────────────────
    function calcShares(forecast, price, portfolio, stage, nPositions) {
        if (nPositions >= stage.maxPos) return 0;
        const cash       = getCash();
        const floor      = portfolio * stage.reserve;
        const available  = Math.max(0, cash - floor);
        if (available <= 0) return 0;

        const strength  = Math.min(1, Math.abs(forecast - 0.5) / 0.5);
        const baseAlloc = portfolio / stage.maxPos;
        const scaled    = baseAlloc * (0.5 + strength * 0.5);
        const spend     = Math.min(available, scaled);
        return Math.floor(spend / price);
    }

    // ── State ─────────────────────────────────────────────────────────────────
    let totalProfit = 0;
    let totalTrades = 0;
    let tick        = 0;

    // ── Main loop ─────────────────────────────────────────────────────────────
    while (true) {
        tick++;
        const portfolio  = getPortfolioValue();
        const stage      = getStage(portfolio);
        const using4S    = has4S();
        const useShorts  = hasShorts();
        const syms       = getSymbols();

        // Update price history
        for (const sym of syms) {
            try { updateHistory(sym, ns.stock.getPrice(sym)); } catch {}
        }

        // Update position state
        for (const sym of [...posState.keys()]) {
            try { updatePos(sym, ns.stock.getPrice(sym)); } catch {}
        }

        // Build + rank candidates
        const ranked = [];
        for (const sym of syms) {
            const forecast = getForecast(sym);
            if (forecast === null) continue;
            try {
                ranked.push({ sym, forecast, price: ns.stock.getPrice(sym) });
            } catch {}
        }
        ranked.sort((a, b) => Math.abs(b.forecast - 0.5) - Math.abs(a.forecast - 0.5));

        // ── Sell / cover ──────────────────────────────────────────────────────
        for (const { sym, price } of ranked) {
            try {
                const [lng, lngAvg, shrt, shrtAvg] = ns.stock.getPosition(sym);
                const histLen = priceHistory.get(sym)?.length ?? 0;

                if (lng > 0) {
                    const reason = checkSell(sym, price, histLen);
                    if (reason) {
                        const revenue = ns.stock.sellStock(sym, lng);
                        if (revenue > 0) {
                            const profit = revenue - lng * lngAvg - COMMISSION;
                            totalProfit += profit;
                            totalTrades++;
                            posState.delete(sym);
                            const col = profit >= 0 ? GREEN : RED;
                            ns.print(`${col}SELL ${sym}: ${reason} | ${profit >= 0 ? '+' : ''}$${ns.format.number(profit)}${R}`);
                            log(`CLOSE LONG ${sym}: ${reason} | P/L $${ns.format.number(profit)}`);
                        }
                    }
                }

                if (useShorts && shrt > 0) {
                    const reason = checkSell(sym, price, histLen);
                    const forecast = getForecast(sym);
                    if (reason || (forecast !== null && forecast >= COVER_FORECAST)) {
                        const revenue = ns.stock.sellShort(sym, shrt);
                        if (revenue > 0) {
                            const profit = revenue - shrt * (2 * shrtAvg - price) - COMMISSION;
                            totalProfit += profit;
                            totalTrades++;
                            posState.delete(sym);
                            const col = profit >= 0 ? GREEN : RED;
                            ns.print(`${col}COVER ${sym}: ${reason ?? 'forecast'} | ${profit >= 0 ? '+' : ''}$${ns.format.number(profit)}${R}`);
                            log(`CLOSE SHORT ${sym}: ${reason ?? 'forecast'} | P/L $${ns.format.number(profit)}`);
                        }
                    }
                }
            } catch {}
        }

        // Count open positions
        let nPositions = 0;
        for (const { sym } of ranked) {
            try {
                const [l,,s] = ns.stock.getPosition(sym);
                if (l > 0 || s > 0) nPositions++;
            } catch {}
        }

        // ── Buy / short ───────────────────────────────────────────────────────
        for (const { sym, forecast, price } of ranked) {
            if (nPositions >= stage.maxPos) break;
            try {
                const [lng,,shrt] = ns.stock.getPosition(sym);

                // Volatility gate (post-4S only)
                if (using4S) {
                    const vol = getVolatility(sym);
                    if (vol !== null && (vol < MIN_VOLATILITY || vol > MAX_VOLATILITY)) continue;
                }

                // Long buy — needs uptrend AND forecast
                if (forecast > BUY_FORECAST && lng === 0 && isUptrend(sym)) {
                    const shares = calcShares(forecast, price, portfolio, stage, nPositions);
                    if (shares > 0) {
                        const bought = ns.stock.buyStock(sym, shares);
                        if (bought > 0) {
                            initPos(sym, price, shares, false);
                            nPositions++;
                            ns.print(`${GREEN}BUY ${sym}: ${shares}x @ $${ns.format.number(price)} f:${forecast.toFixed(3)}${R}`);
                        }
                    }
                }

                // Short — needs downtrend (inverse uptrend) AND forecast
                if (useShorts && forecast < SHORT_FORECAST && shrt === 0 && !isUptrend(sym)) {
                    const shares = calcShares(1 - forecast, price, portfolio, stage, nPositions);
                    if (shares > 0) {
                        const shorted = ns.stock.buyShort(sym, shares);
                        if (shorted > 0) {
                            initPos(sym, price, shares, true);
                            nPositions++;
                            ns.print(`${CYAN}SHORT ${sym}: ${shares}x @ $${ns.format.number(price)} f:${forecast.toFixed(3)}${R}`);
                        }
                    }
                }
            } catch {}
        }

        // ── Display ───────────────────────────────────────────────────────────
        ns.clearLog();
        const stageLabel = portfolio < 500e6 ? 'Early' : portfolio < 250e9 ? 'Mid' : 'Late';

        ns.print(`${BOLD}${CYAN}╔══════════════════════════════════════════╗${R}`);
        ns.print(`${BOLD}${CYAN}║  📈  STOCK TRADER v6.0                   ║${R}`);
        ns.print(`${BOLD}${CYAN}╚══════════════════════════════════════════╝${R}`);
        ns.print('');

        ns.print(`${GRAY}  ┌─ Portfolio ─────────────────────────────────┐${R}`);
        ns.print(`${GRAY}  │${R}  ${'Value'.padEnd(12)}${GOLD}${BOLD}$${ns.format.number(portfolio)}${R}`);
        ns.print(`${GRAY}  │${R}  ${'Cash'.padEnd(12)}${GOLD}$${ns.format.number(getCash())}${R}`);
        ns.print(`${GRAY}  │${R}  ${'Stage'.padEnd(12)}${CYAN}${stageLabel}${R}  ${DIM}${(stage.reserve*100).toFixed(0)}% reserve | max ${stage.maxPos}${R}`);
        ns.print(`${GRAY}  │${R}  ${'Session P/L'.padEnd(12)}${totalProfit >= 0 ? GREEN : RED}$${ns.format.number(totalProfit)}${R}  ${DIM}${totalTrades} trades${R}`);
        ns.print(`${GRAY}  │${R}  ${'4S'.padEnd(12)}${using4S ? `${GREEN}✓ active${R}` : `${GOLD}✗ pre-4S${R}`}  ${DIM}Shorts: ${useShorts ? 'yes' : 'no'}${R}`);
        ns.print(`${GRAY}  └─────────────────────────────────────────────┘${R}`);
        ns.print('');

        // Active positions
        const held = ranked.filter(({ sym }) => {
            try { const [l,,s] = ns.stock.getPosition(sym); return l > 0 || s > 0; } catch { return false; }
        });

        if (held.length > 0) {
            ns.print(`${GRAY}  ┌─ Positions ${held.length}/${stage.maxPos} ${'─'.repeat(33)}┐${R}`);
            for (const { sym, forecast, price } of held) {
                try {
                    const [lng, lngAvg, shrt, shrtAvg] = ns.stock.getPosition(sym);
                    const p = posState.get(sym);
                    if (lng > 0) {
                        const g    = (price - lngAvg) / lngAvg * 100;
                        const col  = g >= 0 ? GREEN : RED;
                        const lock = p?.activated ? '🔒' : '  ';
                        const peak = p?.peakReached ? `✓` : `${p?.belowThresholdTicks ?? 0}t`;
                        ns.print(`${GRAY}  │${R}  ${WHITE}${sym.padEnd(5)}${R} ${col}${g >= 0 ? '+' : ''}${g.toFixed(2)}%${R} f:${forecast.toFixed(2)} ${lock} ${DIM}${peak}${R}`);
                    }
                    if (shrt > 0) {
                        const g   = (shrtAvg - price) / shrtAvg * 100;
                        const col = g >= 0 ? GREEN : RED;
                        ns.print(`${GRAY}  │${R}  ${WHITE}${sym.padEnd(5)}${R} ${col}${g >= 0 ? '+' : ''}${g.toFixed(2)}%${R} f:${forecast.toFixed(2)} ${CYAN}SHORT${R}`);
                    }
                } catch {}
            }
            ns.print(`${GRAY}  └─────────────────────────────────────────────┘${R}`);
            ns.print('');
        }

        // Top candidates with trend data
        ns.print(`${GRAY}  ┌─ Candidates ────────────────────────────────┐${R}`);
        let shown = 0;
        for (const { sym, forecast, price } of ranked) {
            if (shown >= 8) break;
            try {
                const [l,,s] = ns.stock.getPosition(sym);
                if (l > 0 || s > 0) continue;
                const h = priceHistory.get(sym);
                if (!h || h.length < TICK_HISTORY) continue;
                const t      = getTrend(sym);
                const trend  = isUptrend(sym);
                const tCol   = trend ? GREEN : GRAY;
                const pct    = t.range > 0 ? ((t.current - t.low) / t.range * 100).toFixed(0) : '?';
                const fCol   = forecast > BUY_FORECAST ? GREEN : forecast < SHORT_FORECAST ? CYAN : GRAY;
                ns.print(`${GRAY}  │${R}  ${WHITE}${sym.padEnd(5)}${R} ${fCol}${forecast.toFixed(3)}${R} ${tCol}${trend ? '▲' : '─'}${R} pos:${String(pct).padStart(3)}% ↑${t.upTicks}/12 ${DIM}$${ns.format.number(price)}${R}`);
                shown++;
            } catch {}
        }
        if (shown === 0) ns.print(`${GRAY}  │  Warming up... (${tick}/${TICK_HISTORY} ticks)${R}`);
        ns.print(`${GRAY}  └─────────────────────────────────────────────┘${R}`);
        ns.print(`${DIM}  tick:${tick}  ${new Date().toLocaleTimeString()}${R}`);

        await ns.sleep(LOOP_SLEEP);
    }
}