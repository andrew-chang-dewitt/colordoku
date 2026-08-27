# CRDT Research Notes + Study Plan (Leaderboard & Shared State)

## Why this note exists

This is prep for the README TODO around an opt-in, eventually consistent global leaderboard shared across users.

## Research summary

### cr-sqlite (primary reference)

- `cr-sqlite` is a loadable SQLite/libSQL extension for convergent replicated relations (CRRs), with multi-master/offline-friendly merging.  
  Source: https://raw.githubusercontent.com/vlcn-io/cr-sqlite/main/README.md
- Main APIs:
  - `crsql_as_crr('table')` to convert tables to CRRs
  - `crsql_changes` virtual table for extracting/applying changesets
  - `crsql_begin_alter` / `crsql_commit_alter` for schema changes on CRRs  
  Source: https://raw.githubusercontent.com/vlcn-io/cr-sqlite/main/README.md
- v1 model emphasizes history-free CRDT composition (row/column conflict handling); v2 direction adds causal event-log support with different storage and conflict tradeoffs.  
  Source: https://raw.githubusercontent.com/vlcn-io/cr-sqlite/main/README.md
- README perf note: CRR inserts are slower than plain SQLite inserts, while reads are similar speed.  
  Source: https://raw.githubusercontent.com/vlcn-io/cr-sqlite/main/README.md
- Rust core migration is active; relevant internals include CRR creation/bootstrap, vtable read/write paths, and merge logic:  
  - https://raw.githubusercontent.com/vlcn-io/cr-sqlite/main/core/rs/core/src/lib.rs  
  - https://raw.githubusercontent.com/vlcn-io/cr-sqlite/main/core/rs/core/src/create_crr.rs  
  - https://raw.githubusercontent.com/vlcn-io/cr-sqlite/main/core/rs/core/src/changes_vtab.rs  
  - https://raw.githubusercontent.com/vlcn-io/cr-sqlite/main/core/rs/core/src/changes_vtab_write.rs

### Other Rust CRDT implementations to learn from

- **Automerge**: local-first document CRDT with compact binary format and explicit sync protocol (`sync::State`, in-flight handling, reset behavior).  
  Sources:  
  - https://raw.githubusercontent.com/automerge/automerge/main/README.md  
  - https://raw.githubusercontent.com/automerge/automerge/main/rust/automerge/src/lib.rs  
  - https://raw.githubusercontent.com/automerge/automerge/main/rust/automerge/src/sync.rs
- **Yrs (Yjs in Rust)**: state vectors, diff updates, transactions, and update encoding for collaborative editing.  
  Source: https://raw.githubusercontent.com/y-crdt/y-crdt/main/yrs/README.md
- **Loro**: practical CRDT API with import/export updates, version vectors/frontiers, checkout/revert/fork workflows.  
  Source: https://raw.githubusercontent.com/loro-dev/loro/main/crates/loro/README.md
- **diamond-types**: high-performance text CRDT; useful for compact causal graph and merge/index design ideas.  
  Source: https://raw.githubusercontent.com/josephg/diamond-types/master/INTERNALS.md
- **rust-crdt (`crdts`)**: clear educational framing for semilattice/merge laws and causal context APIs.  
  Source: https://raw.githubusercontent.com/rust-crdt/rust-crdt/master/README.md

## Analysis for Colordoku leaderboard

Your target shared state (weekly score, username, location, games played) is structured and map/counter-like, so this is a stronger fit for CRDT map/register/counter patterns than text-focused CRDT internals.

Key design concerns to settle before implementation:

1. Replica identity and causality tracking (site/actor IDs + monotonic versioning)
2. Per-field merge semantics (e.g., counters vs LWW registers)
3. Delete/opt-out/tombstone handling
4. Metadata growth controls (compaction/GC)
5. Deterministic ranking/tie-break projection from converged state

A good architecture split (language-agnostic first, Rust later if desired):

- CRDT state + merge core
- wire format + versioning
- sync/anti-entropy protocol
- storage adapter (local storage/db)

## Study plan

### Phase 0 — Invariants refresher

1. Read merge-law and causal-context sections in rust-crdt README.  
   Source: https://raw.githubusercontent.com/rust-crdt/rust-crdt/master/README.md
