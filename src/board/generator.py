"""
Queendoku board generator  (the "Queens" puzzle).

Board: an n x n grid partitioned into n connected regions. A solution places n
queens with exactly one in every row, every column, and every region, and no
two queens adjacent (orthogonally OR diagonally).

Because one-per-row and one-per-column already forbid shared rows/columns, only
DIAGONAL adjacency between consecutive rows can ever occur. A placement is thus
a permutation p with |p[r] - p[r+1]| >= 2 for all r.

A good puzzle needs a UNIQUE solution. Random region layouts almost never are,
so we generate a layout and then REFINE it: while an alternate solution exists,
move one of its (non-seed) queen cells into a neighbouring region -- that forces
two alternate-queens into one region and kills the alternate, while leaving the
intended solution (which only sits on region seeds) valid. Connectivity is
checked on every flip.

Valid boards exist for n == 1 and n >= 4  (n == 2, 3 are impossible).
"""

import random

_NEI = ((1, 0), (-1, 0), (0, 1), (0, -1))


def _neighbours(r, c, n):
    for dr, dc in _NEI:
        nr, nc = r + dr, c + dc
        if 0 <= nr < n and 0 <= nc < n:
            yield nr, nc


# --------------------------------------------------------------------------- #
# 1. Valid queen placement (the intended solution)
# --------------------------------------------------------------------------- #
def random_solution(n, rng=None):
    rng = rng or random.Random()
    placement = [-1] * n
    used = [False] * n

    def bt(r):
        if r == n:
            return True
        cols = list(range(n))
        rng.shuffle(cols)
        for c in cols:
            if used[c] or (r > 0 and abs(placement[r - 1] - c) < 2):
                continue
            placement[r] = c
            used[c] = True
            if bt(r + 1):
                return True
            placement[r] = -1
            used[c] = False
        return False

    if not bt(0):
        raise ValueError(f"no valid queen placement exists for n={n}")
    return [(r, placement[r]) for r in range(n)]


# --------------------------------------------------------------------------- #
# 2. Initial connected-region partition (one region per queen)
# --------------------------------------------------------------------------- #
def grow_regions(n, queens, rng=None):
    rng = rng or random.Random()
    region_of = [[-1] * n for _ in range(n)]
    frontier = []
    for rid, (r, c) in enumerate(queens):
        region_of[r][c] = rid
        for nr, nc in _neighbours(r, c, n):
            frontier.append(((nr, nc), rid))

    remaining = n * n - len(queens)
    while remaining and frontier:
        (r, c), rid = frontier.pop(rng.randrange(len(frontier)))
        if region_of[r][c] != -1:
            continue
        region_of[r][c] = rid
        remaining -= 1
        for nr, nc in _neighbours(r, c, n):
            if region_of[nr][nc] == -1:
                frontier.append(((nr, nc), rid))
    return region_of


# --------------------------------------------------------------------------- #
# 3. Solver: enumerate up to `limit` solutions  (bitmask row-order DFS)
# --------------------------------------------------------------------------- #
# Columns and used-regions are tracked as integer bitmasks. For each row we
# build `avail` = all columns not used, not diagonally adjacent to the previous
# row's queen, and iterate only the set bits (candidate columns) instead of
# scanning every column. Enumeration order is still low-column-first, identical
# to the plain solver -- so results and witness order are unchanged.
def solutions(n, region_of, limit=2):
    full = (1 << n) - 1
    rbit = [[1 << region_of[r][c] for c in range(n)] for r in range(n)]
    place = [0] * n
    found = []

    def bt(r, cols_used, regs_used, prev_c):
        if len(found) >= limit:
            return
        if r == n:
            found.append(tuple(place))
            return
        adj = 0
        if prev_c >= 0:
            if prev_c > 0:
                adj |= 1 << (prev_c - 1)
            if prev_c < n - 1:
                adj |= 1 << (prev_c + 1)
        avail = full & ~cols_used & ~adj
        row_bits = rbit[r]
        while avail:
            cb = avail & (-avail)          # lowest set bit  = lowest column
            avail ^= cb
            c = cb.bit_length() - 1
            rb = row_bits[c]
            if regs_used & rb:             # region already has a queen
                continue
            place[r] = c
            bt(r + 1, cols_used | cb, regs_used | rb, c)
            if len(found) >= limit:
                return

    bt(0, 0, 0, -1)
    return found


