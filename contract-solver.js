/**
 * contract-solver.js — Coding Contract Scanner & Solver
 *
 * Scans every server on the network for .cct files, attempts to solve
 * all known contract types automatically, and reports results.
 *
 * Runs once and exits. Re-run periodically or alias it.
 *
 * Usage: run contract-solver.js
 * Compatible with Bitburner 3.0 API.
 */

// ─── Network scan ─────────────────────────────────────────────────────────────

function getAllServers(ns) {
    const visited = new Set(['home']);
    const queue   = ['home'];
    while (queue.length > 0) {
        const host = queue.shift();
        for (const n of ns.scan(host)) {
            if (!visited.has(n)) { visited.add(n); queue.push(n); }
        }
    }
    return [...visited];
}

// ─── Solvers ──────────────────────────────────────────────────────────────────

function solve(type, data) {
    switch (type) {
        case 'Find Largest Prime Factor':
            return solveLargestPrime(data);
        case 'Subarray with Maximum Sum':
            return solveMaxSubarray(data);
        case 'Total Ways to Sum':
            return solveTotalWaysToSum(data);
        case 'Total Ways to Sum II':
            return solveTotalWaysToSumII(data);
        case 'Spiralize Matrix':
            return spiralizeMatrix(data);
        case 'Array Jumping Game':
            return solveArrayJump(data);
        case 'Array Jumping Game II':
            return solveArrayJumpII(data);
        case 'Merge Overlapping Intervals':
            return mergIntervals(data);
        case 'Generate IP Addresses':
            return generateIPs(data);
        case 'Algorithmic Stock Trader I':
            return stockTrader1(data);
        case 'Algorithmic Stock Trader II':
            return stockTrader2(data);
        case 'Algorithmic Stock Trader III':
            return stockTrader3(data);
        case 'Algorithmic Stock Trader IV':
            return stockTrader4(data);
        case 'Minimum Path Sum in a Triangle':
            return minTrianglePath(data);
        case 'Unique Paths in a Grid I':
            return uniquePathsI(data);
        case 'Unique Paths in a Grid II':
            return uniquePathsII(data);
        case 'Shortest Path in a Grid':
            return shortestPathGrid(data);
        case 'Sanitize Parentheses in Expression':
            return sanitizeParens(data);
        case 'Find All Valid Math Expressions':
            return findMathExpressions(data);
        case 'HammingCodes: Integer to Encoded Binary':
            return hammingEncode(data);
        case 'HammingCodes: Encoded Binary to Integer':
            return hammingDecode(data);
        case 'Proper 2-Coloring of a Graph':
            return twoColor(data);
        case 'Compression I: RLE Compression':
            return rleCompress(data);
        case 'Compression II: LZ Decompression':
            return lzDecompress(data);
        case 'Compression III: LZ Compression':
            return lzCompress(data);
        case 'Encryption I: Caesar Cipher':
            return caesarCipher(data);
        case 'Encryption II: Vigenère Cipher':
            return vigenereCipher(data);
        case 'Square Root':
            return solveSquareRoot(data);
        case 'Total Number of Primes':
            return countPrimes(data);
        case 'Total Number of Primes Below N':
        case 'Count Primes':
            return countPrimes(data);
        default:
            return null;
    }
}

// ── Find Largest Prime Factor ──────────────────────────────────────────────────
function solveLargestPrime(n) {
    let largest = 1, num = n;
    for (let d = 2; d * d <= num; d++) {
        while (num % d === 0) { largest = d; num = Math.floor(num / d); }
    }
    return num > 1 ? num : largest;
}

// ── Subarray with Maximum Sum (Kadane's) ──────────────────────────────────────
function solveMaxSubarray(arr) {
    let max = arr[0], cur = arr[0];
    for (let i = 1; i < arr.length; i++) {
        cur = Math.max(arr[i], cur + arr[i]);
        max = Math.max(max, cur);
    }
    return max;
}