2. Write a local checklist of your desired semilattice properties for leaderboard fields.

Output: concise invariants checklist (idempotent, commutative, associative, monotonic).

### Phase 1 — cr-sqlite deep dive

1. Read `cr-sqlite` README end-to-end (v1/v2 model + APIs).  
   Source: https://raw.githubusercontent.com/vlcn-io/cr-sqlite/main/README.md
2. Trace extension wiring and registration flow in `core/rs/core/src/lib.rs`.  
   Source: https://raw.githubusercontent.com/vlcn-io/cr-sqlite/main/core/rs/core/src/lib.rs
3. Read CRR conversion path in `create_crr.rs`.  
   Source: https://raw.githubusercontent.com/vlcn-io/cr-sqlite/main/core/rs/core/src/create_crr.rs
4. Read read/write merge paths in `changes_vtab.rs` and `changes_vtab_write.rs`.  
   Sources:  
   - https://raw.githubusercontent.com/vlcn-io/cr-sqlite/main/core/rs/core/src/changes_vtab.rs  
   - https://raw.githubusercontent.com/vlcn-io/cr-sqlite/main/core/rs/core/src/changes_vtab_write.rs

Output: architecture diagram/notes for “data tables + metadata + changes feed + merge engine”.

### Phase 2 — Sync protocol patterns (Automerge)

1. Read sync handshake loop and per-peer state handling in `sync.rs`.  
   Source: https://raw.githubusercontent.com/automerge/automerge/main/rust/automerge/src/sync.rs
2. Read conflict and actor-ID semantics in crate docs (`lib.rs`).  
   Source: https://raw.githubusercontent.com/automerge/automerge/main/rust/automerge/src/lib.rs

Output: proposed leaderboard sync flow (`summary -> request -> delta -> ack/reset`).

### Phase 3 — API/data-structure comparison (Yrs/Loro/diamond-types)

1. Yrs: transaction and state-vector/update mechanics.  
   Source: https://raw.githubusercontent.com/y-crdt/y-crdt/main/yrs/README.md
2. Loro: versioning/frontiers/export modes and app-facing ergonomics.  
   Source: https://raw.githubusercontent.com/loro-dev/loro/main/crates/loro/README.md
3. diamond-types: internal causal graph and transform model for performance intuition.  
   Source: https://raw.githubusercontent.com/josephg/diamond-types/master/INTERNALS.md

Output: comparison matrix of patterns to borrow vs avoid.

### Phase 4 — Write your own leaderboard CRDT spec

1. State schema and field-level CRDT definitions
2. Merge rules and tie-break precedence
3. Sync message format and replay/duplication behavior
4. Compaction/GC boundaries
5. Deterministic ranking projection contract

Output: implementation-ready spec document.

### Phase 5 — Learning prototype

1. Build a 2+ peer simulator with randomized operation interleavings
2. Verify convergence and replay/reorder safety
3. Test partitions, late joiners, and duplicate deliveries

Output: property-style test evidence that your spec converges.

## Fast reading order

1. rust-crdt README — https://raw.githubusercontent.com/rust-crdt/rust-crdt/master/README.md
2. cr-sqlite README — https://raw.githubusercontent.com/vlcn-io/cr-sqlite/main/README.md
3. cr-sqlite `lib.rs` — https://raw.githubusercontent.com/vlcn-io/cr-sqlite/main/core/rs/core/src/lib.rs
4. cr-sqlite `changes_vtab_write.rs` — https://raw.githubusercontent.com/vlcn-io/cr-sqlite/main/core/rs/core/src/changes_vtab_write.rs
5. Automerge `sync.rs` — https://raw.githubusercontent.com/automerge/automerge/main/rust/automerge/src/sync.rs
6. Yrs README — https://raw.githubusercontent.com/y-crdt/y-crdt/main/yrs/README.md
7. Loro README — https://raw.githubusercontent.com/loro-dev/loro/main/crates/loro/README.md
8. diamond-types internals — https://raw.githubusercontent.com/josephg/diamond-types/master/INTERNALS.md

## Practical guidance for next step

