// darknet-lab.js — Labyrinth solver with BFS backtracking

const MOVE_DELAY = 400;
const DIRECTIONS = ['north', 'east', 'south', 'west'];
const DX = { north: 0,  east: 1,  south: 0,  west: -1 };
const DY = { north: -1, east: 0,  south: 1,  west:  0 };

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('🌀 Labyrinth');

    // ── Initial probe ──────────────────────────────────────────────────────
    const probe = await ns.dnet.labreport();
    ns.print('labreport: ' + JSON.stringify(probe));
    if (!probe?.success) { ns.print('❌ labreport failed: ' + probe?.message); return; }

    // Find lab hostname from adjacent servers
    const nearby  = ns.dnet.probe();
    const labHost = nearby.find(n => {
        try { return ns.dnet.getServerAuthDetails(n)?.modelId === 'th3_l4byr1nth'; }
        catch { return false; }
    });
    if (!labHost) { ns.print('❌ No labyrinth adjacent'); return; }
    ns.print(`🌀 Lab: ${labHost}`);

    // ── State ──────────────────────────────────────────────────────────────
    const visited  = new Map(); // "x,y" -> visit count
    const passages = new Map(); // "x,y->dir" -> use count
    const graph    = new Map(); // "x,y" -> { north, east, south, west } open booleans

    let [x, y] = probe.coords ?? [1, 1];
    let facing = 0;
    let steps  = 0;

    const key  = (cx, cy)      => `${cx},${cy}`;
    const pkey = (cx, cy, dir) => `${cx},${cy}->${dir}`;
    const mark = ()            => visited.set(key(x, y), (visited.get(key(x, y)) ?? 0) + 1);

    // Record open passages from a labreport response
    function updateGraph(rep) {
        graph.set(key(x, y), {
            north: rep.north,
            east:  rep.east,
            south: rep.south,
            west:  rep.west,
        });
    }

    updateGraph(probe);
    mark();

    // ── Move ───────────────────────────────────────────────────────────────
    async function move(dir) {
        const result = await ns.dnet.authenticate(labHost, dir);
        await ns.sleep(MOVE_DELAY);
        if (!result?.success) return false;
        x += DX[dir]; y += DY[dir]; steps++;
        mark();
        ns.print(`→ ${dir.padEnd(6)} (${x},${y}) steps:${steps}`);
        return true;
    }

    // ── BFS path to nearest unvisited reachable cell ───────────────────────
    function bfsToUnvisited() {
        const start = key(x, y);
        const queue = [[x, y, []]];
        const seen  = new Set([start]);

        while (queue.length) {
            const [cx, cy, path] = queue.shift();
            const exits = graph.get(key(cx, cy));
            if (!exits) continue;

            for (const dir of DIRECTIONS) {
                if (!exits[dir]) continue;
                const nx = cx + DX[dir];
                const ny = cy + DY[dir];
                const nk = key(nx, ny);
                if (seen.has(nk)) continue;
                seen.add(nk);
                const newPath = [...path, dir];
                if (!visited.has(nk)) return newPath; // found unvisited
                queue.push([nx, ny, newPath]);
            }
        }
        return null; // fully explored
    }

    // ── Execute a path from BFS ────────────────────────────────────────────
    async function followPath(path) {
        for (const dir of path) {
            if (!await move(dir)) return false;
            // Update graph at each step
            const rep = await ns.dnet.labreport();
            if (rep?.success) {
                if (rep.coords) [x, y] = rep.coords;
                updateGraph(rep);
                if (isWin(rep)) return 'win';
            }
        }
        return true;
    }

    // ── Trémaux step ───────────────────────────────────────────────────────
    async function stepTremaux(rep) {
        const order = [
            (facing + 1) % 4,
             facing,
            (facing + 3) % 4,
            (facing + 2) % 4,
        ];

        const candidates = order
            .map(di => ({ di, dir: DIRECTIONS[di] }))
            .filter(({ dir }) => rep[dir] === true)
            .sort((a, b) => {
                const nka = key(x + DX[a.dir], y + DY[a.dir]);
                const nkb = key(x + DX[b.dir], y + DY[b.dir]);
                // Primary: prefer unvisited
                const visitDiff = (visited.get(nka) ?? 0) - (visited.get(nkb) ?? 0);
                if (visitDiff !== 0) return visitDiff;
                // Secondary: prefer least-used passage
                return (passages.get(pkey(x, y, a.dir)) ?? 0) -
                       (passages.get(pkey(x, y, b.dir)) ?? 0);
            });

        for (const { di, dir } of candidates) {
            passages.set(pkey(x, y, dir), (passages.get(pkey(x, y, dir)) ?? 0) + 1);
            if (await move(dir)) { facing = di; return true; }
        }
        return false;
    }

    // ── Win check ──────────────────────────────────────────────────────────
    function isWin(rep) {
        if (!rep?.success) return false;
        const msg = (rep.message ?? '').toLowerCase();
        return rep.complete === true ||
               msg.includes('exit')      ||
               msg.includes('complete')  ||
               msg.includes('congratul') ||
               msg.includes('escape')    ||
               msg.includes('win');
    }

    // ── Main loop ──────────────────────────────────────────────────────────
    ns.print(`Start: ${x},${y}`);
    const HARD_CAP = 10_000;

    while (steps < HARD_CAP) {
        const rep = await ns.dnet.labreport();
        if (rep?.coords) [x, y] = rep.coords;
        if (rep?.success) updateGraph(rep);

        ns.print(`(${x},${y}) v:${visited.get(key(x,y))??0} explored:${graph.size} N:${rep.north} E:${rep.east} S:${rep.south} W:${rep.west}`);

        if (isWin(rep)) {
            ns.print(`🏆 Labyrinth complete in ${steps} steps!`);
            return;
        }

        const currentVisits = visited.get(key(x, y)) ?? 0;

        // Loop detection — force BFS if cycling
        if (currentVisits > 3) {
            ns.print(`⚠ Cycling at (${x},${y}) — BFS to unvisited`);
            const path = bfsToUnvisited();
            if (!path) { ns.print('🏁 Fully explored — no exit found'); break; }
            const result = await followPath(path);
            if (result === 'win') { ns.print(`🏆 Complete in ${steps} steps!`); return; }
            continue;
        }

        // Normal Trémaux step
        if (!await stepTremaux(rep)) {
            // Dead end — BFS out immediately
            ns.print(`↩ Dead end at (${x},${y}) — BFS escape`);
            const path = bfsToUnvisited();
            if (!path) { ns.print('🏁 Fully explored — no exit found'); break; }
            const result = await followPath(path);
            if (result === 'win') { ns.print(`🏆 Complete in ${steps} steps!`); return; }
        }

        await ns.sleep(MOVE_DELAY);
    }

    ns.print(`Solver ended: ${steps} steps at ${x},${y}`);
}