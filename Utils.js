/**
 * utils.js — Shared helper library
 * Import with: import { ... } from 'utils.js';
 * No main(), no daemon, no state. Pure helpers only.
 *
 * Compatible with Bitburner 3.0 API.
 * Note: formatMoney/formatTime/formatPct below are plain JS math helpers,
 * NOT wrappers around ns.format.*. Use ns.format.ram/number/percent
 * directly in scripts if you want the game's built-in formatting.
 */

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Format a number as $1.234b / $567.8m / $12.3k etc. */
export function formatMoney(n) {
    if (n >= 1e12) return `$${(n / 1e12).toFixed(3)}t`;
    if (n >= 1e9)  return `$${(n / 1e9).toFixed(3)}b`;
    if (n >= 1e6)  return `$${(n / 1e6).toFixed(3)}m`;
    if (n >= 1e3)  return `$${(n / 1e3).toFixed(3)}k`;
    return `$${n.toFixed(2)}`;
}

/** Format RAM in GB/TB */
export function formatRam(gb) {
    if (gb >= 1024) return `${(gb / 1024).toFixed(2)} TB`;
    return `${gb.toFixed(2)} GB`;
}

/** Format milliseconds as Xh Xm Xs */
export function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
}

/** Format a decimal as a percentage, e.g. 0.753 → "75.30%" */
export function formatPct(n) {
    return `${(n * 100).toFixed(2)}%`;
}

// ─── Server Scanning ──────────────────────────────────────────────────────────

/**
 * BFS scan of the entire network from 'home'.
 * Returns an array of all server hostnames (excluding home).
 */
export function getAllServers(ns) {
    const visited = new Set(['home']);
    const queue = ['home'];
    while (queue.length > 0) {
        const host = queue.shift();
        for (const neighbor of ns.scan(host)) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }
    visited.delete('home');
    return [...visited];
}

/**
 * Returns all servers that are rooted (have root access).
 * Includes purchased servers. Excludes home.
 */
export function getRootedServers(ns) {
    return getAllServers(ns).filter(s => ns.hasRootAccess(s));
}

/**
 * Returns all purchased servers.
 */
export function getPurchasedServers(ns) {
    return ns.cloud.getServerNames();
}

/**
 * Returns all servers available as worker hosts:
 * home + all rooted non-home servers.
 * RAM cap for home is enforced by getUsableRam().
 */
export function getWorkerServers(ns) {
    const rooted = getRootedServers(ns);
    return ['home', ...rooted];
}

/**
 * Returns worker hosts excluding home — for use by Batcher when
 * running on a purchased server so home RAM is preserved.
 */
export function getWorkerServersNoHome(ns) {
    return getRootedServers(ns);
}

// ─── RAM Helpers ──────────────────────────────────────────────────────────────

/**
 * Returns usable RAM on a server.
 * For 'home', caps usable RAM at 25% of max to leave room for other scripts.
 */
export function getUsableRam(ns, host) {
    const maxRam = ns.getServerMaxRam(host);
    const usedRam = ns.getServerUsedRam(host);
    const freeRam = maxRam - usedRam;
    if (host === 'home') {
        const cap = maxRam * 0.85;
        const capRemaining = Math.max(0, cap - usedRam);
        return Math.min(freeRam, capRemaining);
    }
    return Math.max(0, freeRam);
}

/**
 * Given a script RAM cost and a list of worker hosts,
 * returns total threads available across all hosts.
 */
export function totalAvailableThreads(ns, scriptRam, hosts) {
    let total = 0;
    for (const host of hosts) {
        const ram = getUsableRam(ns, host);
        total += Math.floor(ram / scriptRam);
    }
    return total;
}

/**
 * Distributes `totalThreads` across hosts.
 * Returns array of { host, threads } (skips hosts with 0 threads).
 */
