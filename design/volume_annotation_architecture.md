# Green-Field Architecture: Frontend Volume Annotation Editing

Status: draft / discussion doc
Scope: how the **frontend** represents, edits, undoes and saves volume (segmentation) annotation data. Backend implications are called out where the contract necessarily spans both sides, but are not designed in depth here.

This document intentionally does not try to stay close to the current implementation. It proposes a design from first principles, given the constraints below, so that we have a "north star" to compare the existing architecture against. A follow-up doc can define an incremental migration path.

## 1. Givens & Requirements (recap)

**Data model**
- Volume data is chunked into buckets, `32³` voxels each. Each voxel value is a segment ID.
- Coarser levels of detail ("mags") are downsampled versions of mag 1, with independent per-axis factors (e.g. `2-2-1`).
- The frontend never holds the whole dataset in memory; buckets are paged in/out from the backend on demand.

**Requirements**
1. Users can annotate at any mag, with brush, polygon/trace, fill, and interpolation-between-sections tools.
2. An edit made at one mag is automatically reflected at all other mags.
3. Saved changes are diffs against the previous bucket state, not full snapshots — this is a prerequisite for future collaborative (multi-user, concurrent) editing, where diffs from different users need to compose instead of clobbering each other.
4. One user interaction (e.g. one brush stroke) = one transaction = one bundle of per-bucket diffs.
5. Every transaction must be undoable/redoable. Undo must not silently discard a collaborator's edits that happened in between.
6. An "overwrite mode" governs whether painting may overwrite already-labeled voxels or only empty (background) ones.

## 2. Design Principles

- **Geometry first, voxels second.** Tools never write voxels directly. They describe *what the user meant* (a stroke, a polygon, a seed point) in continuous, mag-independent space. A separate stage turns that description into voxel writes. This is what makes "annotate at any mag, propagate to all mags" tractable: we're not reconciling N independently-rasterized voxel grids, we rasterize once and derive the rest.
- **Mag 1 is the source of truth; every other mag is a projection of it.** All edits, regardless of which mag the user was looking at, ultimately resolve into mag-1 voxel writes. Every other mag's bucket content is *derived* (downsampled) from mag 1. This turns "propagate edit to all mags" into a single, uniform algorithm instead of one case per direction.
- **Diffs are the atomic unit of state, not snapshots.** A bucket's authoritative content is defined as "checkpoint + ordered diffs since checkpoint", forever. Snapshots are just a performance/memory optimization (a cached fold of the diff log), never a special case that diffs must be reconciled against.
- **Undo replays forward, it never inverts on top of live state.** Undoing transaction *T* means: recompute the bucket as if *T* had never been in the log, by replaying the surrounding diffs — not by subtracting *T*'s effect from whatever the bucket currently looks like. This is what keeps undo safe once other actors (or your own later actions) may have touched the same voxels.

## 3. Component Overview

```
 Pointer / keyboard input
        │
        ▼
 ┌───────────────┐   continuous, mag-independent   ┌───────────────┐
 │  Tool          │ ───────────────────────────────▶│ Edit Buffer    │
 │ (Brush, Trace,  │        geometry primitive       │ (per-          │
 │  Fill, Interp.) │                                  │ transaction)   │
 └───────────────┘                                  └───────┬───────┘
                                                             │ rasterize @ source mag
                                                             ▼
                                                     ┌───────────────┐
                                                     │  Rasterizer    │
                                                     │ (shape → voxel │
                                                     │  writes, obeys │
                                                     │  overwrite     │
                                                     │  mode)         │
                                                     └───────┬───────┘
                                                             │ voxel writes @ source mag
                                                             ▼
                                                     ┌───────────────┐
                                                     │ Mag           │
                                                     │ Propagation   │◀── reads/writes ──┐
                                                     │ Service       │                    │
                                                     └───────┬───────┘                    │
                                                             │ touched buckets, all mags   │
                                                             ▼                             │
                                                     ┌───────────────┐                    │
                                                     │ Working Data  │────────────────────┘
                                                     │ Cube (Buckets)│  (GPU textures read from here
                                                     └───────┬───────┘   for live rendering)
                                                             │ before/after per bucket
                                                             ▼
                                                     ┌───────────────┐
                                                     │ Diff Engine   │
                                                     └───────┬───────┘
                                                             │ TransactionDiff
                                                             ▼
                                        ┌────────────────────┴────────────────────┐
                                        ▼                                         ▼
                              ┌───────────────────┐                    ┌───────────────────┐
                              │ Undo/Redo Log      │                    │ Save Queue         │
                              │ (per-bucket event   │                    │ (encode + batch,   │
                              │  log + checkpoints) │                    │  send to backend)  │
                              └───────────────────┘                    └───────────────────┘
```

