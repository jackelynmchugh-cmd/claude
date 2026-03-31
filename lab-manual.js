// lab-manual.js

const MOVE_DELAY = 400;
const DIRECTIONS = ['north', 'east', 'south', 'west'];
const REVERSE    = { north:'south', south:'north', east:'west', west:'east' };

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.setTailTitle('🌀 Labyrinth');

    // Accept hostname as arg, or fall back to probe
    let labHost = ns.args[0] ?? null;

    if (!labHost) {
        const nearby = ns.dnet.probe();
        labHost = nearby.find(n => {
            try { return ns.dnet.getServerAuthDetails(n)?.modelId === '(The Labyrinth)'; }
            catch { return false; }
        });
    }

    if (!labHost) {
        ns.tprint('❌ No labyrinth found');
        return;
    }
    ns.tprint(`✅ Targeting lab: ${labHost}`);

    const probe = await ns.dnet.labreport();
    ns.tprint('labreport: ' + JSON.stringify(probe));
    if (!probe?.success) { ns.tprint('❌ labreport failed'); return; }

    // State
    const visited = new Map();
    const graph   = new Map();
    const edges   = new Map();

    let [x, y] = probe.coords ?? [1, 1];
    let steps   = 0;

    const key = (cx, cy) => `${cx},${cy}`;
    const cur = ()       => key(x, y);
    const mark = ()      => visited.set(cur(), (visited.get(cur()) ?? 0) + 1);

    function updateGraph(rep) {
        graph.set(cur(), {
            north: rep.north, east: rep.east,
            south: rep.south, west: rep.west,
        });
    }

    function recordEdge(fromX, fromY, dir) {
        const fk = key(fromX, fromY);
        const tk = cur();
        if (!edges.has(fk)) edges.set(fk, {});
        edges.get(fk)[dir] = tk;
        if (!edges.has(tk)) edges.set(tk, {});
        edges.get(tk)[REVERSE[dir]] = fk;
    }

    updateGraph(probe);
    mark();

    async function move(dir) {
        const px = x, py = y;
        const result = await ns.dnet.authenticate(labHost, dir);
        await ns.sleep(MOVE_DELAY);

        const moved = result?.success === true ||
            (result?.code === 401 && result?.message?.toLowerCase().includes('you have moved'));

        if (!moved) {
            ns.print(`  blocked ${dir} from (${px},${py}): ${result?.message}`);
            return false;
        }

        steps++;
        const rep = await ns.dnet.labreport();
        if (!rep?.success) return false;
        [x, y] = rep.coords;
        recordEdge(px, py, dir);
        updateGraph(rep);
        mark();
        ns.print(`  moved ${dir} (${px},${py}) -> (${x},${y})`);
        if (isWin(rep)) return 'win';
        return true;
    }

    function bfsToUnvisited() {
        const queue = [[cur(), []]];
        const seen  = new Set([cur()]);

        while (queue.length) {
            const [ck, path] = queue.shift();
            const exits   = graph.get(ck);
            const edgeMap = edges.get(ck) ?? {};
            if (!exits) continue;

            for (const dir of DIRECTIONS) {
                if (!exits[dir]) continue;
                const nk = edgeMap[dir];
                if (!nk) continue;
                if (seen.has(nk)) continue;
                seen.add(nk);
                const newPath = [...path, dir];
                if (!visited.has(nk)) return newPath;
                queue.push([nk, newPath]);
            }

            for (const dir of DIRECTIONS) {
                if (!exits[dir]) continue;
                if (!edgeMap[dir]) return [...path, dir];
            }
        }
        return null;
    }

    async function followPath(path) {
        for (const dir of path) {
            const result = await move(dir);
            if (result === 'win') return 'win';
            if (!result) return false;
        }
        return true;
    }

    function isWin(rep) {
        if (!rep?.success) return false;
        const msg = (rep.message ?? '').toLowerCase();
        return rep.complete === true  ||
               msg.includes('exit')      ||
               msg.includes('complete')  ||
               msg.includes('congratul') ||
               msg.includes('escape')    ||
               msg.includes('win');
    }

    ns.print(`Start: ${x},${y}`);

    while (steps < 10_000) {
        const rep = await ns.dnet.labreport();
        if (rep?.coords) [x, y] = rep.coords;
        if (rep?.success) updateGraph(rep);
        mark();

        ns.print(`(${x},${y}) v:${visited.get(cur())??0} explored:${graph.size} edges:${edges.size} N:${rep.north} E:${rep.east} S:${rep.south} W:${rep.west}`);

        if (isWin(rep)) {
            ns.tprint(`🏆 Labyrinth complete in ${steps} steps!`);
            return;
        }

        const exits   = graph.get(cur()) ?? {};
        const edgeMap = edges.get(cur()) ?? {};
        const visits  = visited.get(cur()) ?? 0;

        const untraveled = DIRECTIONS.filter(d => exits[d] && !edgeMap[d]);
        if (untraveled.length > 0) {
            const dir = untraveled[0];
            const result = await move(dir);
            if (result === 'win') { ns.tprint(`🏆 Complete in ${steps} steps!`); return; }
            continue;
        }

        if (visits > 2) {
            ns.print(`⚠ Cycling at (${x},${y}) — BFS`);
            const path = bfsToUnvisited();
            if (!path) { ns.tprint('🏁 Fully explored — no exit found'); break; }
            const r = await followPath(path);
            if (r === 'win') { ns.tprint(`🏆 Complete in ${steps} steps!`); return; }
            continue;
        }

        const traveled = DIRECTIONS
            .filter(d => exits[d] && edgeMap[d])
            .sort((a, b) =>
                (visited.get(edgeMap[a]) ?? 0) - (visited.get(edgeMap[b]) ?? 0)
            );

        if (traveled.length > 0) {
            const result = await move(traveled[0]);
            if (result === 'win') { ns.tprint(`🏆 Complete in ${steps} steps!`); return; }
        } else {
            ns.print('❌ No moves available');
            break;
        }

        await ns.sleep(MOVE_DELAY);
    }

    ns.tprint(`Solver ended: ${steps} steps at ${x},${y}`);
}
