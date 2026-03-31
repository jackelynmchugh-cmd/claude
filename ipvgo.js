/**
 * ipvgo.js — IPvGO automation bot (v7.1)
 * Performance optimized — cached influence, MCTS skip for obvious moves,
 * capped playout length, influence-only territory scoring
 *
 * Usage: run ipvgo.js [reward]
 * Rewards: hacknet, crime, hacking, combat, reputation, hgw
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();

    const self = ns.getRunningScript();
    for (const proc of ns.ps('home')) {
        if (proc.filename === self.filename && proc.pid !== self.pid) {
            ns.kill(proc.pid);
        }
    }

    const REWARD_MAP = {
        hacknet:    { faction: 'Netburners',     size: 5, komi: 1.5, style: 'easy',        komiStrat: 'relaxed',    candidates: 5,  playouts: 5  },
        crime:      { faction: 'Slum Snakes',    size: 7, komi: 3.5, style: 'anti-spread', komiStrat: 'relaxed',    candidates: 7,  playouts: 7  },
        hacking:    { faction: 'The Black Hand', size: 7, komi: 3.5, style: 'aggressive',  komiStrat: 'relaxed',    candidates: 8,  playouts: 10 },
        combat:     { faction: 'Tetrads',        size: 9, komi: 5.5, style: 'pattern',     komiStrat: 'aggressive', candidates: 10, playouts: 12 },
        reputation: { faction: 'Daedalus',       size: 9, komi: 5.5, style: 'illuminati',  komiStrat: 'aggressive', candidates: 12, playouts: 15 },
        hgw:        { faction: 'Illuminati',     size: 9, komi: 7.5, style: 'illuminati',  komiStrat: 'desperate',  candidates: 15, playouts: 20 },
    };

    const reward = (ns.args[0] ?? 'hacking').toString().toLowerCase();
    const config = REWARD_MAP[reward];

    if (!config) {
        ns.tprint(`ERROR: Unknown reward "${reward}". Valid: ${Object.keys(REWARD_MAP).join(', ')}`);
        return;
    }

    ns.ui.setTailTitle(`🎮 IPvGO v7.1 — ${config.faction} [${reward}]`);
    ns.tprint(`▶ IPvGO vs ${config.faction} — ${config.size}x${config.size} — komi: ${config.komi}`);

    const BASE_PATTERNS = [
        ["XOX","...","???"], ["XO.","...","?.?"], ["XO?","X..","o.?"],
        [".O.","X..","..."], ["XO?","O.x","?x?"], ["XO?","O.X","???"],
        ["?X?","O.O","xxx"], ["OX?","x.O","???"], ["X.?","O.?","   "],
        ["OX?","X.O","   "], ["?X?","o.O","   "], ["?XO","o.o","   "],
        ["?OX","X.O","   "],
    ];
    const EXPANDED_PATTERNS = expandPatterns(BASE_PATTERNS);

    let wins            = 0;
    let losses          = 0;
    let consecutiveWins = 0;
    let winStreak       = 0;
    let games           = 0;

    const oppMoveHistory = [];
    let oppCaptureRate   = 0;
    let oppExpansionRate = 0;
    let oppDefenseRate   = 0;

    while (true) {
        games++;
        await ns.go.resetBoardState(config.faction, config.size);
        await ns.sleep(200);

        let result;
        let turn          = 0;
        let oppPassed     = false;
        let thinkingTime  = 0;
        const boardHistory = [];
        let prevOppBoard   = null;

        do {
            turn++;
            const board      = ns.go.getBoardState();
            const validMoves = ns.go.analysis.getValidMoves();
            const liberties  = ns.go.analysis.getLiberties();
            const size       = board.length;

            if (prevOppBoard) {
                analyzeOppMove(prevOppBoard, board, size, oppMoveHistory);
                const recent     = oppMoveHistory.slice(-10);
                oppCaptureRate   = recent.filter(m => m === 'capture').length / recent.length;
                oppExpansionRate = recent.filter(m => m === 'expand').length  / recent.length;
                oppDefenseRate   = recent.filter(m => m === 'defend').length  / recent.length;
            }
            prevOppBoard = board;

            // ── Build influence map ONCE per turn and cache it ────────────────
            const influence = buildInfluenceMap(board, size);
            const territory = predictTerritory(board, influence, size);

            let ourNodes = 0, theirNodes = 0, emptyNodes = 0;
            for (let x = 0; x < size; x++)
                for (let y = 0; y < size; y++) {
                    if      (board[x][y] === 'X') ourNodes++;
                    else if (board[x][y] === 'O') theirNodes++;
                    else if (board[x][y] === '.') emptyNodes++;
                }

            const lead       = ourNodes - theirNodes - config.komi;
            const totalNodes = size * size;
            const filledPct  = (ourNodes + theirNodes) / totalNodes;
            const isEndgame  = filledPct > 0.70 || emptyNodes < size * 2;
            const isOpening  = turn <= 5;

            if (shouldPass(board, validMoves, liberties, size, config.komi,
                           oppPassed, lead, filledPct, isEndgame)) {
                result = await ns.go.passTurn();
            } else {
                const tStart = Date.now();
                let bestMove  = null;
                let moveSource = 'mcts';

                // ── Opening book ──────────────────────────────────────────────
                if (isOpening) {
                    bestMove   = getOpeningMove(board, validMoves, size, config.size);
                    moveSource = 'book';
                }

                // ── Obvious move check — skip MCTS if capture/defend exists ───
                if (!bestMove) {
                    const obvious = getObviousMove(board, validMoves, liberties, size);
                    if (obvious) {
                        bestMove   = obvious;
                        moveSource = 'obvious';
                    }
                }

                // ── MCTS for contested decisions only ─────────────────────────
                if (!bestMove) {
                    bestMove = runMCTS(
                        board, validMoves, liberties, influence, territory,
                        size, config, EXPANDED_PATTERNS,
                        isEndgame, lead, filledPct,
                        boardHistory,
                        oppCaptureRate, oppExpansionRate, oppDefenseRate
                    );
                    moveSource = 'mcts';
                }

                thinkingTime = Date.now() - tStart;

                if (bestMove) {
                    result = await ns.go.makeMove(bestMove[0], bestMove[1]);
                    boardHistory.push(boardSnapshot(board));
                    if (boardHistory.length > 6) boardHistory.shift();
                } else {
                    result     = await ns.go.passTurn();
                    moveSource = 'pass';
                }

                // update display with move source
                const freshBoard = ns.go.getBoardState();
                let fUs = 0, fThem = 0;
                for (let x = 0; x < size; x++)
                    for (let y = 0; y < size; y++) {
                        if (freshBoard[x][y] === 'X') fUs++;
                        if (freshBoard[x][y] === 'O') fThem++;
                    }
                const freshInf  = buildInfluenceMap(freshBoard, size);
                const freshTerr = predictTerritory(freshBoard, freshInf, size);
                const terrCount = countPredictedTerritory(freshTerr, size);

                ns.clearLog();
                ns.print(`🎮 IPvGO v7.1 — ${config.faction}  [${config.style}]`);
                ns.print('─'.repeat(56));
                ns.print(`  Games: ${games}  W: ${wins}  L: ${losses}  Streak: ${consecutiveWins}`);
                ns.print(`  Turn: ${turn}  Think: ${thinkingTime}ms  [${moveSource}]  ${isOpening ? '📖' : isEndgame ? '🏁' : '🎯'}`);
                ns.print(`  Us: ${fUs}  Them: ${fThem}  Lead: ${lead.toFixed(1)}  Filled: ${(filledPct*100).toFixed(0)}%`);
                ns.print(`  Terr — Us: ${terrCount.ours}  Them: ${terrCount.theirs}  Contested: ${terrCount.contested}`);
                ns.print(`  Opp: cap=${(oppCaptureRate*100).toFixed(0)}% exp=${(oppExpansionRate*100).toFixed(0)}% def=${(oppDefenseRate*100).toFixed(0)}%`);
                ns.print('─'.repeat(56));
                printBoard(ns, freshBoard, freshTerr, size);
            }

            oppPassed = false;
            if (result?.type !== 'gameOver') {
                const oppResult = await ns.go.opponentNextTurn();
                if (oppResult?.type === 'gameOver') result = oppResult;
                else if (oppResult?.type === 'pass') oppPassed = true;
            }

            await ns.sleep(50);

        } while (result?.type !== 'gameOver');

        try {
            const state = ns.go.getGameState();
            const black = state?.blackScore ?? 0;
            const white = state?.whiteScore ?? 0;

            ns.clearLog();
            ns.print(`🎮 IPvGO v7.1 — ${config.faction}`);
            ns.print('─'.repeat(56));

            if (black > white) {
                wins++;
                consecutiveWins++;
                winStreak        = Math.min(winStreak + 1, 8);
                const streakMult = 1 + 0.25 * winStreak;
                ns.print(`  ✅ WIN   Black: ${black.toFixed(1)}  White: ${white.toFixed(1)}`);
                ns.print(`  🔥 Streak: ${consecutiveWins}  Multiplier: ${streakMult.toFixed(2)}x`);
                if (consecutiveWins >= 2) ns.print(`  💰 500 rep → favor!`);
            } else {
                losses++;
                consecutiveWins  = 0;
                winStreak        = Math.max(winStreak - 1, -8);
                const streakMult = winStreak < 0 ? 0.5 : 1;
                ns.print(`  ❌ LOSS  Black: ${black.toFixed(1)}  White: ${white.toFixed(1)}`);
                ns.print(`  Multiplier: ${streakMult.toFixed(2)}x`);
            }

            const wr = games > 0 ? (wins / games * 100).toFixed(1) : '0.0';
            ns.print(`  Games: ${games}  W: ${wins}  L: ${losses}  WR: ${wr}%`);
            ns.print('─'.repeat(56));
        } catch {
            ns.print('  Could not read final score');
        }

        await ns.sleep(3000);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// OBVIOUS MOVE — skip MCTS for captures and defends
// ═══════════════════════════════════════════════════════════════════════════════

function getObviousMove(board, validMoves, liberties, size) {
    // priority 1 — capture any enemy group with 1 liberty
    // pick the one that captures the most pieces
    let bestCapture     = null;
    let bestCaptureSize = 0;

    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            if (!validMoves[x][y]) continue;
            if (!isSafeMove(board, liberties, x, y, size) && !isCapture(board, x, y, size)) continue;
            if (isCapture(board, x, y, size)) {
                const sz = getCapturableGroupSize(board, x, y, size);
                if (sz > bestCaptureSize) {
                    bestCaptureSize = sz;
                    bestCapture     = [x, y];
                }
            }
        }
    }
    if (bestCapture) return bestCapture;

    // priority 2 — defend any of our groups with 1 liberty
    // pick the one that saves the most pieces
    let bestDefend     = null;
    let bestDefendSize = 0;

    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            if (!validMoves[x][y]) continue;
            if (isDefend(board, x, y, size) && isSafeMove(board, liberties, x, y, size)) {
                const sz = getDefendableGroupSize(board, x, y, size);
                if (sz > bestDefendSize) {
                    bestDefendSize = sz;
                    bestDefend     = [x, y];
                }
            }
        }
    }
    if (bestDefend) return bestDefend;

    return null; // no obvious move — let MCTS decide
}

// ═══════════════════════════════════════════════════════════════════════════════
// MONTE CARLO TREE SEARCH
// ═══════════════════════════════════════════════════════════════════════════════

function runMCTS(board, validMoves, liberties, influence, territory,
                 size, config, patterns, isEndgame, lead, filledPct,
                 boardHistory, oppCaptureRate, oppExpansionRate, oppDefenseRate) {

    const candidates = [];
    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            if (!validMoves[x][y]) continue;
            if (isKoMove(board, boardHistory, x, y, size)) continue;

            const score = scoreMoveUnified(
                board, validMoves, liberties, influence, territory,
                x, y, size, config, patterns, isEndgame, lead, filledPct,
                oppCaptureRate, oppExpansionRate, oppDefenseRate
            );

            if (score > -Infinity) candidates.push({ x, y, score, wins: 0, plays: 0 });
        }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.score - a.score);
    const topCandidates = candidates.slice(0, config.candidates);

    // ── Capped playout length — size*size/2 instead of full board ────────────
    const maxPlayoutMoves = Math.floor((size * size) / 2);

    for (const candidate of topCandidates) {
        for (let p = 0; p < config.playouts; p++) {
            const won = runPlayout(board, candidate.x, candidate.y, size, config.komi, config, maxPlayoutMoves);
            candidate.plays++;
            if (won) candidate.wins++;
        }
    }

    let bestMove  = null;
    let bestValue = -Infinity;

    for (const c of topCandidates) {
        const winRate   = c.plays > 0 ? c.wins / c.plays : 0;
        const maxScore  = topCandidates[0].score || 1;
        const normScore = c.score / maxScore;
        const value     = winRate * 0.7 + normScore * 0.3;

        if (value > bestValue) {
            bestValue = value;
            bestMove  = [c.x, c.y];
        }
    }

    return bestMove;
}

// ── Playout with capped length ────────────────────────────────────────────────
function runPlayout(board, startX, startY, size, komi, config, maxMoves) {
    const sim = boardToArray(board);
    sim[startX][startY] = 'X';
    applyCaptures(sim, startX, startY, size, 'X');

    let currentColor = 'O';
    let passCount    = 0;
    const cap        = maxMoves ?? size * size;

    for (let m = 0; m < cap && passCount < 2; m++) {
        const move = getGuidedPlayoutMove(sim, size, currentColor, config);
        if (!move) {
            passCount++;
        } else {
            passCount = 0;
            sim[move[0]][move[1]] = currentColor;
            applyCaptures(sim, move[0], move[1], size, currentColor);
        }
        currentColor = currentColor === 'X' ? 'O' : 'X';
    }

    // score using influence map instead of counting — faster
    const inf = buildInfluenceMap(sim, size);
    let ourInfluence = 0, theirInfluence = 0;
    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            if (sim[x][y] === 'X') ourInfluence += 2;
            else if (sim[x][y] === 'O') theirInfluence += 2;
            else if (inf[x][y] > 0.3) ourInfluence++;
            else if (inf[x][y] < -0.3) theirInfluence++;
        }
    }

    return ourInfluence > theirInfluence + komi;
}

function getGuidedPlayoutMove(board, size, color, config) {
    const enemy = color === 'X' ? 'O' : 'X';
    const moves = [];

    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            if (board[x][y] !== '.') continue;

            let score       = Math.random() * 10;
            const neighbors = getNeighbors(x, y, size);

            for (const [nx, ny] of neighbors) {
                if (board[nx][ny] !== enemy) continue;
                const group = getGroup(board, nx, ny, size);
                if (countGroupLiberties(board, group, size) === 1) score += 100;
            }

            for (const [nx, ny] of neighbors) {
                if (board[nx][ny] !== color) continue;
                const group = getGroup(board, nx, ny, size);
                if (countGroupLiberties(board, group, size) === 1) score += 80;
            }

            const friendCount = neighbors.filter(([nx, ny]) => board[nx][ny] === color).length;
            const openCount   = neighbors.filter(([nx, ny]) => board[nx][ny] === '.').length;
            score += friendCount * 5 + openCount * 2;
            if (x % 2 === 0 && y % 2 === 0) score -= 15;

            moves.push({ x, y, score });
        }
    }

    if (moves.length === 0) return null;

    moves.sort((a, b) => b.score - a.score);
    const top     = moves.slice(0, Math.min(5, moves.length));
    const weights = top.map((m, i) => Math.max(0, m.score) * (1 / (i + 1)));
    const total   = weights.reduce((s, w) => s + w, 0);

    if (total <= 0) return top[0] ? [top[0].x, top[0].y] : null;

    let rand = Math.random() * total;
    for (let i = 0; i < top.length; i++) {
        rand -= weights[i];
        if (rand <= 0) return [top[i].x, top[i].y];
    }

    return [top[0].x, top[0].y];
}

function applyCaptures(board, x, y, size, color) {
    const enemy = color === 'X' ? 'O' : 'X';
    for (const [nx, ny] of getNeighbors(x, y, size)) {
        if (board[nx][ny] !== enemy) continue;
        const group = getGroup(board, nx, ny, size);
        if (countGroupLiberties(board, group, size) === 0) {
            group.forEach(([gx, gy]) => { board[gx][gy] = '.'; });
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED SCORING — influence only, no territory simulation
// ═══════════════════════════════════════════════════════════════════════════════

function scoreMoveUnified(board, validMoves, liberties, influence, territory,
                          x, y, size, config, patterns, isEndgame, lead, filledPct,
                          oppCaptureRate = 0, oppExpansionRate = 0, oppDefenseRate = 0) {
    let score = 0;
    const neighbors = getNeighbors(x, y, size);

    if (!isSafeMove(board, liberties, x, y, size)) {
        if (!isCapture(board, x, y, size)) return -Infinity;
    }

    if (isCapture(board, x, y, size)) {
        const captureSize = getCapturableGroupSize(board, x, y, size);
        score += 1000 + captureSize * 50;
    }

    if (isDefend(board, x, y, size)) {
        const defendSize = getDefendableGroupSize(board, x, y, size);
        score += 900 + defendSize * 40;
    }

    // two-eye immortality
    const friendlyNeighbors = neighbors.filter(([nx, ny]) => board[nx][ny] === 'X');
    if (friendlyNeighbors.length > 0) {
        const [fx, fy]    = friendlyNeighbors[0];
        const group       = getGroup(board, fx, fy, size);
        const currentEyes = countDistinctEmptyGroups(board, group, size);
        if (currentEyes >= 2) {
            if (!isCapture(board, x, y, size) && !isDefend(board, x, y, size)) score -= 300;
        }
    }

    if (config.style === 'illuminati' || config.style === 'pattern') {
        const eyesBefore = countEyesForColor(board, x, y, size, 'X');
        const eyesAfter  = simulateEyeCount(board, x, y, size, 'X');
        const eyeGain    = eyesAfter - eyesBefore;
        if (eyeGain > 0) score += eyeGain >= 2 ? 800 : 400 * eyeGain;

        const enemyEyesBefore = countEyesForColor(board, x, y, size, 'O');
        const enemyEyesAfter  = simulateEyeCount(board, x, y, size, 'O');
        const eyeBlock        = enemyEyesBefore - enemyEyesAfter;
        if (eyeBlock > 0) score += eyeBlock * 300;
    }

    score += getSmotherValue(board, liberties, x, y, size) * 200;
    score += detectLadder(board, x, y, size) * 150;
    score += getConnectionValue(board, x, y, size) * 120;

    for (const [nx, ny] of neighbors) {
        if (board[nx][ny] !== 'X') continue;
        const lib = liberties[nx][ny] ?? 99;
        if (lib === 1) score += 200;
        if (lib === 2) score += 50;
    }

    if (config.style !== 'easy' && matchesAnyPattern(board, x, y, size, patterns)) {
        score += 150;
    }

    // ── Influence-only territory scoring (no simulation) ──────────────────────
    const infVal = influence[x][y];
    score += infVal * 25; // slightly higher weight since we dropped territory sim

    // territory prediction from cached map
    if (territory[x][y] === 'O') score += 120;   // invading enemy territory
    if (territory[x][y] === null) score += 60;    // claiming contested

    // influence of neighboring cells — how much does this move extend our reach
    let neighborInfGain = 0;
    for (const [nx, ny] of neighbors) {
        if (board[nx][ny] === '.') {
            neighborInfGain += influence[nx][ny]; // positive = we already influence it
        }
    }
    score += neighborInfGain * 10;

    const jumpOffsets = [[2,0],[-2,0],[0,2],[0,-2]];
    for (const [dx, dy] of jumpOffsets) {
        const jx = x + dx, jy = y + dy;
        if (jx >= 0 && jx < size && jy >= 0 && jy < size && board[jx][jy] === 'X') {
            score += 40;
            break;
        }
    }

    const openCount   = neighbors.filter(([nx, ny]) => board[nx][ny] === '.').length;
    const enemyCount  = neighbors.filter(([nx, ny]) => board[nx][ny] === 'O').length;
    const friendCount = neighbors.filter(([nx, ny]) => board[nx][ny] === 'X').length;

    if (config.komiStrat === 'aggressive' && lead < 0) score += openCount * 20;
    if (config.komiStrat === 'desperate') {
        const onEdge = x === 0 || x === size-1 || y === 0 || y === size-1 ? 1 : 0;
        score += openCount * 25 + onEdge * 30;
    }

    if (oppCaptureRate > 0.3)   score += isDefend(board, x, y, size) ? oppCaptureRate * 200 : 0;
    if (oppExpansionRate > 0.3) score += enemyCount * oppExpansionRate * 30;
    if (oppDefenseRate > 0.3)   score += getSmotherValue(board, liberties, x, y, size) * oppDefenseRate * 100;

    switch (config.style) {
        case 'aggressive':   score += enemyCount * 25 + openCount * 5;   break;
        case 'anti-spread':  score += enemyCount * 30 + friendCount * 5;  break;
        case 'illuminati':   score += friendCount * 15 + openCount * 8;   break;
        case 'pattern':      score += friendCount * 10 + openCount * 10;  break;
        case 'easy':         score += openCount * 15 + friendCount * 5;   break;
    }

    if (!isEndgame) {
        const cornerOffset = Math.min(2, size - 3);
        const isCornerZone =
            (x <= cornerOffset || x >= size - 1 - cornerOffset) &&
            (y <= cornerOffset || y >= size - 1 - cornerOffset);
        if (isCornerZone) score += 30;
    }

    if (isEndgame) {
        if (territory[x][y] === 'X') score -= 200;
        const onBorder = neighbors.some(([nx, ny]) =>
            territory[nx]?.[ny] === 'O' || territory[nx]?.[ny] === null
        );
        if (onBorder) score += 80;
        if (friendCount >= 2) score += 60;
    }

    if (x % 2 === 0 && y % 2 === 0) score -= 20;

    return score;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPENING BOOK
// ═══════════════════════════════════════════════════════════════════════════════

function getOpeningMove(board, validMoves, size, boardSize) {
    const OPENING_BOOK = {
        5: [[1,1],[1,3],[3,1],[3,3],[2,2]],
        7: [[1,1],[1,5],[5,1],[5,5],[2,2],[2,4],[4,2],[4,4],[3,3]],
        9: [[2,2],[2,6],[6,2],[6,6],[2,4],[4,2],[4,6],[6,4],[4,4],[3,3],[5,5],[3,5],[5,3]],
    };

    const book = OPENING_BOOK[boardSize] ?? OPENING_BOOK[9];
    for (const [x, y] of book) {
        if (x < size && y < size && validMoves[x]?.[y] && board[x][y] === '.') {
            return [x, y];
        }
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LADDER DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

function detectLadder(board, x, y, size) {
    let value = 0;

    for (const [nx, ny] of getNeighbors(x, y, size)) {
        if (board[nx][ny] !== 'O') continue;
        const group = getGroup(board, nx, ny, size);
        const libs  = countGroupLiberties(board, group, size);
        if (libs === 2) {
            const sim     = boardToArray(board);
            sim[x][y]     = 'X';
            const newLibs = countGroupLiberties(sim, group, size);
            if (newLibs === 1) value += 1;
        }
    }

    for (const [nx, ny] of getNeighbors(x, y, size)) {
        if (board[nx][ny] !== 'X') continue;
        const group = getGroup(board, nx, ny, size);
        const libs  = countGroupLiberties(board, group, size);
        if (libs === 1) {
            const sim     = boardToArray(board);
            sim[x][y]     = 'X';
            const newLibs = countGroupLiberties(sim, group, size);
            if (newLibs >= 2) value += 2;
        }
    }

    return value;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTION PRIORITY
// ═══════════════════════════════════════════════════════════════════════════════

function getConnectionValue(board, x, y, size) {
    const neighbors         = getNeighbors(x, y, size);
    const friendlyNeighbors = neighbors.filter(([nx, ny]) => board[nx][ny] === 'X');
    if (friendlyNeighbors.length < 2) return 0;

    const groupIds = new Set();
    for (const [nx, ny] of friendlyNeighbors) {
        const group = getGroup(board, nx, ny, size);
        const id    = group.map(([gx, gy]) => `${gx},${gy}`).sort().join('|');
        groupIds.add(id);
    }

    if (groupIds.size < 2) return 0;

    let vulnerability = 0;
    for (const [nx, ny] of friendlyNeighbors) {
        const group = getGroup(board, nx, ny, size);
        const libs  = countGroupLiberties(board, group, size);
        if (libs <= 2) vulnerability += 3 - libs;
    }

    return groupIds.size + vulnerability;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPPONENT ADAPTATION
// ═══════════════════════════════════════════════════════════════════════════════

function analyzeOppMove(prevBoard, currentBoard, size, history) {
    let oppX = -1, oppY = -1;

    for (let x = 0; x < size; x++)
        for (let y = 0; y < size; y++)
            if (prevBoard[x][y] !== 'O' && currentBoard[x][y] === 'O') {
                oppX = x; oppY = y;
            }

    if (oppX === -1) { history.push('pass'); return; }

    const neighbors = getNeighbors(oppX, oppY, size);
    let captured    = false;

    for (let x = 0; x < size; x++)
        for (let y = 0; y < size; y++)
            if (prevBoard[x][y] === 'X' && currentBoard[x][y] === '.') captured = true;

    if (captured)    { history.push('capture'); return; }

    const defendedOwn = neighbors.some(([nx, ny]) => currentBoard[nx][ny] === 'O');
    if (defendedOwn) { history.push('defend');  return; }

    history.push('expand');
}

// ═══════════════════════════════════════════════════════════════════════════════
// INFLUENCE + TERRITORY
// ═══════════════════════════════════════════════════════════════════════════════

function buildInfluenceMap(board, size) {
    const inf       = Array.from({ length: size }, () => new Array(size).fill(0));
    const DECAY     = 0.85;
    const MAX_RANGE = 4;

    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            if (board[x][y] === '#') continue;
            const val = board[x][y] === 'X' ? 1 : board[x][y] === 'O' ? -1 : 0;
            if (val === 0) continue;

            const queue   = [[x, y, 1.0]];
            const visited = new Set([`${x},${y}`]);

            while (queue.length) {
                const [cx, cy, strength] = queue.shift();
                inf[cx][cy] += val * strength;
                if (strength < DECAY ** MAX_RANGE) continue;
                for (const [nx, ny] of getNeighbors(cx, cy, size)) {
                    const key = `${nx},${ny}`;
                    if (visited.has(key) || board[nx][ny] === '#') continue;
                    visited.add(key);
                    queue.push([nx, ny, strength * DECAY]);
                }
            }
        }
    }
    return inf;
}

function predictTerritory(board, influence, size) {
    const territory = Array.from({ length: size }, () => new Array(size).fill(null));
    const THRESHOLD = 0.3;
    for (let x = 0; x < size; x++)
        for (let y = 0; y < size; y++) {
            if (board[x][y] !== '.') continue;
            if (influence[x][y] > THRESHOLD)  territory[x][y] = 'X';
            if (influence[x][y] < -THRESHOLD) territory[x][y] = 'O';
        }
    return territory;
}

function countPredictedTerritory(territory, size) {
    let ours = 0, theirs = 0, contested = 0;
    for (let x = 0; x < size; x++)
        for (let y = 0; y < size; y++) {
            if      (territory[x][y] === 'X') ours++;
            else if (territory[x][y] === 'O') theirs++;
            else if (territory[x][y] === null) contested++;
        }
    return { ours, theirs, contested };
}

// ═══════════════════════════════════════════════════════════════════════════════
// KO DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

function boardToArray(board) {
    return board.map(col => typeof col === 'string' ? col.split('') : [...col]);
}

function boardSnapshot(board) {
    return board.join('|');
}

function simulateMoveBoard(board, x, y, size) {
    const sim = boardToArray(board);
    sim[x][y] = 'X';
    applyCaptures(sim, x, y, size, 'X');
    return sim;
}

function isKoMove(board, history, x, y, size) {
    if (history.length === 0) return false;
    const simArr   = simulateMoveBoard(board, x, y, size);
    const snapshot = simArr.map(col => col.join('')).join('|');
    return history.includes(snapshot);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMART PASS
// ═══════════════════════════════════════════════════════════════════════════════

function shouldPass(board, validMoves, liberties, size, komi,
                    oppPassed, lead, filledPct, isEndgame) {
    if (oppPassed && lead > 0) return true;
    if (filledPct > 0.80 && lead > 2) return true;

    if (isEndgame && lead > 0) {
        let hasUseful = false;
        for (let x = 0; x < size && !hasUseful; x++)
            for (let y = 0; y < size && !hasUseful; y++) {
                if (!validMoves[x][y]) continue;
                const neighbors = getNeighbors(x, y, size);
                if (neighbors.some(([nx, ny]) => board[nx][ny] === 'O' && liberties[nx][ny] <= 2)) hasUseful = true;
                if (neighbors.some(([nx, ny]) => board[nx][ny] === 'X' && liberties[nx][ny] <= 1)) hasUseful = true;
            }
        if (!hasUseful) return true;
    }

    if (oppPassed) {
        let hasUseful = false;
        for (let x = 0; x < size && !hasUseful; x++)
            for (let y = 0; y < size && !hasUseful; y++) {
                if (!validMoves[x][y]) continue;
                const neighbors = getNeighbors(x, y, size);
                if (neighbors.some(([nx, ny]) => board[nx][ny] === 'O' && liberties[nx][ny] <= 2)) hasUseful = true;
                if (neighbors.some(([nx, ny]) => board[nx][ny] === 'X' && liberties[nx][ny] <= 1)) hasUseful = true;
            }
        if (!hasUseful) return true;
    }

    return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getNeighbors(x, y, size) {
    const n = [];
    if (x > 0)        n.push([x-1, y]);
    if (x < size - 1) n.push([x+1, y]);
    if (y > 0)        n.push([x, y-1]);
    if (y < size - 1) n.push([x, y+1]);
    return n;
}

function getGroup(board, x, y, size) {
    const color   = board[x][y];
    const visited = new Set();
    const queue   = [[x, y]];
    const cells   = [];
    while (queue.length) {
        const [cx, cy] = queue.shift();
        const key      = `${cx},${cy}`;
        if (visited.has(key)) continue;
        visited.add(key);
        cells.push([cx, cy]);
        for (const [nx, ny] of getNeighbors(cx, cy, size))
            if (!visited.has(`${nx},${ny}`) && board[nx][ny] === color)
                queue.push([nx, ny]);
    }
    return cells;
}

function countGroupLiberties(board, group, size) {
    const libs = new Set();
    for (const [x, y] of group)
        for (const [nx, ny] of getNeighbors(x, y, size))
            if (board[nx][ny] === '.') libs.add(`${nx},${ny}`);
    return libs.size;
}

function isSafeMove(board, liberties, x, y, size) {
    const neighbors  = getNeighbors(x, y, size);
    const emptyCount = neighbors.filter(([nx, ny]) => board[nx][ny] === '.').length;
    if (emptyCount >= 2) return true;
    return neighbors.some(([nx, ny]) => board[nx][ny] === 'X' && liberties[nx][ny] >= 3);
}

function isCapture(board, x, y, size) {
    for (const [nx, ny] of getNeighbors(x, y, size)) {
        if (board[nx][ny] !== 'O') continue;
        const group = getGroup(board, nx, ny, size);
        if (countGroupLiberties(board, group, size) === 1) return true;
    }
    return false;
}

function isDefend(board, x, y, size) {
    for (const [nx, ny] of getNeighbors(x, y, size)) {
        if (board[nx][ny] !== 'X') continue;
        const group = getGroup(board, nx, ny, size);
        if (countGroupLiberties(board, group, size) === 1) return true;
    }
    return false;
}

function getCapturableGroupSize(board, x, y, size) {
    let total = 0;
    for (const [nx, ny] of getNeighbors(x, y, size)) {
        if (board[nx][ny] !== 'O') continue;
        const group = getGroup(board, nx, ny, size);
        if (countGroupLiberties(board, group, size) === 1) total += group.length;
    }
    return total;
}

function getDefendableGroupSize(board, x, y, size) {
    let total = 0;
    for (const [nx, ny] of getNeighbors(x, y, size)) {
        if (board[nx][ny] !== 'X') continue;
        const group = getGroup(board, nx, ny, size);
        if (countGroupLiberties(board, group, size) === 1) total += group.length;
    }
    return total;
}

function getSmotherValue(board, liberties, x, y, size) {
    let value = 0;
    for (const [nx, ny] of getNeighbors(x, y, size))
        if (board[nx][ny] === 'O' && liberties[nx][ny] === 2) value++;
    return value;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EYE ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

function countEyesForColor(board, x, y, size, color) {
    const neighbors = getNeighbors(x, y, size);
    const friendly  = neighbors.filter(([nx, ny]) => board[nx][ny] === color);
    if (friendly.length === 0) return 0;
    const [fx, fy] = friendly[0];
    const group    = getGroup(board, fx, fy, size);
    return countDistinctEmptyGroups(board, group, size);
}

function simulateEyeCount(board, x, y, size, color) {
    const sim    = boardToArray(board);
    sim[x][y]    = color;
    const neighbors = getNeighbors(x, y, size);
    const friendly  = neighbors.filter(([nx, ny]) => sim[nx][ny] === color);
    if (friendly.length === 0) return 0;
    const [fx, fy] = friendly[0];
    const group    = getGroup(sim, fx, fy, size);
    return countDistinctEmptyGroups(sim, group, size);
}

function countDistinctEmptyGroups(board, group, size) {
    const visited = new Set();
    let   eyes    = 0;
    for (const [gx, gy] of group) {
        for (const [nx, ny] of getNeighbors(gx, gy, size)) {
            if (board[nx][ny] !== '.') continue;
            const key = `${nx},${ny}`;
            if (visited.has(key)) continue;
            const emptyGroup = getGroup(board, nx, ny, size);
            emptyGroup.forEach(([ex, ey]) => visited.add(`${ex},${ey}`));
            eyes++;
        }
    }
    return eyes;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATTERN MATCHING
// ═══════════════════════════════════════════════════════════════════════════════

function rotate90(pattern) {
    return [
        `${pattern[2][0]}${pattern[1][0]}${pattern[0][0]}`,
        `${pattern[2][1]}${pattern[1][1]}${pattern[0][1]}`,
        `${pattern[2][2]}${pattern[1][2]}${pattern[0][2]}`,
    ];
}

function verticalMirror(p)   { return [p[2], p[1], p[0]]; }
function horizontalMirror(p) {
    return [
        p[0].split('').reverse().join(''),
        p[1].split('').reverse().join(''),
        p[2].split('').reverse().join(''),
    ];
}

function expandPatterns(base) {
    const rotated  = [
        ...base,
        ...base.map(rotate90),
        ...base.map(p => rotate90(rotate90(p))),
        ...base.map(p => rotate90(rotate90(rotate90(p)))),
    ];
    const mirrored = [...rotated, ...rotated.map(verticalMirror)];
    return [...mirrored, ...mirrored.map(horizontalMirror)];
}

function matchesPattern(board, x, y, size, pattern) {
    const neighborhood = [
        [board[x-1]?.[y-1], board[x-1]?.[y], board[x-1]?.[y+1]],
        [board[x]?.[y-1],   board[x]?.[y],   board[x]?.[y+1]  ],
        [board[x+1]?.[y-1], board[x+1]?.[y], board[x+1]?.[y+1]],
    ];
    const chars = pattern.join('').split('');
    const flat  = neighborhood.flat();
    return chars.every((ch, i) => {
        const cell = flat[i];
        switch (ch) {
            case 'X': return cell === 'X';
            case 'O': return cell === 'O';
            case 'x': return cell !== 'O';
            case 'o': return cell !== 'X';
            case '.': return cell === '.';
            case ' ': return cell === undefined || cell === '#';
            case '?': return true;
            default:  return true;
        }
    });
}

function matchesAnyPattern(board, x, y, size, patterns) {
    return patterns.some(p => matchesPattern(board, x, y, size, p));
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOARD DISPLAY
// ═══════════════════════════════════════════════════════════════════════════════

function printBoard(ns, board, territory, size) {
    for (let y = size - 1; y >= 0; y--) {
        let row = '  ';
        for (let x = 0; x < size; x++) {
            const cell = board[x][y];
            if      (cell === 'X') row += '⬛';
            else if (cell === 'O') row += '⬜';
            else if (cell === '#') row += '🟫';
            else if (territory?.[x]?.[y] === 'X') row += '🟦';
            else if (territory?.[x]?.[y] === 'O') row += '🟥';
            else                   row += '🟩';
        }
        ns.print(row);
    }
    ns.print('  ⬛us ⬜them 🟦ourTerr 🟥theirTerr 🟩contested');
}