## 4. Components in Detail

### 4.1 Tools

Each tool (Brush, Polygon/Trace, Fill, Interpolate, ...) is only responsible for turning pointer/keyboard input plus current viewer state (active viewport plane, current mag, brush size, active segment ID, overwrite mode) into a **geometry primitive**, expressed in continuous mag-1 voxel coordinates (floats), independent of any particular mag's voxel grid:

- Brush: a sequence of `{center: Vec3f, radiusNm}` samples along the pointer path (a "swept disk/sphere"), tagged with the viewport's normal (2D tools only paint within one slice's plane, extruded by half a voxel in the source mag).
- Polygon/Trace: a closed 2D polygon in-plane, or in "3D trace" the mesh of a closed line drawn while moving along z.
- Fill: a seed point + a source mag at which connectivity is evaluated + optionally a bounding box limiting flood fill.
- Interpolate: two labeled reference sections (already-drawn slices) + the set of intermediate section indices to synthesize.

None of these tools touch `Bucket` objects. This separation is what lets us later add tools (e.g. a "magic wand"/AI-assisted tool) without teaching them anything about bucket/mag bookkeeping — they just need to emit geometry or a target voxel set.

### 4.2 Edit Buffer (transaction scope)

While a transaction is in progress (mouse down → move → up, or a single click for Fill), the tool keeps appending to an **Edit Buffer**: an accumulating, mag-1-space description of the interaction so far. This buffer exists so that:

- The UI can render a live preview (an overlay) without mutating authoritative voxel data yet — this makes "Escape to cancel a stroke" free.
- We have one clear point in time — buffer finalization — at which rasterization happens, rather than rasterizing (and diffing, and propagating) on every single mouse-move event.

In practice, for performance, the buffer *does* rasterize and apply incrementally per mouse-move (so the brush paints live), but conceptually it is still one open transaction until pointer-up; intermediate voxel writes within the same transaction are coalesced (see 4.6) so they produce one diff per bucket, not one per mouse-move sample.

### 4.3 Rasterizer

The Rasterizer is a pure, tool-agnostic function:

```
rasterize(shape: GeometryPrimitive, targetMag: Vector3, activeSegmentId, overwriteMode, cube: WorkingDataCube)
  → VoxelWriteSet   // { bucketAddress → [(voxelIndexInBucket, newValue)] }
```

It is the single place in the whole system that knows how to turn "a sphere of radius r centered at p" or "a polygon" into a concrete set of voxel indices. It:

1. Computes which buckets, at `targetMag`, intersect the shape's bounding box.
2. For each candidate voxel, tests shape containment (distance-to-center for brush, point-in-polygon for trace, connectivity/flood for fill).
3. Applies the **overwrite-mode filter**: reads the voxel's *current* value from the working data cube and only includes the voxel in the output if the mode allows overwriting it (`paint-all` → always; `paint-empty-only` → only if current value is background/`0`).

`targetMag` here is always the mag the user is actually looking at (the "source mag" of the transaction) — this is the only mag the Rasterizer ever runs against. Every other mag's content is produced by the Mag Propagation Service (4.4), never by re-rasterizing the same geometry a second time at a different resolution. This avoids a whole class of bugs where a circle rasterized independently at mag 1 and mag 2 disagree at the boundary — there is exactly one rasterization per transaction, everything else is a deterministic function of it.