export function distributeThreads(ns, scriptRam, hosts, totalThreads) {
    const result = [];
    let remaining = totalThreads;
    for (const host of hosts) {
        if (remaining <= 0) break;
        const ram = getUsableRam(ns, host);
        const maxThreads = Math.floor(ram / scriptRam);
        if (maxThreads <= 0) continue;
        const threads = Math.min(maxThreads, remaining);
        result.push({ host, threads });
        remaining -= threads;
    }
    return result;
}

// ─── Target Scoring ───────────────────────────────────────────────────────────

/**
 * Score a server as a hack target.
 * Higher = better. Returns 0 if not hackable.
 */
export function scoreTarget(ns, host) {
    const player = ns.getPlayer();
    const server = ns.getServer(host);
    if (server.requiredHackingSkill > player.skills.hacking) return 0;
    if (server.moneyMax <= 0) return 0;
    if (!server.hasAdminRights) return 0;

    const money = server.moneyMax;
    const minSec = server.minDifficulty;
    const hackTime = ns.getHackTime(host);

    return (money / hackTime) / minSec;
}

/**
 * Returns the top N hackable targets sorted by score, best first.
 */
export function getTopTargets(ns, n = 10) {
    const pservs = new Set(ns.cloud.getServerNames());
    return getRootedServers(ns)
        .filter(s => !pservs.has(s))
        .map(s => ({ host: s, score: scoreTarget(ns, s) }))
        .filter(t => t.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, n)
        .map(t => t.host);
}

// ─── Dynamic Tail Box ─────────────────────────────────────────────────────────

/**
 * Renders a dynamic-width box to ns.print().
 * Width auto-sizes to the longest content line each call.
 *
 * Usage:
 *   const box = new TailBox(ns);
 *   box.row('  Some content');
 *   box.div();
 *   box.row('  More content');
 *   box.print();
 *
 * Row strings should include their own leading spaces.
 * Call box.print() once at the end — it measures, then prints everything.
 */
export class TailBox {
    constructor(ns) {
        this._ns      = ns;
        this._entries = [];
    }
    row(str)  { this._entries.push({ type: 'row', str }); }
    div()     { this._entries.push({ type: 'div' }); }
    print() {
        const W       = this._entries.reduce((max, e) =>
            e.type === 'row' ? Math.max(max, e.str.length) : max, 0) + 2;
        const top     = '╔' + '═'.repeat(W) + '╗';
        const bot     = '╚' + '═'.repeat(W) + '╝';
        const divider = '╠' + '═'.repeat(W) + '╣';
        this._ns.print(top);
        for (const e of this._entries) {
            if (e.type === 'div') this._ns.print(divider);
            else                  this._ns.print('║' + e.str.padEnd(W) + '║');
        }
        this._ns.print(bot);
        this._entries = []; // reset for next tick
    }
}

// ─── Port Crackers ────────────────────────────────────────────────────────────

/**
 * Returns how many port crackers the player currently has.
 */
export function countCrackers(ns) {
    const crackers = [
        'BruteSSH.exe', 'FTPCrack.exe', 'relaySMTP.exe',
        'HTTPWorm.exe', 'SQLInject.exe'
    ];
    return crackers.filter(c => ns.fileExists(c, 'home')).length;
}

/**
 * Attempts to open all available ports on a server and nuke it.
 * Returns true if root was gained, false otherwise.
 * Uses return-value from ns.nuke() per Bitburner 3.0 (no try/catch needed).
 */
export function tryRoot(ns, host) {
    if (ns.hasRootAccess(host)) return true;
    if (ns.fileExists('BruteSSH.exe',  'home')) ns.brutessh(host);
    if (ns.fileExists('FTPCrack.exe',  'home')) ns.ftpcrack(host);
    if (ns.fileExists('relaySMTP.exe', 'home')) ns.relaysmtp(host);
    if (ns.fileExists('HTTPWorm.exe',  'home')) ns.httpworm(host);
    if (ns.fileExists('SQLInject.exe', 'home')) ns.sqlinject(host);
    // 3.0: ns.nuke() no longer throws — check return value instead
    return ns.nuke(host);
}