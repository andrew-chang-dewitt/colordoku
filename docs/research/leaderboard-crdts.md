# Learning CRDTs for #leaderboard

This is a study guide, not an implementation plan: it exists to get you from
"knows nothing about CRDTs" to "can start prototyping the specific ones this
leaderboard needs." Nothing here is code — see README's `#leaderboard` TODO
for the feature itself, and open a `docs/plans/` doc when you're ready to plan
the actual implementation.

## 1. What the leaderboard actually needs

Restating the TODO's shape so the rest of this doc has a concrete target
instead of teaching CRDTs in the abstract:

- **Opt-in only.** A user who hasn't opted in stores nothing leaderboard-related
  in localState and shares nothing. This matters for design, not just privacy:
  it means the "replica set" is exactly the opted-in population, nothing more.
- **Per-participant data**: a weekly (and "today") cumulative score, a
  self-chosen username, a coarse location (country, from user-agent), and a
  count of games played.
- **No central server.** Peers sync directly with each other when online;
  eventual consistency, not real-time consistency.
- **Your added constraint**: no peer holds the whole leaderboard. Each replica
  holds only (a) the top `M` scores — identical across every peer — and (b) the
  `N` scores nearest that peer's own rank — different, mostly-non-overlapping
  windows per peer. This is **partial replication**, and it's the part with no
  textbook answer (section 6).

## 2. CRDT fundamentals, briefly

A CRDT (Conflict-free Replicated Data Type) is a data structure that can be
updated independently on multiple replicas, with no coordination, and is
*guaranteed* to converge to the same value everywhere once all updates have
propagated. The guarantee comes from math, not from a clever merge function:

- **State-based (CvRDT)**: replicas exchange their full state; a `merge`
  function combines two states into one. `merge` must be commutative,
  associative, and idempotent — which is exactly the definition of a
  **join-semilattice**: state only ever moves "up" toward a shared least upper
  bound, so it doesn't matter what order merges happen in, or whether the same
  state gets merged twice by accident.
- **Operation-based (CmRDT)**: replicas exchange individual *operations*
  (e.g. "increment by 1") instead of whole state. This needs a reliable
  causal-delivery channel (every op delivered exactly once, in an order
  consistent with causality) but is far cheaper on the wire — you're not
  reshipping the whole object every time.

Either way, "no central server" falls directly out of this: any two replicas
that have seen the same set of updates (in any order, any number of times)
converge to the same value. That's the whole trick.

**Read**: Shapiro, Preguiça, Baquero, Zawirski, ["A comprehensive study of
Convergent and Commutative Replicated Data
Types"](https://inria.hal.science/inria-00555588/document) (INRIA RR-7506,
2011). This is the paper the terms CvRDT/CmRDT and every standard CRDT
definition trace back to — dense, but it's the primary source, not a summary
of one.