### 4.4 Mag Propagation Service

Given a `VoxelWriteSet` at the source mag, this service is responsible for making every other mag consistent, using one uniform algorithm — because mag 1 is defined as the source of truth (Section 2):

**Step A — Drive down to mag 1 (only needed if source mag ≠ mag 1).**
Each written source-mag voxel corresponds to an axis-aligned block of `factor.x × factor.y × factor.z` mag-1 voxels (where `factor` is the source mag's downsampling factor). The service replicates the new value into every voxel of that block. This is lossless information-wise in the sense that it's fully determined by the edit (no data needs to be fetched to do it) — but it does mean that, deliberately, drawing at a coarse mag produces "blocky" mag-1 geometry. That's an accepted, expected tradeoff of annotating at low resolution, not a bug.

**Step B — Propagate up from mag 1 through the rest of the pyramid.**
Now that mag 1 reflects the edit, every coarser mag bucket that overlaps the edited region is recomputed from its mag-1 children using the dataset's normal downsampling rule (e.g. majority vote for segmentations). A mag-`N` bucket's value depends on all of its children down to mag 1 (e.g. a mag-2 bucket depends on 8 mag-1 buckets, given `32³` buckets and a `2-2-1`-per-axis pyramid growing by 2 in each doubling step). If a required child bucket isn't loaded yet, the service fetches it (it's needed for correct rendering at that mag anyway, so this isn't extra cost we wouldn't otherwise pay) before finalizing that coarser bucket's diff. Recomputation is scoped to the (small) set of buckets that overlap the edited region's bounding box — not the whole layer.

Both steps run inside the same transaction. Every bucket touched by either step becomes part of the same `TransactionDiff` (4.6) — satisfying "each interaction results in one transaction containing all diffs of all affected buckets", regardless of which mag the user actually drew in.

If mag 1 doesn't exist for a given layer (some datasets start at a coarser mag), substitute "finest available mag" everywhere above.

### 4.5 Working Data Cube

This is the in-memory, mutable representation used for rendering — one `Bucket` (`32³` typed array of segment IDs) per loaded `(bucketPosition, mag)`, exactly as today. It is populated lazily from the backend and evicted under memory pressure. GPU textures are updated directly from bucket contents for instant visual feedback; no separate "render representation" is needed beyond what already exists.

The only addition needed here for the new editing model: each bucket must support a cheap way to answer "what did voxel *i* look like right before this transaction started" — see 4.6.

### 4.6 Diff Engine

At the start of a transaction, before any voxel is mutated, the Diff Engine lazily snapshots the *pre-transaction* content of any bucket the moment it's first touched (a plain array copy — buckets are at most tens to a few hundred KB, and only a handful of buckets are touched per interaction, so this is cheap; no need for per-voxel copy-on-write bookkeeping).

At transaction end, for every touched bucket, the engine diffs `before` vs. `after` and produces a **BucketDiff**:

```
BucketDiff {
  bucketAddress: (x, y, z, mag)
  changedIndices: number[]     // flat index within the 32³ bucket, ascending
  oldValues: TypedArray        // same length as changedIndices
  newValues: TypedArray
}
```

Both `oldValues` and `newValues` are kept — this costs nothing extra (both are already known) and is exactly what makes forward-only undo/redo possible (4.7) without ever inverting a diff against arbitrary future state.

All `BucketDiff`s produced by the interaction (across every touched mag, from both the direct rasterization and the mag propagation step) are bundled into one:

```
TransactionDiff {
  transactionId
  layerId
  timestamp
  toolName            // for analytics/debugging, not semantically load-bearing
  bucketDiffs: BucketDiff[]
}
```

This is the unit that gets pushed to the Undo/Redo Log and to the Save Queue.

### 4.7 Undo/Redo Log