// ── Total Ways to Sum ─────────────────────────────────────────────────────────
function solveTotalWaysToSum(n) {
    const dp = new Array(n + 1).fill(0);
    dp[0] = 1;
    for (let i = 1; i <= n - 1; i++) {
        for (let j = i; j <= n; j++) dp[j] += dp[j - i];
    }
    return dp[n];
}

// ── Total Ways to Sum II ──────────────────────────────────────────────────────
function solveTotalWaysToSumII([n, nums]) {
    const dp = new Array(n + 1).fill(0);
    dp[0] = 1;
    for (const num of nums) {
        for (let j = num; j <= n; j++) dp[j] += dp[j - num];
    }
    return dp[n];
}

// ── Spiralize Matrix ──────────────────────────────────────────────────────────
function spiralizeMatrix(matrix) {
    const result = [];
    let top = 0, bot = matrix.length - 1, left = 0, right = matrix[0].length - 1;
    while (top <= bot && left <= right) {
        for (let i = left; i <= right; i++) result.push(matrix[top][i]);
        top++;
        for (let i = top; i <= bot; i++) result.push(matrix[i][right]);
        right--;
        if (top <= bot) {
            for (let i = right; i >= left; i--) result.push(matrix[bot][i]);
            bot--;
        }
        if (left <= right) {
            for (let i = bot; i >= top; i--) result.push(matrix[i][left]);
            left++;
        }
    }
    return result;
}

// ── Array Jumping Game ────────────────────────────────────────────────────────
function solveArrayJump(arr) {
    let reach = 0;
    for (let i = 0; i < arr.length; i++) {
        if (i > reach) return 0;
        reach = Math.max(reach, i + arr[i]);
    }
    return 1;
}

// ── Array Jumping Game II ─────────────────────────────────────────────────────
function solveArrayJumpII(arr) {
    let jumps = 0, curEnd = 0, farthest = 0;
    for (let i = 0; i < arr.length - 1; i++) {
        farthest = Math.max(farthest, i + arr[i]);
        if (i === curEnd) { jumps++; curEnd = farthest; }
    }
    return curEnd >= arr.length - 1 ? jumps : 0;
}

// ── Merge Overlapping Intervals ───────────────────────────────────────────────
function mergIntervals(intervals) {
    const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
    const result = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const last = result[result.length - 1];
        if (sorted[i][0] <= last[1]) last[1] = Math.max(last[1], sorted[i][1]);
        else result.push(sorted[i]);
    }
    return result;
}

// ── Generate IP Addresses ─────────────────────────────────────────────────────
function generateIPs(s) {
    const result = [];
    for (let a = 1; a <= 3; a++)
    for (let b = 1; b <= 3; b++)
    for (let c = 1; c <= 3; c++) {
        const d = s.length - a - b - c;
        if (d < 1 || d > 3) continue;
        const parts = [s.slice(0,a), s.slice(a,a+b), s.slice(a+b,a+b+c), s.slice(a+b+c)];
        if (parts.some(p => parseInt(p) > 255 || (p.length > 1 && p[0] === '0'))) continue;
        result.push(parts.join('.'));
    }
    return result;
}

// ── Stock Traders ─────────────────────────────────────────────────────────────
function stockTrader1(prices) {
    let min = Infinity, max = 0;
    for (const p of prices) { min = Math.min(min, p); max = Math.max(max, p - min); }
    return max;
}
function stockTrader2(prices) {
    let profit = 0;
    for (let i = 1; i < prices.length; i++) if (prices[i] > prices[i-1]) profit += prices[i] - prices[i-1];
    return profit;
}
function stockTrader3(prices) { return stockTrader4([2, prices]); }
function stockTrader4([k, prices]) {
    if (k === 0 || prices.length === 0) return 0;
    if (k >= Math.floor(prices.length / 2)) return stockTrader2(prices);
    const dp = Array.from({length: k+1}, () => Array(prices.length).fill(0));
    for (let t = 1; t <= k; t++) {
        let maxSoFar = -prices[0];
        for (let d = 1; d < prices.length; d++) {
            dp[t][d] = Math.max(dp[t][d-1], prices[d] + maxSoFar);
            maxSoFar = Math.max(maxSoFar, dp[t-1][d] - prices[d]);
        }
    }
    return dp[k][prices.length - 1];
}