def count_solutions(n, region_of, limit=2):
    return len(solutions(n, region_of, limit))


# --------------------------------------------------------------------------- #
# 4. Refine a layout to a unique solution
# --------------------------------------------------------------------------- #
def _connected_without(region_of, rid, seed, drop, n):
    """Is region `rid` still connected (and non-empty) if `drop` is removed?"""
    cells = {(r, c) for r in range(n) for c in range(n)
             if region_of[r][c] == rid and (r, c) != drop}
    if not cells or seed == drop:
        return False
    seen, stack = {seed}, [seed]
    while stack:
        r, c = stack.pop()
        for nr, nc in _neighbours(r, c, n):
            if (nr, nc) in cells and (nr, nc) not in seen:
                seen.add((nr, nc))
                stack.append((nr, nc))
    return len(seen) == len(cells)


def refine_unique(n, queens, region_of, rng, max_iters):
    seeds = {(r, c): rid for rid, (r, c) in enumerate(queens)}
    intended = tuple(c for (_, c) in sorted(queens))

    for _ in range(max_iters):
        sols = solutions(n, region_of, limit=2)
        if len(sols) == 1:
            return True
        alt = sols[0] if sols[0] != intended else sols[1]

        # cells where the alternate places a queen but the intended does not
        cand = [(r, alt[r]) for r in range(n) if (r, alt[r]) not in seeds]
        rng.shuffle(cand)

        moved = False
        for (r, c) in cand:
            A = region_of[r][c]
            seedA = queens[A]
            adj = list({region_of[nr][nc] for nr, nc in _neighbours(r, c, n)} - {A})
            rng.shuffle(adj)
            for B in adj:
                if _connected_without(region_of, A, seedA, (r, c), n):
                    region_of[r][c] = B      # B stays connected (r,c touches it)
                    moved = True
                    break
            if moved:
                break
        if not moved:
            return False                     # stuck; caller restarts
    return count_solutions(n, region_of, limit=2) == 1


# --------------------------------------------------------------------------- #
# 5. Top-level generator
# --------------------------------------------------------------------------- #
def generate_queendoku(n, rng=None, unique=True, restarts=200, refine_iters=None):
    """Return (queens, region_of, attempts)."""
    rng = rng or random.Random()
    if not unique:
        q = random_solution(n, rng)
        return q, grow_regions(n, q, rng), 1
    if refine_iters is None:
        refine_iters = 40 * n
    for attempt in range(1, restarts + 1):
        queens = random_solution(n, rng)
        region_of = grow_regions(n, queens, rng)
        if refine_unique(n, queens, region_of, rng, refine_iters):
            return queens, region_of, attempt
    raise RuntimeError(f"no unique board after {restarts} restarts")


# --------------------------------------------------------------------------- #
# Display
# --------------------------------------------------------------------------- #
def render(n, region_of, queens=None):
    qset = set(queens) if queens else set()
    cell = lambda r, c: " Q " if (r, c) in qset else " . "
    bar = "+" + "+".join("---" for _ in range(n)) + "+"
    lines = [bar]
    for r in range(n):
        row = "|"
        for c in range(n):
            row += cell(r, c)
            row += "|" if (c == n - 1 or region_of[r][c] != region_of[r][c + 1]) else " "
        lines.append(row)
        if r == n - 1:
            lines.append(bar)
        else:
            sep = "+"
            for c in range(n):
                sep += ("---" if region_of[r][c] != region_of[r + 1][c] else "   ") + "+"
            lines.append(sep)
    return "\n".join(lines)


def region_sizes(region_of):
    counts = {}
    for row in region_of:
        for rid in row:
            counts[rid] = counts.get(rid, 0) + 1
    return sorted(counts.values(), reverse=True)


if __name__ == "__main__":
    import time
    for n in (7, 8, 9, 10, 11, 12):
        t = time.time()
        queens, regions, attempts = generate_queendoku(n, rng=random.Random(n))
        dt = time.time() - t
        assert count_solutions(n, regions, limit=2) == 1
        print(f"n={n}: unique board in {attempts} restart(s), {dt*1000:.0f} ms, "
              f"region sizes {region_sizes(regions)}")
    print()
    q, reg, _ = generate_queendoku(9, rng=random.Random(9))
    print(render(9, reg, q))