Requirement recap: undo must work per-transaction, and must not silently discard concurrent (or your own later) edits to the same voxels — ruling out "restore a full snapshot from before the transaction".

**Model: a per-bucket, ordered event log, not a single global stack of inverses.**

- For each bucket, maintain the ordered list of `BucketDiff`s (in transaction order) that have ever touched it, plus an occasional full-content **checkpoint** (see below).
- The *current* content of a bucket is defined as: take the nearest checkpoint at or before the log's head, then apply each subsequent diff's `newValues` at its `changedIndices`, in order. (In practice we don't recompute this on every read — the live `Bucket` array in the Working Data Cube already holds the folded-forward result — but this definition is what undo/redo operates against conceptually.)
- **Undo(T):** mark `T` as "skipped" in the log. Recompute only the buckets `T` touched, by starting at their nearest checkpoint and replaying every non-skipped diff in order up to the current head (which naturally includes any transactions that happened after `T`, whether from this user or, in a future collaborative mode, from someone else). Since diffs record explicit `newValues` (last-write-wins per voxel, ordered by transaction sequence), this replay is fully deterministic regardless of what `T` did — there is no "inverse" being computed or applied, only forward folding with one entry removed. This is the forward-only property the requirement asked for.
- **Redo(T):** unmark `T` as skipped, replay again the same way.
- Because the replay is scoped to exactly the buckets `T` touched (tracked directly on the `TransactionDiff`), cost is proportional to "buckets touched by T" × "diffs since the last checkpoint for those buckets", not to the whole layer's history.
- **Checkpoints** exist purely to bound how far back a replay has to go, and to bound memory (old diffs before a checkpoint that nothing can ever undo past can be discarded). A checkpoint is taken periodically per bucket (e.g. every *k* diffs touching it, or when it's about to be evicted from memory and its full log would otherwise need to be persisted) and is just the bucket's folded content at that point, i.e. a normal full-bucket snapshot. Concretely: undo history has a bounded horizon (e.g. "the last 100 actions", matching typical editor UX), which sets *k*.
- Locally, the undo/redo *stack* the UI exposes (Ctrl+Z / Ctrl+Shift+Z) is just an ordered list of this user's own `TransactionDiff`s; "undo" always targets the most recent non-skipped entry, "redo" the most recently skipped one — that part is unchanged from a conventional editor. What's different is *how* undoing an entry is realized underneath.

This model is deliberately the same shape a future collaborative log would need (a per-key/per-bucket ordered log of writes with last-write-wins folding), so adopting it now avoids a rewrite later — see Section 6.

### 4.8 Save Queue / Backend Sync

`TransactionDiff`s are queued and flushed to the backend periodically (as today), but the wire payload changes from "full bucket snapshot" to "bucket diff":

```
updateBucketDiff (new update-action kind) {
  actionTracingId
  bucketAddress: (x, y, z, mag)
  changedVoxels: [{ startIndex, values: [...] }, ...]   // run-length grouped, see below
}
```

Encoding notes:
- `changedIndices` are grouped into runs (`startIndex, length`) before serialization — brush and trace edits produce spatially clustered, often-contiguous changes in flat bucket order, so this is typically a large size reduction over a flat index list, on top of whichever general-purpose compression (e.g. gzip) the transport already applies.
- One `updateBucketDiff` action per touched bucket; all actions from one `TransactionDiff` are submitted together as one versioned update group — this is what gives the backend (and, later, other clients) "one transaction = one atomic bundle of diffs" rather than having to infer grouping after the fact.
- `oldValues` are **not** sent to the backend — the backend's own version history already lets it reconstruct "before" for its own audit/versioning needs; sending it would be redundant. `oldValues` only need to exist client-side, for local undo.
- This does require a backend-side change (accepting/storing per-bucket diffs and folding them into the bucket's authoritative content, instead of overwriting wholesale) — out of scope for this doc, but it's the necessary counterpart, and is what unlocks future multi-user diff composition instead of last-writer-wins-on-the-whole-bucket.

## 5. Walkthrough: brush stroke, drawn at mag 1

1. Pointer-down on the brush tool. A new transaction opens; an empty Edit Buffer is created for it.
2. On each pointer-move, the tool appends a `{center, radius}` sample (in mag-1 nm coordinates) to the buffer and immediately asks the **Rasterizer** to rasterize just the incremental swept region (previous center → new center) at the current mag (mag 1 here). The Rasterizer walks candidate voxels, checks sphere/disk containment, checks the overwrite-mode filter against the Working Data Cube's current values, and returns a `VoxelWriteSet`.
3. The **Mag Propagation Service** takes that `VoxelWriteSet`. Since the source mag is mag 1, Step A (drive down to mag 1) is a no-op. Step B recomputes every coarser-mag bucket overlapping the edited region from its mag-1 children (fetching any not-yet-loaded sibling children as needed) and writes the result into those buckets in the Working Data Cube too.
4. The Working Data Cube's buckets (mag 1 and all coarser mags touched) are updated in place; the GPU textures for currently-visible buckets are refreshed, so the user sees the stroke and its effect on other zoomed-out views immediately.
5. This repeats on every pointer-move; the Diff Engine's pre-transaction snapshots (taken lazily on first touch per bucket, once for the whole transaction) are untouched by the repetition — only the "after" state keeps changing.
6. Pointer-up ends the transaction. The Diff Engine diffs every touched bucket's snapshot against its now-final content, producing one `BucketDiff` each, bundled into a `TransactionDiff`.
7. The `TransactionDiff` is pushed onto the local undo stack, and enqueued in the Save Queue, which encodes each `BucketDiff` (run-length grouped) and flushes it (batched with other pending transactions, as today) as one versioned group of `updateBucketDiff` actions.

Drawing at mag 4 instead only changes step 3: Step A now does real work (replicating each written mag-4 voxel into its `4×4×4`, or whatever the mag's factor is, block of mag-1 voxels) before Step B runs unchanged.

## 6. Relationship to Future Collaborative Editing

This design doesn't implement multi-user concurrent editing, but is shaped so that adding it later doesn't require re-architecting:

- Diffs are already the unit of truth, not snapshots (Section 2), so a remote peer's diff and a local diff are the same kind of object.
- The per-bucket event log (4.7) with last-write-wins-by-sequence folding is already the right data structure for merging local and remote diffs — a remote `TransactionDiff` arriving is handled exactly like replaying a diff during undo/redo: insert it into the affected buckets' logs at the correct sequence position and re-fold.
- The one open problem this doc deliberately leaves for later is establishing a total order across *different users'* transactions (today, "transaction sequence" is trivially just local chronological order for a single user). That needs either a server-assigned sequence number per bucket (simple, requires a round-trip) or a CRDT-style logical clock (no round-trip, more complexity). The `BucketDiff` format above already has room for a `baseVersion`/logical-clock field to be added without breaking the model.

## 7. Open Questions / Tradeoffs

- **Fill tool and unloaded data.** Flood fill needs the whole connected region loaded to produce a correct result; drawing at a mag where the relevant neighborhood spans many not-yet-loaded buckets means either blocking on fetches or accepting a partial fill. Needs a UX decision (spinner + progressive fill vs. hard requirement to pre-load).
- **Mag propagation cost for very large strokes.** Step B's bucket recomputation is bounded by the edited bounding box, but a big brush at mag 1 with many coarser mags can still touch a lot of buckets. Likely fine in practice (same order of magnitude as today's "affected bucket" set), but worth profiling.
- **Checkpoint interval tuning.** Too frequent → memory/storage overhead; too infrequent → expensive undo replay and slow eviction. Needs empirical tuning once implemented; can start conservative (e.g. checkpoint every 50 diffs per bucket) and adjust.
- **Where does the Rasterizer run?** It's a pure function of (shape, mag, working cube slice), which makes it a reasonable candidate for a Web Worker to keep the main thread free during large strokes. Not required for correctness, called out as a later perf option.