// ── Minimum Path Sum in Triangle ──────────────────────────────────────────────
function minTrianglePath(triangle) {
    const dp = [...triangle[triangle.length - 1]];
    for (let i = triangle.length - 2; i >= 0; i--)
        for (let j = 0; j <= i; j++)
            dp[j] = triangle[i][j] + Math.min(dp[j], dp[j+1]);
    return dp[0];
}

// ── Unique Paths I ────────────────────────────────────────────────────────────
function uniquePathsI([m, n]) {
    const dp = Array(m).fill(null).map(() => Array(n).fill(1));
    for (let i = 1; i < m; i++) for (let j = 1; j < n; j++) dp[i][j] = dp[i-1][j] + dp[i][j-1];
    return dp[m-1][n-1];
}

// ── Unique Paths II ───────────────────────────────────────────────────────────
function uniquePathsII(grid) {
    const m = grid.length, n = grid[0].length;
    const dp = Array(m).fill(null).map(() => Array(n).fill(0));
    for (let i = 0; i < m; i++) {
        for (let j = 0; j < n; j++) {
            if (grid[i][j] === 1) { dp[i][j] = 0; continue; }
            if (i === 0 && j === 0) { dp[i][j] = 1; continue; }
            dp[i][j] = (i > 0 ? dp[i-1][j] : 0) + (j > 0 ? dp[i][j-1] : 0);
        }
    }
    return dp[m-1][n-1];
}

// ── Shortest Path in Grid ─────────────────────────────────────────────────────
function shortestPathGrid(grid) {
    const rows = grid.length, cols = grid[0].length;
    if (grid[0][0] === 1 || grid[rows-1][cols-1] === 1) return '';
    const visited = Array(rows).fill(null).map(() => Array(cols).fill(false));
    const queue = [[0, 0, '']];
    const dirs = [[-1,0,'U'],[1,0,'D'],[0,-1,'L'],[0,1,'R']];
    visited[0][0] = true;
    while (queue.length > 0) {
        const [r, c, path] = queue.shift();
        if (r === rows-1 && c === cols-1) return path;
        for (const [dr, dc, d] of dirs) {
            const nr = r+dr, nc = c+dc;
            if (nr>=0 && nr<rows && nc>=0 && nc<cols && !visited[nr][nc] && grid[nr][nc]===0) {
                visited[nr][nc] = true;
                queue.push([nr, nc, path+d]);
            }
        }
    }
    return '';
}

// ── Sanitize Parentheses ──────────────────────────────────────────────────────
function sanitizeParens(s) {
    const result = new Set();
    function dfs(str, idx, lcount, rcount, expr) {
        if (idx === str.length) {
            if (lcount === 0 && rcount === 0) result.add(expr);
            return;
        }
        const c = str[idx];
        if (c === '(' && lcount > 0) dfs(str, idx+1, lcount-1, rcount, expr);
        if (c === ')' && rcount > 0) dfs(str, idx+1, lcount, rcount-1, expr);
        dfs(str, idx+1, lcount, rcount, expr+c);
    }
    let l = 0, r = 0;
    for (const c of s) { if (c==='(') l++; else if (c===')') l>0 ? l-- : r++; }
    dfs(s, 0, l, r, '');
    return [...result];
}