- Start with simple CRDT field types (counters + LWW registers)
- Make ranking a deterministic derived view from converged base state
- Keep merge logic isolated from transport/storage so Rust migration is straightforward later
- Add a simulator early to validate invariants before UI/network integration


# more design notes

It’s feasible, but only if you’re very clear about what kind of leaderboard semantics you’re willing to accept. A CRDT‑based, serverless leaderboard can work beautifully for some game designs — and fall apart for others. The trick is understanding exactly where CRDTs shine and where they fight you.

---

Core takeaway

You can maintain a distributed leaderboard with CRDTs if you accept eventual consistency, tolerate temporary rank disagreements, and design your scoring model so that merges are unambiguous. The moment you need strict ordering guarantees or authoritative anti‑cheat enforcement, CRDTs alone stop being enough.

---

🌐 What is feasible with CRDTs in your game

1. Cumulative scores are easy

A player’s cumulative score is a classic G‑Counter or PN‑Counter CRDT.

• Each device increments its own score.
• Merging is trivial: take the max per replica and sum.
• No conflicts, no coordination.


This part is perfect for CRDTs.

2. Local slices of the leaderboard

You can maintain:

• The top N players globally
• A window around the local player (e.g., ±10 ranks)


Using a Top‑K CRDT or a custom CRDT that stores:

• (player_id, score, last_update_timestamp)
• Merges by taking the highest scores and most recent updates


This is also feasible.

3. Eventual consistency is acceptable

If players see slightly different rankings for a few seconds or minutes, that’s fine in many casual puzzle games.

---

🚧 Where things get tricky

1. Leaderboards require ordering, and ordering is not a CRDT primitive

CRDTs handle merging well, but not global ordering.
If two players update scores concurrently:

• Device A might think Player X is #3
• Device B might think Player X is #4
• They converge eventually, but not instantly


If your game requires strict ordering at all times, CRDTs alone won’t cut it.

2. Cheating becomes much easier

With no authoritative server:

• A malicious client can report arbitrary scores
• CRDTs will happily merge them
• You cannot “subtract” or “invalidate” a bad score without special CRDT design


If cheating matters, you need:

• A trust model
• Signed updates
• Or a lightweight verification authority


3. Device churn and offline play complicate things

Players may:

• Go offline for hours
• Rejoin with stale state
• Merge large amounts of history


You must ensure:

• Efficient gossip
• Bounded memory
• Pruning of old replicas


4. Top‑K CRDTs can grow large

If you track all players, the CRDT becomes huge.
You need:

• A bounded CRDT
• Or a sharded approach
• Or a “local neighborhood + global top‑N” design


---

🧠 Key questions you should answer before committing

Each of these is a decision point for your architecture.

1. How important is strict ranking correctness at every moment?

If “eventual correctness” is fine → CRDTs work.
If “always correct” is required → you need a server.

2. How important is cheat resistance?

If cheating must be prevented → CRDTs alone are insufficient.
If cheating is low‑impact → CRDTs are fine.

3. How many players do you expect?

CRDT size grows with:

• Number of players
• Number of replicas
• Frequency of updates


Small communities → easy
Large communities → you need careful design

4. Do players need to see the entire leaderboard?

If yes → CRDT becomes large
If no → store only:

• Top N
• Local neighborhood
• Self score


5. How often do players go offline?

High offline play → CRDTs shine
Always‑online → a server might be simpler

---

🧩 Practical design pattern that often works well

A common architecture for serverless leaderboards:

CRDTs store:

• Player cumulative scores (G‑Counter)
• Top‑K leaderboard slice
• Local neighborhood slice


Each device gossips:

• Its own score
• Any leaderboard slice it knows
• Only bounded subsets (not full history)


Conflict resolution:

• Highest score wins
• If scores equal, tie‑break by player ID
• If updates conflict, use timestamp or vector clock


Optional anti‑cheat:

• Signed score updates
• Score increments only (no arbitrary set)
• Maximum score per puzzle enforced locally


This keeps the system lightweight and robust.

---

## explore next steps

dig deeper into:

• CRDT leaderboard design
• Top-K CRDT structures
• Anti_cheat_strategies
• Gossip_protocol_design