**Then watch**: Martin Kleppmann's ["CRDTs: The Hard
Parts"](https://www.youtube.com/watch?v=x7drE24geUw) (Hydra 2020;
[slides](https://speakerdeck.com/ept/crdts-the-hard-parts),
[writeup](https://martin.kleppmann.com/2020/07/06/crdt-hard-parts-hydra.html)).
This is the practical-gotchas talk, and it covers — directly relevant to the
score-reset problem in section 3 below — why CRDTs are bad at "delete" and
"reset" in general (removed elements have to be remembered as tombstones or
they can resurrect after a merge with a stale replica; there's no way to just
"unsee" state in a monotone lattice).

## 3. The building blocks, mapped to this leaderboard's fields

| Field | CRDT | Why |
|---|---|---|
| games played | `G-Counter` (or `PN-Counter` if you ever need decrements) | Pure accumulation, never decreases. A `G-Counter` is just one integer counter *per replica*; the merged value is the sum of each replica's own counter, so two replicas can each increment concurrently without stepping on each other. |
| weekly / today's score | **not** a running `PN-Counter` you mutate — see below | Scores need to *reset* on a week boundary, and CRDTs don't reset. |
| username, location | `LWW-Register` (Last-Write-Wins), or a multi-value register if you want to keep conflicts visible | These are overwrite fields, not accumulate fields — the whole point is "the current value," not "all values ever set." |
| the leaderboard itself | logically, an `OR-Map` (or delta-CRDT map) from participant-id → that participant's bundle above | This is the *logical* shape — what the data would look like if one replica held everything. Section 6 explains why no real replica does. |

**The reset problem, concretely**: a `PN-Counter` only ever grows (or the
increments and decrements each only ever grow); there's no CRDT-native way to
zero it out at a week boundary without breaking convergence (a peer that
hasn't seen the "reset" yet would just un-reset it back to the old value on
next merge — exactly the delete/tombstone problem Kleppmann's talk covers).
The fix used in practice: don't reset a counter, **key a fresh counter by
week-id**. `scores["2026-W35"]` is a separate `G-Counter` from
`scores["2026-W36"]`; "this week's score" is just "look up this week's key."
Old week-keys can be garband-collected once you're confident every peer has
seen them (itself a small distributed-systems problem, but a much easier one
than trying to reset a live CRDT).

**`LWW-Register`'s hazard**: it silently drops the loser of a concurrent
write — if two replicas rename their username "at the same time" (no shared
clock, so "same time" really means "concurrently, causally unordered"), one
value just vanishes with no signal that a conflict happened. For a username
that's probably fine (rare, low-stakes, and the user who "lost" can just look
at their own device and see their name is what they set it to, then re-set it
if it's wrong). If you want the conflict to be *visible* instead of silently
resolved, a **multi-value register** — keep all causally-concurrent values, let
the application (or the user) pick — is the alternative; `rust-crdt`'s
`MVReg` is a working example of that trade-off.

**The sync layer** — how do two peers exchange updates at all — is a
next-layer-up concern from the CRDTs themselves. `merge` tells you *how* to
combine two states; it doesn't tell you *who to ask* or *how to know what
you're missing*. Two ideas worth knowing the names of, picked back up in
section 6: **gossip protocols** (periodically exchange state/deltas with a
random or structured subset of peers) and **Merkle-CRDTs** (pair a CRDT with
a Merkle-DAG of its history so two replicas can diff "what have I not seen
yet" in log(n) round trips instead of resending everything).

## 4. Learning resources

**Foundational reading** (in the order you'll actually need them):

1. [Shapiro/Preguiça/Baquero/Zawirski's CRDT survey](https://inria.hal.science/inria-00555588/document) — the reference definitions.
2. [Kleppmann's "CRDTs: The Hard Parts"](https://www.youtube.com/watch?v=x7drE24geUw) — the practical gotchas.
3. Almeida, Shoker, Baquero, ["Delta State Replicated Data Types"](https://arxiv.org/pdf/1603.01529) — why naive state-based CRDTs (shipping the *whole* state on every sync) don't scale, and how delta-CRDTs ship only what changed. Matters directly for a browser-localState-based sync model, where bandwidth and battery both cost real money on someone's phone.

**Implementations worth reading as code**, roughly in order of how directly useful they are here:

4. [`rust-crdt`](https://github.com/rust-crdt/rust-crdt) ([docs.rs](https://docs.rs/crdts)) — small, readable Rust implementations of exactly the building blocks above: `GCounter`, `PNCounter`, `LWWReg`, `MVReg`, `Orswot` (OR-Set), and a composable `Map`. This is the one to actually read start-to-finish before writing anything of your own.
5. [`yrs`](https://github.com/y-crdt/y-crdt) (Y-CRDT, the Rust port of Yjs; [docs.rs](https://docs.rs/yrs)) — read for *architecture*, not as a starting point: it's a full production sync engine (used for real-time collaborative editing), much heavier than anything this leaderboard needs, but a good look at what a mature CRDT system's plumbing (encoding, transactions, awareness/presence) looks like once you're past single-type building blocks.
6. Automerge's Rust core, now at [automerge/automerge](https://github.com/automerge/automerge) — same "architecture reference, not starting point" caveat as `yrs`. Note the repo moved; forks still named `automerge-rs` floating around under other accounts are stale.

**Resource indexes**: [crdt.tech](https://crdt.tech) is live and maintained (papers, implementations, glossary) and a good place to browse further; [awesome-crdt](https://github.com/alangibson/awesome-crdt) is a solid secondary list.

## 5. Suggested first CRDT to actually build

Build the **per-user bundle** first, fully replicated, before touching
partitioning at all: one `GCounter` (games played) + one week-keyed map of
`GCounter`s (score-by-week) + one `LWWReg` each for username and location,
composed by hand (a small struct with a `merge` method that merges each
field) rather than reaching for a generic map-CRDT abstraction. This gets you
a working, correctly-converging *single participant's* state — the thing
every later piece (the leaderboard-wide map, the partial-replication scheme)
is built out of — with a small enough surface area to actually reason about
and property-test (e.g. "merge is commutative" is a cheap, valuable
`proptest`).

## 6. Partial replication: top-`M` + `N`-nearest, not the whole leaderboard

This is the part with no textbook answer, and the reason this document
doesn't stop at section 5. Standard CRDT theory assumes every replica
*eventually* converges to holding the *same, whole* object. Your constraint —
every peer holds only the top `M` (identical everywhere) plus the `N` scores
nearest their own rank (different per peer, mostly non-overlapping) — breaks
that assumption on purpose. That's not a bug in the plan; it's a genuinely
different, less-settled area.

### The best find: this is (almost) a solved problem

Cabrita & Preguiça, ["Non-Uniform
Replication"](https://arxiv.org/pdf/1711.07733) (OPODIS 2017), is about
exactly this: "each replica stores only part of the information, but all
replicas store enough information to answer every query [within some
guarantee]." It formalizes **partial replication of CRDTs** and gives
worked-out designs for a **Top-K CRDT** (and Top-Sum, and Histogram) — a
top-K CRDT *is* a leaderboard's top-`M` half. Read this first, before the
more general/background papers below — it's the closest thing to prior art
this problem has, and it should anchor whatever design you land on for the
top-`M` slice.

It does not, as far as this research turned up, solve the second half of your
constraint — an **`N`-nearest-rank sliding window**, different per peer and
requiring peers to know who's "near" them in rank to sync with. That half
stays genuinely open; the resources below are background for reasoning about
it yourself, not a solution to adopt wholesale.

### Why pruning is safe for top-`M`, and where it isn't

The intuition Non-Uniform Replication formalizes: if you keep a CRDT
(conceptually a full, ordered set of all scores) but only *materialize* the
top `M` locally, discarding the rest after each merge, that's safe **as long
as an entry you discard can never re-enter the top `M` later without you
seeing an update that would put it there** — i.e., scores only grow (see
section 3's `G-Counter`-per-week design — this lines up nicely, since scores
are monotonically increasing within a week), so once something's definitely
below the `M`-th place with enough of a margin, it can't sneak back in. Where
naive pruning breaks: if you prune based on a partial/stale view (you haven't
yet merged in an update that would've kept something in the top `M`), you can
end up with a replica whose top-`M` doesn't match another replica's — this is
exactly the "not all replicas agree" gap Non-Uniform Replication's guarantees
are designed to bound.

### The `N`-nearest-rank half: closer to gossip/distributed-top-k than to a textbook CRDT

Keeping an accurate window of "who's near my rank" isn't really a
merge-function problem — it's a "who do I even talk to" problem: a peer only
needs to gossip with its *rank neighbors* (the peers whose scores are close
to its own), not the whole population, to keep that window fresh. That's
squarely in **gossip/epidemic protocol** territory:

- Jelasity, Montresor, Babaoglu, ["Gossip-based Aggregation in Large Dynamic
  Networks"](https://www.cs.unibo.it/babaoglu/courses/cas04-05/papers/tocs376.pdf)
  (ACM TOCS 2005) — the canonical reference for epidemic aggregation
  protocols; a good grounding in how peers converge on an aggregate (here,
  "where do I rank") without anyone having global knowledge.
- Meiklejohn et al., ["PARTISAN: Scaling the Distributed Actor
  Runtime"](https://www.usenix.org/system/files/conference/protected-files/atc19_lt_meiklejohn.pdf)
  (USENIX ATC 2019) — a runtime built specifically around *partial network
  views* with configurable overlay topology (peers only know a subset of
  other peers), which is the shape of problem "who do I gossip with to
  maintain my `N`-nearest window" actually is. (Note: an earlier, different
  Meiklejohn paper on CRDT composition — Lasp, PPDP 2015 — is more about
  composing CRDTs under partial *participation*, not partial *replication*;
  worth skimming but PARTISAN is the more directly relevant one.)
- AntidoteDB (background, not a direct answer): CRDT-based and
  geo-replicated, but replicates the *whole* dataset per datacenter — see its
  [GitHub repo](https://github.com/AntidoteDB/antidote) and the "Cure: Strong
  Semantics Meets High Availability and Low Latency" paper (ICDCS 2016) for
  causal-consistency background if you want it, but it doesn't solve
  *partial-per-peer* replication the way this leaderboard needs.

### Where to start

Don't start with section 6 — start with section 5's per-user bundle, get
correct convergence working unpartitioned (e.g. two in-memory replicas
merging directly, no network), and only then layer on: first, pruning to
top-`M` using Non-Uniform Replication's design as a template; then,
neighbor-gossip for `N`-nearest, treating it as its own small research
project (this is genuinely the least-settled part of the whole feature, and
worth budgeting real thinking time for rather than expecting a drop-in
answer).