// ── Find All Valid Math Expressions ──────────────────────────────────────────
function findMathExpressions([num, target]) {
    const result = [];
    function dfs(idx, path, eval_, mult) {
        if (idx === num.length) { if (eval_ === target) result.push(path); return; }
        for (let i = idx+1; i <= num.length; i++) {
            const s = num.slice(idx, i);
            if (s.length > 1 && s[0] === '0') break;
            const n = parseInt(s);
            if (idx === 0) dfs(i, s, n, n);
            else {
                dfs(i, path+'+'+s, eval_+n, n);
                dfs(i, path+'-'+s, eval_-n, -n);
                dfs(i, path+'*'+s, eval_-mult+mult*n, mult*n);
            }
        }
    }
    dfs(0, '', 0, 0);
    return result;
}

// ── HammingCodes: Encode ──────────────────────────────────────────────────────
function hammingEncode(n) {
    const bits = n.toString(2).split('').map(Number);
    const m = bits.length;
    let r = 0;
    while ((1 << r) < m + r + 1) r++;
    const encoded = new Array(m + r + 1).fill(0);
    let j = 0;
    for (let i = 1; i < encoded.length; i++) {
        if ((i & (i-1)) !== 0 && i !== 0) encoded[i] = bits[j++] ?? 0; // data bit
    }
    for (let i = 0; i < r; i++) {
        const pos = 1 << i;
        let parity = 0;
        for (let k = pos; k < encoded.length; k++) if (k & pos) parity ^= encoded[k];
        encoded[pos] = parity;
    }
    // overall parity
    encoded[0] = encoded.reduce((a, b) => a ^ b, 0);
    return encoded.join('');
}

// ── HammingCodes: Decode ──────────────────────────────────────────────────────
function hammingDecode(s) {
    const bits = s.split('').map(Number);
    const len = bits.length;
    let err = 0;
    for (let i = 0; i < len; i++) if (bits[i] === 1) err ^= i;
    if (err !== 0) bits[err] = bits[err] ^ 1;
    let result = '';
    for (let i = 1; i < len; i++) if ((i & (i-1)) !== 0) result += bits[i];
    return parseInt(result, 2);
}

// ── Proper 2-Coloring ─────────────────────────────────────────────────────────
function twoColor([n, edges]) {
    const color = new Array(n).fill(-1);
    const adj   = Array.from({length: n}, () => []);
    for (const [u, v] of edges) { adj[u].push(v); adj[v].push(u); }
    for (let start = 0; start < n; start++) {
        if (color[start] !== -1) continue;
        const queue = [start];
        color[start] = 0;
        while (queue.length > 0) {
            const node = queue.shift();
            for (const nb of adj[node]) {
                if (color[nb] === -1) { color[nb] = 1 - color[node]; queue.push(nb); }
                else if (color[nb] === color[node]) return [];
            }
        }
    }
    return color;
}

// ── RLE Compression ───────────────────────────────────────────────────────────
function rleCompress(s) {
    let result = '', i = 0;
    while (i < s.length) {
        let count = 1;
        while (i + count < s.length && s[i+count] === s[i] && count < 9) count++;
        result += count + s[i];
        i += count;
    }
    return result;
}

// ── LZ Decompression ──────────────────────────────────────────────────────────
function lzDecompress(s) {
    let result = '', i = 0;
    while (i < s.length) {
        const len1 = parseInt(s[i++]);
        if (len1 > 0) { result += s.slice(i, i + len1); i += len1; }
        if (i >= s.length) break;
        const len2 = parseInt(s[i++]);
        if (len2 === 0) continue;
        const offset = parseInt(s[i++]);
        const start  = result.length - offset;
        for (let j = 0; j < len2; j++) result += result[start + (j % offset)];
    }
    return result;
}

// ── LZ Compression ────────────────────────────────────────────────────────────
function lzCompress(s) {
    // Type 1 chunks: literal, Type 2: back-reference
    let result = '', i = 0;
    while (i < s.length) {
        // Find longest back-reference
        let bestLen = 0, bestOffset = 0;
        for (let offset = 1; offset <= Math.min(i, 9); offset++) {
            let len = 0;
            while (len < 9 && i + len < s.length && s[i + len] === s[i - offset + (len % offset)]) len++;
            if (len > bestLen) { bestLen = len; bestOffset = offset; }
        }
        // Literal run
        if (bestLen < 3) {
            let litLen = 0;
            const litStart = i;
            while (litLen < 9 && i < s.length) {
                // Check if a back-ref from here would be better
                let futBestLen = 0;
                for (let offset = 1; offset <= Math.min(i, 9); offset++) {
                    let len = 0;
                    while (len < 9 && i + len < s.length && s[i + len] === s[i - offset + (len % offset)]) len++;
                    if (len > futBestLen) futBestLen = len;
                }
                if (futBestLen >= 3 && litLen > 0) break;
                litLen++; i++;
            }
            result += litLen + s.slice(litStart, litStart + litLen);
            result += '0'; // no back-ref
        } else {
            result += '0'; // no literal
            result += bestLen + '' + bestOffset;
            i += bestLen;
        }
    }
    return result;
}

// ── Caesar Cipher ─────────────────────────────────────────────────────────────
function caesarCipher([plaintext, shift]) {
    return plaintext.split('').map(c => {
        if (c === ' ') return ' ';
        return String.fromCharCode(((c.charCodeAt(0) - 65 - shift + 26) % 26) + 65);
    }).join('');
}

// ── Vigenère Cipher ───────────────────────────────────────────────────────────
function vigenereCipher([plaintext, key]) {
    let result = '', ki = 0;
    for (const c of plaintext) {
        if (c === ' ') { result += ' '; continue; }
        const shift = key[ki % key.length].charCodeAt(0) - 65;
        result += String.fromCharCode(((c.charCodeAt(0) - 65 + shift) % 26) + 65);
        ki++;
    }
    return result;
}

// ── Square Root ───────────────────────────────────────────────────────────────
function solveSquareRoot(n) {
    // Contract gives a large integer, expects floor(sqrt(n)) as a string
    // Use BigInt Newton's method for precision
    const num = BigInt(n.toString());
    if (num === 0n) return '0';
    if (num === 1n) return '1';
    let x = num;
    let y = (x + 1n) / 2n;
    while (y < x) {
        x = y;
        y = (x + num / x) / 2n;
    }
    // x is now floor(sqrt(num))
    return x.toString();
}

// ── Count Primes ──────────────────────────────────────────────────────────────
function countPrimes(n) {
    // Sieve of Eratosthenes — count primes below n
    if (n <= 2) return 0;
    const sieve = new Uint8Array(n).fill(1);
    sieve[0] = sieve[1] = 0;
    for (let i = 2; i * i < n; i++) {
        if (sieve[i]) for (let j = i*i; j < n; j += i) sieve[j] = 0;
    }
    return sieve.reduce((a, b) => a + b, 0);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');

    const servers   = getAllServers(ns);
    let solved      = 0;
    let failed      = 0;
    let unsupported = 0;

    for (const host of servers) {
        const files = ns.ls(host, '.cct');
        for (const file of files) {
            const type  = ns.codingcontract.getContractType(file, host);
            const data  = ns.codingcontract.getData(file, host);
            const tries = ns.codingcontract.getNumTriesRemaining(file, host);

            let answer;
            try { answer = solve(type, data); } catch (e) { answer = null; }

            if (answer === null) {
                unsupported++;
                ns.tprint(`❓ ${host} — ${type} (${tries} tries left, unsupported)`);
                continue;
            }

            const reward = ns.codingcontract.attempt(answer, file, host);
            if (reward) {
                solved++;
                ns.tprint(`✅ ${host} — ${type} → ${reward}`);
            } else {
                failed++;
                ns.tprint(`❌ ${host} — ${type} (${tries - 1} tries left)`);
            }
        }
    }

    ns.tprint(`─────────────────────────────────────────`);
    ns.tprint(`📄 Done: ${solved} solved  ${failed} failed  ${unsupported} unsupported`);
}