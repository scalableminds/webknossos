# Green-Field Architecture: Frontend Volume Annotation Editing

Status: draft / discussion doc
Scope: how the **frontend** represents, edits, undoes and saves volume (segmentation) annotation data. Backend implications are called out where the contract necessarily spans both sides, but are not designed in depth here.

This document intentionally does not try to stay close to the current implementation. It proposes a design from first principles, given the constraints below, so that we have a "north star" to compare the existing architecture against. A follow-up doc can define an incremental migration path.

Code in this document is illustrative TypeScript — signatures and sketches meant to pin down responsibilities and data flow, not copy-pasteable implementations.

---

## 1. Givens & Requirements

**Data model**
- Volume data is chunked into buckets of `32³` voxels. Each voxel value is a segment ID (`uint64`, i.e. `bigint` in JS; `0` = background).
- Coarser levels of detail ("mags") are downsampled versions of the finest mag, with independent per-axis factors (e.g. `2-2-1`).
- The frontend never holds the whole layer in memory; buckets are paged in/out from the backend on demand.

**Requirements**
1. Users can annotate at any mag, with brush, polygon/trace, fill, and interpolation-between-sections tools.
2. An edit made at one mag is reflected at all other mags.
3. Saved changes are diffs against the previous bucket state, not full bucket snapshots — a prerequisite for future collaborative editing, where diffs from different users must compose rather than clobber each other.
4. One user interaction (e.g. one brush stroke) = one transaction = one bundle of per-bucket diffs.
5. Every transaction is undoable/redoable, and undo must not silently discard edits (own or others') that happened after it.
6. An "overwrite mode" governs whether painting may overwrite already-labeled voxels or only empty (background) ones.

---

## 2. Answers in Brief

The four questions this doc was written to answer:

**What happens when a user draws?** A tool converts pointer input into a declarative *edit intent* (a brush stroke, a polygon, a flood-fill spec). A single `VolumeTransaction` is opened on pointer-down and stays open until pointer-up. On each pointer-move the intent grows, the incremental part is rasterized at the mag the user is looking at, and the resulting voxel writes are recorded into the transaction (and applied to resident buckets so the user sees them immediately). On pointer-up the transaction commits: mag propagation runs, the accumulated write map becomes a set of per-bucket diffs, and those go to the undo log and the save queue.

**Who draws the circular brush into the data?** A single `Rasterizer` — the one component that knows how to turn geometry into voxel indices. Tools never touch buckets; buckets never know about brushes. The Rasterizer also owns the overwrite-mode filter, because that filter is a per-voxel decision made against current data, which is exactly its job.

**What is the intermediary representation?** A per-transaction **write map**: `bucketAddress → (voxelIndex → newSegmentId)`, last-write-wins. This is the pivot point of the whole design. It coalesces repeated writes within a stroke for free, it can hold writes for buckets that are *not* in memory, and it is trivially convertible to both "apply to a live bucket" and "encode as a diff".

**Who downsamples, and how is the diff encoded?** The `MagPropagationService` runs at commit time. It maps the write map from the source mag down to the finest mag (block replication) and then projects it up into each coarser mag (written-value-wins, with background treated as an ordinary value). It propagates the *write set*, never whole buckets — recomputing a coarse bucket from its finest-mag children is infeasible (a mag-16 bucket has 4096 mag-1 children) — and it reads no voxel data at all. The diff is encoded as run-length-grouped voxel runs over the bucket's flat index space, one `updateBucketDiff` update-action per touched bucket, for every mag; all actions of a transaction are submitted as one versioned group, and the backend applies them verbatim without resampling.

---

## 3. Design Principles

1. **Geometry first, voxels second.** Tools describe *what the user meant*; a separate stage turns that into voxel writes. This is what makes "annotate at any mag" tractable — we rasterize once and derive everything else, rather than reconciling N independently-rasterized grids.

2. **The finest mag is the source of truth; coarser mags are a derived view.** Every edit, whatever mag it was authored at, resolves into finest-mag writes, and only finest-mag diffs are authoritative for undo. Coarser mags are derived *at edit time* by projecting the same writes — cheaply and locally, without reading data.

   The projection is deliberately not a faithful downsample, and because it depends on write order it cannot be reconstructed after the fact. Coarse mags will therefore drift from what a fresh downsampling of the finest mag would produce. **This is an accepted trade-off, for now.** It buys a propagation step that needs no data access and no bucket loads, which is what makes editing at coarse mags viable at all (§5.4). Coarse mags are a display approximation; the finest mag is what the annotation *means*. If exactness at coarse mags ever becomes a requirement, the fix is a background re-derivation pass, not a change to the editing path.

3. **Diffs are the unit of truth; buckets are a materialized cache.** A bucket's content is *defined* as "checkpoint + ordered diffs". The `32³` typed array in memory is a fold of that definition, kept around because the GPU needs it.

4. **A diff may exist for a bucket that is not in memory.** This falls out of (3) and is what makes coarse-mag editing scale: drawing at mag 16 implies writes to hundreds of finest-mag buckets, and we must be able to record them without materializing 64 MB of typed arrays. Recording a write must never force a bucket load.

5. **Undo replays forward; it never inverts against live state.** Undoing transaction *T* recomputes affected buckets as if *T* had never been in the log — not by subtracting *T*'s effect from whatever the bucket looks like now. This is what keeps undo correct once other actors, or your own later actions, have touched the same voxels.

6. **Keep diffs in the most compact faithful representation.** A coarse-mag stroke is a small amount of *information* even when it implies millions of finest-mag voxels. Materialize into voxel arrays only for buckets that are actually resident.

---

## 4. Core Types

```ts
// ── Coordinates & identifiers ───────────────────────────────────────────────

type Vector3 = [number, number, number];
type AdditionalCoordinate = { name: string; value: number };

/** Downsampling factor per axis relative to the finest mag, e.g. [2, 2, 1]. */
type Mag = Vector3;

/** Index into the layer's ordered mag list. 0 === finest mag. */
type MagIndex = number;

/** uint64 on the wire, therefore bigint in JS. 0n === background. */
type SegmentId = bigint;

/** [bucketX, bucketY, bucketZ, magIndex, additionalCoordinates] */
type BucketAddress = readonly [
  number, number, number, MagIndex, AdditionalCoordinate[] | null,
];

/** Stable string form so BucketAddress can be a Map key. */
type BucketKey = string & { readonly __brand: "BucketKey" };

const BUCKET_WIDTH = 32;
const BUCKET_VOXEL_COUNT = BUCKET_WIDTH ** 3; // 32_768

/**
 * Flat offset inside a bucket: `x + y * 32 + z * 1024` — x varies fastest.
 * (Matters for run-length encoding: runs are runs along x. See §5.8.)
 */
type VoxelIndex = number;

// ── Transaction context ─────────────────────────────────────────────────────

type OverwriteMode = "overwrite-all" | "overwrite-empty-only";

/** Everything that is constant for the duration of one user interaction. */
interface EditContext {
  layerId: string;
  /** The mag the user is looking at. The only mag the rasterizer ever runs at. */
  sourceMagIndex: MagIndex;
  sourceMag: Mag;
  /** Fixed for the whole transaction (4D/5D datasets). Part of every address. */
  additionalCoordinates: AdditionalCoordinate[] | null;
  activeSegmentId: SegmentId;
  overwriteMode: OverwriteMode;
  /** Annotation-level restriction; the rasterizer clips against it. */
  editableBoundingBox: BoundingBox | null;
}

// ── The central intermediary representation ─────────────────────────────────

/** Voxel writes for one bucket. Last write wins per index. */
type BucketWrites = Map<VoxelIndex, SegmentId>;

/** Voxel writes across buckets — the output of rasterization and propagation. */
type VoxelWriteSet = Map<BucketKey, { address: BucketAddress; writes: BucketWrites }>;
```

`VoxelWriteSet` is deliberately the *only* currency exchanged between the rasterizer, the mag propagation service and the transaction. Every tool, at every mag, produces one of these, and nothing downstream needs to know which tool produced it.

---

## 5. Components

```
   pointer / keyboard
          │
          ▼
   ┌──────────────┐
   │    Tool      │  brush · contour · fill · interpolate
   └──────┬───────┘
          │ EditIntent (declarative, source-mag-relative)
          ▼
   ┌──────────────┐        reads current values
   │  Rasterizer  │◀─────────────────────────────┐
   │  + overwrite │                              │
   │    predicate │                              │
   └──────┬───────┘                              │
          │ VoxelWriteSet @ source mag           │
          ▼                                      │
   ┌──────────────────────┐                      │
   │ VolumeTransaction    │──── apply writes ───▶│
   │ (write map, per      │                      │
   │  bucket, LWW)        │                ┌─────┴────────────┐
   └──────┬───────────────┘                │ WorkingDataCube  │
          │ on commit                      │ (resident        │
          ▼                                │  buckets → GPU)  │
   ┌──────────────────────┐                └─────┬────────────┘
   │ MagPropagation       │──── apply writes ───▶│
   │  A: → finest mag     │                      │
   │  B: → coarser mags   │                      │
   └──────┬───────────────┘
          │ TransactionDiff (finest-mag = authoritative,
          ▼                   coarser = derived)
     ┌────┴──────────────────────────┐
     ▼                               ▼
┌──────────────┐            ┌──────────────────┐
│ Undo/Redo    │            │ Save Queue       │
│ Log          │            │ (encode, batch,  │
│ (per-bucket, │            │  send)           │
│  checkpoints)│            └──────────────────┘
└──────────────┘
```

### 5.1 Tools → `EditIntent`

A tool's only job is to turn input events plus viewer state into a declarative description of the edit. It never touches a `Bucket`.

```ts
type EditIntent = AnalyticShape | DataDependentShape;

/** Fully determined by geometry — no voxel reads needed to know the region. */
type AnalyticShape =
  | { kind: "brush";
      /** Pointer path in source-mag voxel coordinates (floats). */
      path: Vector3[];
      /** Constant for the whole stroke — brush size cannot change mid-stroke. */
      radius: number;
      /** null => 3D sphere brush; otherwise paint one slice along this axis. */
      planeAxis: 0 | 1 | 2 | null }
  | { kind: "polygon"; vertices: Vector3[]; planeAxis: 0 | 1 | 2 }
  | { kind: "box"; min: Vector3; max: Vector3 };

/** Region depends on the data itself; must be resolved against the cube. */
type DataDependentShape =
  | { kind: "floodFill"; seed: Vector3; is3D: boolean; bounds: BoundingBox | null }
  | { kind: "sliceInterpolation"; axis: 0 | 1 | 2; sliceA: number; sliceB: number }
  /** Escape hatch for ML/quick-select tools that produce a mask directly. */
  | { kind: "mask"; origin: Vector3; size: Vector3; bits: Uint8Array };
```

The split matters. Analytic shapes really are mag-independent — the same brush stroke rasterized at mag 1 and mag 4 describes the same physical region. Data-dependent shapes are **not**: a flood fill seeded at the same point yields a different region at mag 1 than at mag 4, because connectivity is evaluated on different data. So `EditIntent` coordinates are expressed in *source-mag* voxel space and `sourceMagIndex` is part of the intent's meaning, not an incidental detail. Framing all intents as mag-1-space geometry would be wrong for this half of the tools.

Adding a tool means adding an `EditIntent` variant and a rasterization case — nothing else in the system changes.

### 5.2 `VolumeTransaction` — the write map

One transaction per user interaction. It is a write recorder, not a snapshot differ.

```ts
class VolumeTransaction {
  readonly id: TransactionId;
  readonly ctx: EditContext;

  /** The intermediary representation. Last write wins per (bucket, voxel). */
  private writes = new Map<BucketKey, { address: BucketAddress; writes: BucketWrites }>();

  /** Pre-transaction values, recorded on first touch — only for resident buckets. */
  private before = new Map<BucketKey, Map<VoxelIndex, SegmentId>>();

  /**
   * Record a write. Does NOT require the bucket to be resident (principle 4).
   * If it is resident, the value is also written through to the live array so
   * the GPU picks it up on the next texture update.
   */
  record(address: BucketAddress, index: VoxelIndex, value: SegmentId): void;

  /** Merge a whole VoxelWriteSet (from rasterizer or mag propagation). */
  recordAll(writeSet: VoxelWriteSet): void;

  /** Finalize: run mag propagation, drop no-ops, build the diff. */
  commit(propagation: MagPropagationService): TransactionDiff;

  /** Restore every touched resident bucket from `before`. Used for Escape. */
  abort(): void;
}
```

Why a write map rather than "snapshot the bucket, mutate freely, diff at the end":

- Repeated writes to the same voxel during a stroke coalesce automatically — a brush that passes over the same voxel 40 times produces one entry.
- It works for non-resident buckets, which snapshot-and-diff cannot (there is nothing to snapshot).
- Its size is proportional to the edit, not to the number of touched buckets. A stroke that grazes 300 buckets and writes 5 voxels in each costs 1500 entries, not 300 × 32768.

`before` is only populated for resident buckets and is only used for `abort()` (and for the fast-path undo in §5.7). It is *not* needed for forward replay.

**Cancel is not free, but it is cheap.** Because we do apply writes live (the user must see the stroke), cancelling means restoring the touched voxels from `before`, not "throwing away an untouched buffer". That is O(number of written voxels), which is fine.

### 5.3 Rasterizer

The single place that turns geometry into voxel indices.

```ts
/** Read-only view over the cube; keeps the rasterizer decoupled from storage. */
interface VoxelReader {
  /** Current value at a voxel in `magIndex` grid coords. */
  peek(voxel: Vector3, magIndex: MagIndex): SegmentId | undefined; // undefined = not resident
}

interface Rasterizer {
  /**
   * Rasterize `shape` at ctx.sourceMagIndex. Always the source mag — never
   * called a second time for another mag (see §5.4).
   */
  rasterize(shape: EditIntent, ctx: EditContext, reader: VoxelReader): VoxelWriteSet;
}
```

Responsibilities, in order:

1. Compute the candidate voxel set: bucket-align the shape's bounding box at the source mag, clip against `ctx.editableBoundingBox` and the layer bounding box.
2. Test containment per voxel (distance-to-path for a brush, point-in-polygon for a contour, connectivity for a fill).
3. Apply the **overwrite predicate**.

```ts
type OverwritePredicate = (voxel: Vector3) => boolean;

function makeOverwritePredicate(ctx: EditContext, reader: VoxelReader): OverwritePredicate {
  if (ctx.overwriteMode === "overwrite-all") return () => true;
  return (voxel) => (reader.peek(voxel, ctx.sourceMagIndex) ?? 0n) === 0n;
}
```

A sketch of the brush case, to make the shape of the work concrete:

```ts
function rasterizeBrush(
  shape: Extract<AnalyticShape, { kind: "brush" }>,
  ctx: EditContext,
  reader: VoxelReader,
): VoxelWriteSet {
  const out: VoxelWriteSet = new Map();
  const allowed = makeOverwritePredicate(ctx, reader);

  for (const [a, b] of consecutivePairs(shape.path)) {
    // Capsule: everything within `radius` of the segment a→b, in source-mag space.
    const bbox = capsuleBoundingBox(a, b, shape.radius).clipTo(ctx.editableBoundingBox);

    for (const voxel of iterateVoxels(bbox, shape.planeAxis)) {
      if (distanceToSegment(voxel, a, b) > shape.radius) continue;
      if (!allowed(voxel)) continue;
      addWrite(out, voxel, ctx, ctx.activeSegmentId);
    }
  }
  return out;
}

function addWrite(
  out: VoxelWriteSet, voxel: Vector3, ctx: EditContext, value: SegmentId,
): void {
  const address = bucketAddressOf(voxel, ctx.sourceMagIndex, ctx.additionalCoordinates);
  const key = bucketKey(address);
  let entry = out.get(key);
  if (entry == null) { entry = { address, writes: new Map() }; out.set(key, entry); }
  entry.writes.set(voxelIndexOf(voxel), value);
}
```

**The rasterizer runs exactly once per transaction, at the source mag.** Every other mag's content is derived by §5.4, never by re-rasterizing the same geometry at a different resolution. Rasterizing independently per mag would (a) cost N× and (b) produce boundary disagreements — a circle rasterized at mag 1 and a circle rasterized at mag 2 do not agree about their edges, so the pyramid would be internally inconsistent in a way no downsampling rule could repair.

Erasing is not a special case: it is a rasterization with `activeSegmentId = 0n` and `overwriteMode = "overwrite-all"`.

### 5.4 `MagPropagationService`

```ts
interface MagPropagationService {
  /** Step A: source mag → finest mag. Pure block replication. */
  driveDownToFinest(writes: VoxelWriteSet, ctx: EditContext): VoxelWriteSet;

  /** Step B: finest mag → every coarser mag. Pure; reads no voxel data. */
  propagateUp(finestWrites: VoxelWriteSet, ctx: EditContext): VoxelWriteSet;
}
```

#### Step A — drive down to the finest mag

A source-mag voxel `q` covers the axis-aligned block of finest-mag voxels `[q · s, (q+1) · s)` where `s = ctx.sourceMag`. Replicate the value across the block:

```ts
function* driveDown(writes: VoxelWriteSet, s: Mag): Iterable<[Vector3, SegmentId]> {
  for (const { address, writes: bw } of writes.values()) {
    for (const [index, value] of bw) {
      const q = globalVoxelOf(address, index);              // source-mag grid
      const base: Vector3 = [q[0] * s[0], q[1] * s[1], q[2] * s[2]];
      for (let dz = 0; dz < s[2]; dz++)
        for (let dy = 0; dy < s[1]; dy++)
          for (let dx = 0; dx < s[0]; dx++)
            yield [[base[0] + dx, base[1] + dy, base[2] + dz], value];
    }
  }
}
```

This needs no reads and no bucket loads, and it is exact: drawing at a coarse mag *means* producing blocky finest-mag geometry. That is the accepted cost of annotating at low resolution.

**Overwrite mode is evaluated at the source mag only — deliberately.** The predicate already ran in §5.3 against source-mag values; the drive-down writes unconditionally. The consequence is real and should be documented in the UI: in `overwrite-empty-only` mode at mag 4, a coarse voxel that reads as empty may still contain labeled finest-mag voxels, and those get overwritten. The alternative — re-evaluating the predicate per finest-mag voxel — would require the finest-mag buckets to be resident, i.e. it would turn every coarse-mag brush stroke into hundreds of bucket fetches. Evaluating at the source mag is also arguably the better semantics: the user's intent ("don't paint over that segment") is formed from what they can actually see.

**Write amplification is the thing to watch here.** At mag `16-16-16`, each source voxel expands to 4096 finest-mag voxels. A stroke covering ~2000 mag-16 voxels implies ~8.2 M finest-mag voxels spanning ~250 finest-mag buckets. Materializing those as typed arrays would be ~64 MB. We do not: per principle 4, writes are recorded against bucket addresses whether or not the bucket is resident, and per principle 6 the diff for such a bucket run-length-encodes to a handful of kilobytes because it is a solid block fill. Non-resident buckets are never loaded just to be written; when they are later fetched, the backend has already folded the diff in (and any not-yet-saved local diffs are applied on load).

#### Step B — project up into coarser mags

For each coarser mag `m`, a finest-mag voxel `p` belongs to coarse voxel `⌊p / m⌋`. Many finest-mag voxels collapse into one coarse voxel, so a rule is needed:

```ts
/**
 * Written-value-wins: a written finest-mag voxel sets its coarse voxel to that
 * value. Background (0n) is not special — it is just another segment ID.
 */
function projectUp(
  finest: Iterable<[Vector3, SegmentId]>,
  m: Mag, magIndex: MagIndex, ctx: EditContext,
): VoxelWriteSet {
  const out: VoxelWriteSet = new Map();
  for (const [p, value] of finest) {
    const coarse: Vector3 = [
      Math.floor(p[0] / m[0]), Math.floor(p[1] / m[1]), Math.floor(p[2] / m[2]),
    ];
    addWrite(out, coarse, { ...ctx, sourceMagIndex: magIndex }, value);
  }
  return out;
}
```

Three things about this rule are worth stating explicitly, because they are choices, not consequences:

- **Background is not a special value.** Erasing is painting with `0n`, and it projects like any other value: one erased finest-mag voxel clears its whole coarse voxel. The tempting alternative — "only clear the coarse voxel if *all* its finest-mag siblings are now background" — is more faithful but needs a read of every sibling, which drags bucket residency back into a step that otherwise needs no data at all. Not worth it for a display-only approximation. This is also what webKnossos does today (`downsampleVoxelMap` any-hits a 0/1 *mask*, and `applyVoxelMap` then writes the segment ID — zero included — into every masked voxel at every mag).
- **The result is a dilation in both directions, not a true downsample.** Paint overstates presence at coarse mags; erase overstates absence. Majority vote (the textbook rule) would instead make thin structures disappear entirely — a 1-voxel-wide process annotated at mag 1 would be invisible the moment the user zooms out, which is unacceptable for tracing work. The upside of written-value-wins is predictability: whatever you just did is visible at every zoom level.
- **We propagate the write set, not the bucket.** The natural-sounding alternative — "recompute each affected coarse bucket from its finest-mag children" — is infeasible: a mag-16 bucket covers `512³` finest-mag voxels, i.e. `16·16·16 = 4096` finest-mag buckets. (The child count is the product of the per-axis ratio — a `2-2-1` bucket has 4 children, a `16-16-16` bucket has 4096.) Propagating the write set touches only the voxels the user actually edited and requires no additional loads.

Because background is not special, **mag propagation reads no data whatsoever** — it is a pure function of `(writeSet, magList)`. That is why `propagateUp` above takes no `VoxelReader`, and it is what makes principle 4 hold end-to-end: no step between pointer input and diff can be forced to load a bucket.

If the layer's finest mag is not mag 1 (some datasets start coarser), "finest mag" means index 0 throughout — nothing else changes.

#### What is authoritative

Only **finest-mag** diffs are authoritative *for undo*. Coarser-mag diffs produced by Step B are marked `derived: true` and are not replayed by undo (§5.7) — after an undo the affected coarse buckets are re-projected from the finest mag instead. Folding a coarse bucket's diff log with one entry skipped does not generally equal projecting the resulting finest-mag content, because written-value-wins is order-dependent and not invertible.

**All mags' diffs are sent to the backend, which applies them verbatim per mag and never resamples.** This is the same division of labour as today, where `updateBucket` ships per-mag bucket data and the backend stores what it is given; only the payload changes from a whole bucket to a diff.

The alternative — send only finest-mag diffs and let the backend derive the coarser mags — is tempting for payload size but does not actually work here, and the reason is worth spelling out because it constrains the projection rule:

- Written-value-wins is **order-dependent**: it is a function of the sequence of writes, not of the final voxel data.
- A backend deriving coarse mags from stored finest-mag data only ever sees final state, so it cannot reproduce an order-dependent rule under *any* choice of derivation rule.
- The result would be coarse mags that visibly change on reload.

So the projection rule and the save strategy are coupled: a simple order-dependent rule requires sending all mags; a data-derivable rule (majority vote, any-non-zero, …) would permit finest-mag-only payloads but drags back the per-voxel sibling reads this design just removed, and pins client and server to an identical rule forever.

Sending all mags is cheap. Coarse-mag diffs shrink geometrically with the pyramid, so the total is roughly `1.15×` the finest-mag diff for a 3D stroke and `~1.33×` for a thin/2D one — a small price for eliminating drift by construction and for asking the backend only to fold diffs (which requirement 3 needs regardless) rather than to fold *and* derive.

### 5.5 `WorkingDataCube`

Unchanged in spirit from today: one `32³` typed array per resident `(bucketPosition, magIndex, additionalCoordinates)`, lazily fetched, evicted under memory pressure, feeding GPU textures directly.

```ts
interface WorkingDataCube extends VoxelReader {
  isResident(address: BucketAddress): boolean;
  /** Never triggers a fetch. Returns undefined if not resident. */
  getResident(address: BucketAddress): BigUint64Array | undefined;
  applyWrites(address: BucketAddress, writes: BucketWrites): void;
  markDirtyForGpu(address: BucketAddress): void;
}
```

Two constraints the new model adds:

- **Eviction must respect pending state.** A bucket with unsaved diffs, or whose diff log is still needed by the undo horizon, cannot simply be dropped. Either keep it, or persist its log (checkpoint + entries) alongside the eviction — the log, not the array, is the thing that must survive.
- **Load must fold pending local diffs.** A bucket fetched from the backend may predate diffs this client has recorded but not yet saved. On load, apply the pending entries from its log before handing the array to the GPU.

### 5.6 Diff types

```ts
/** A run of consecutive voxel indices. `values` is a single SegmentId when the
 *  run is constant (the common case for painting), otherwise one per voxel. */
interface VoxelRun {
  start: VoxelIndex;
  length: number;
  values: SegmentId | BigUint64Array;
}

interface BucketDiff {
  address: BucketAddress;
  runs: VoxelRun[];
  /** true for coarse-mag diffs produced by mag propagation (§5.4). */
  derived: boolean;
  /** Pre-transaction values, if known. Optional — see §5.7. */
  before?: VoxelRun[];
}

interface TransactionDiff {
  id: TransactionId;
  layerId: string;
  /** Monotonic per client. Becomes the merge key in collaborative mode (§7). */
  sequence: number;
  timestamp: number;
  toolName: string;                       // diagnostics only, not load-bearing
  bucketDiffs: BucketDiff[];
  /**
   * Non-voxel changes belonging to the same interaction: a newly created
   * segment, largestSegmentId bumps, mapping locking, etc. Carried here so that
   * "one interaction = one transaction" holds for the whole annotation state,
   * not just for voxels — and so undo restores them together.
   */
  sideEffects: UpdateAction[];
}
```

Building the diff from the write map is a straightforward grouping pass:

```ts
function toRuns(writes: BucketWrites): VoxelRun[] {
  const indices = [...writes.keys()].sort((a, b) => a - b);
  const runs: VoxelRun[] = [];
  let i = 0;
  while (i < indices.length) {
    const start = indices[i];
    let length = 1;
    while (i + length < indices.length && indices[i + length] === start + length) length++;
    const slice = indices.slice(i, i + length).map((ix) => writes.get(ix)!);
    const constant = slice.every((v) => v === slice[0]);
    runs.push({ start, length, values: constant ? slice[0] : BigUint64Array.from(slice) });
    i += length;
  }
  return runs;
}
```

No-op writes (`newValue === oldValue`, knowable for resident buckets) are dropped before this step, so a stroke that repaints voxels already carrying the active segment ID produces no diff at all for those voxels.

### 5.7 Undo/Redo Log

Requirement: per-transaction undo that does not discard edits that happened afterwards — which rules out "restore the bucket snapshot from before the transaction".

**Model: a per-bucket ordered event log, not a global stack of inverses.**

```ts
interface BucketLogEntry {
  sequence: number;
  transactionId: TransactionId;
  runs: VoxelRun[];
  skipped: boolean;              // set by undo, cleared by redo
}

interface BucketLog {
  /** Folded content at `checkpoint.sequence`; bounds how far replay must go. */
  checkpoint: { sequence: number; data: BigUint64Array } | null;
  entries: BucketLogEntry[];     // ascending by sequence
}

interface UndoLog {
  append(diff: TransactionDiff): void;
  undo(id: TransactionId): void;
  redo(id: TransactionId): void;
}
```

A bucket's content is *defined* as: nearest checkpoint, then apply every non-skipped entry's runs in sequence order. The live typed array is a cached fold of exactly this.

```ts
function rebuild(log: BucketLog): BigUint64Array {
  const data = log.checkpoint
    ? log.checkpoint.data.slice()
    : new BigUint64Array(BUCKET_VOXEL_COUNT);   // or the fetched backend state
  for (const entry of log.entries) {
    if (entry.skipped) continue;
    for (const run of entry.runs) applyRun(data, run);
  }
  return data;
}
```

**Undo(T):** mark T's entries `skipped` in each bucket log it touched, then `rebuild` those buckets. Entries *after* T — whether this user's or, later, a collaborator's — are replayed normally, so their effects survive. There is no inverse being computed and applied; only forward folding with one entry removed. **Redo(T):** clear the flag, rebuild again.

Then re-project the coarse mags for the affected region (§5.4), rather than replaying the `derived: true` diffs, for the reason given at the end of §5.4. And revert `sideEffects` through the normal update-action mechanism.

**`before` is not what makes forward-only undo work** — forward replay never reads it. It is optional, and worth keeping for three narrower reasons:

1. **Fast-path undo.** If T is the newest transaction touching a bucket, undo is just "write `before` back", which is O(voxels changed) instead of a checkpoint replay. This is the overwhelmingly common case in single-user editing, so the fast path carries almost all real traffic.
2. **`abort()`** (Escape during a stroke) uses them.
3. **Conflict detection** later: comparing a remote diff's `before` against local state reveals concurrent edits to the same voxels, which is what a merge policy needs.

They are never sent to the backend — the backend's version history already reconstructs prior state for its own purposes.

**Cost.** Replay is scoped to exactly the buckets T touched (recorded on the `TransactionDiff`) and to the entries since their checkpoints — not to the layer's whole history.

**Checkpoints** exist only to bound replay length and memory. Take one per bucket every *k* entries, and when a bucket is about to be evicted with a long log. Entries older than the undo horizon (e.g. the last 100 user actions, matching normal editor UX) can be folded into the checkpoint and dropped. *k* on the order of 20–50 is a reasonable starting point; see §9.

The UI-level undo stack is unchanged from a conventional editor: an ordered list of this client's `TransactionDiff`s, with `undo` targeting the newest non-skipped one. Only the *realization* of an undo differs.

### 5.8 Save Queue / Backend Sync

`TransactionDiff`s are queued and flushed with the same debounce-and-batch behaviour as today's push queue; what changes is the payload — a diff instead of a whole bucket.

```ts
interface UpdateBucketDiffAction {
  name: "updateBucketDiff";
  value: {
    actionTracingId: string;
    position: Vector3;                       // bucket position
    mag: Vector3;
    additionalCoordinates: AdditionalCoordinate[] | null;
    /** base64 of the binary run encoding below. */
    runs: string;
  };
}

/**
 * Binary run encoding, little-endian:
 *   uint32  runCount
 *   repeat runCount times:
 *     uint32  startIndex        // flat voxel index within the 32³ bucket
 *     uint32  length | CONST_FLAG
 *     if CONST_FLAG: uint64 value          (one value for the whole run)
 *     else:          uint64 value × length
 */
const CONST_FLAG = 0x8000_0000;
```

Encoding notes:

- **Runs are runs along x**, because the flat index is `x + y·32 + z·1024`. A brush stroke in an XY viewport therefore run-encodes very well; the same stroke in a YZ viewport (x constant) degenerates to length-1 runs. Worth knowing before over-claiming the win — but the `CONST_FLAG` path still saves the per-voxel value bytes in both cases, and general-purpose compression on the transport handles the rest.
- **Block fills encode very compactly**, which is what makes coarse-mag editing viable: the drive-down of one mag-16 voxel into a finest-mag bucket is a solid `16×16×16` block, i.e. 256 constant runs of length 16 — about 4 KB before compression, versus 256 KB for the full bucket.
- **One action per touched bucket; one versioned group per transaction.** This gives the backend (and later, other clients) the transaction boundary explicitly instead of making it infer grouping from timing.
- **Ordering and idempotency.** Transactions are submitted in `sequence` order and are idempotent on retry, so a reconnect can safely resend the tail of the queue.
- **Backend counterpart.** This requires the tracingstore to accept per-bucket diffs and fold them into the bucket's stored content rather than overwriting wholesale. That is the change that actually unlocks multi-user diff composition; without it, two users' concurrent edits to one bucket still resolve as last-writer-wins over the entire bucket. It is the *only* change required: diffs arrive for every mag and are applied verbatim to that mag, so the backend never resamples and needs no notion of the mag pyramid (§5.4).

---

## 6. Worked Examples

### 6.1 Brush stroke at the finest mag

1. **Pointer-down.** `VolumeTransaction` opens with an `EditContext` snapshotting the active segment ID, overwrite mode, source mag and additional coordinates. An empty `brush` intent is created, with the brush radius fixed for the stroke.
2. **Pointer-move.** The tool appends a point to the path. Only the *incremental* capsule (previous point → new point) is rasterized, at the source mag. The rasterizer applies the overwrite predicate and returns a `VoxelWriteSet`.
3. **Record + display.** `transaction.recordAll(writeSet)` merges it into the write map and writes through to resident buckets; their GPU textures are refreshed. The user sees the stroke immediately.
4. Steps 2–3 repeat. Overlapping samples coalesce in the write map at no cost.
5. **Pointer-up → commit.** Mag propagation runs *once*, over the whole accumulated write map: Step A is a no-op (already at the finest mag); Step B projects into every coarser mag and those writes are applied to resident coarse buckets too.
6. The write map becomes a `TransactionDiff` (no-ops dropped, runs grouped), appended to the undo log and enqueued for save.

Running mag propagation on *every pointer-move* was considered and discarded: it does strictly more total work, since overlapping samples get re-propagated, for no correctness benefit.

Two costs come with that choice. A second viewport showing a different mag lags until pointer-up. And the propagation work lands as a spike on pointer-up rather than being spread across the stroke, which may read as a hitch even though the total CPU cost is lower.

**Both are tunable without touching the architecture.** Propagation is a pure function `VoxelWriteSet → VoxelWriteSet` applied to the cube, not to the diff, and — because drive-down and written-value-wins are both per-voxel maps — it distributes over the write set: `propagate(A ∪ B) == propagate(A) ∪ propagate(B)`. So running it mid-stroke on a throttle, for visible mags only, produces exactly the same result as running it once at commit. The throttle interval is a free parameter, including "never", which is the default above.

The spike is worst for coarse-mag strokes, and there the throttle is the wrong lever — see §9.

### 6.2 Brush stroke at mag 16

Identical, except at commit:

- Step A expands ~2000 mag-16 voxels into ~8.2 M finest-mag voxels across ~250 finest-mag buckets. Almost none of those buckets are resident (the user is zoomed out); no fetches are triggered. Their writes live only in the write map and then in the diff, run-encoded as block fills.
- Step B projects those finest-mag writes into mags 1…N. The mag-16 buckets the user is actually looking at were already updated live in step 3, and Step B's projection agrees with them (both derive from the same writes), so there is no visible re-flicker.
- The save payload is a few hundred `updateBucketDiff` actions of a few KB each — not 64 MB of bucket data.

### 6.3 Undo with an intervening transaction

The user paints stroke `T1` (segment 5) over a region, then stroke `T2` (segment 7) partially overlapping it, then presses Ctrl+Z.

- `T2` is the newest transaction on every bucket it touched → **fast path**: write `T2.before` back. Done, O(voxels in T2).
- Had the user instead undone `T1` (via a history panel), the slow path runs: mark `T1`'s entries skipped in each affected bucket log, rebuild from the nearest checkpoint replaying `T2` but not `T1`. Voxels that `T2` painted stay segment 7; voxels only `T1` touched revert to their pre-`T1` value. Under the old snapshot-restore model, `T2`'s overlapping work would have been silently destroyed.
- Affected coarse mags are re-projected from the rebuilt finest-mag content.

---

## 7. Toward Collaborative Editing

Not implemented here, but the shape is deliberately compatible:

- Diffs, not snapshots, are the unit of truth, so a remote peer's diff and a local one are the same object.
- The per-bucket ordered log with last-write-wins folding is already the merge structure. A remote `TransactionDiff` is handled exactly like an undo replay: insert its entries at the right sequence position in the affected bucket logs and re-fold.
- `TransactionDiff.sequence` is today just local chronological order. Making it a *total* order across users needs either server-assigned sequence numbers (simple, costs a round-trip) or a logical clock (no round-trip, more complexity). Either slots into the existing `sequence` field without changing the model.
- `BucketDiff.before` becomes useful here: comparing it against local state detects genuine conflicts rather than assuming last-writer-wins is always acceptable.
- Undo becomes "skip *my* transaction, keep everyone else's", which is exactly what the forward-replay model already does.

---

## 8. Rejected Alternatives

| Alternative | Why not |
|---|---|
| Send full bucket snapshots (today's model) | Simple, but two users' edits to one bucket can only resolve as last-writer-wins over the whole bucket. Blocks requirement 3. |
| Undo as a stack of inverse diffs applied to live state | Correct only if nothing else touched those voxels in between. Breaks under collaboration and even under some local redo orderings. |
| Undo as full-bucket snapshot restore | Same problem, worse: silently reverts *all* later edits to the bucket, not just the undone ones. |
| Rasterize the shape independently at each mag | N× the work, and the per-mag results disagree at boundaries, leaving the pyramid inconsistent in a way no downsampling can fix. |
| Recompute each coarse bucket from its finest-mag children | Infeasible: a mag-16 bucket has 4096 finest-mag children. Propagate the *write set* instead. |
| Majority-vote downsampling into coarse mags | Thin structures vanish when zooming out. Written-value-wins keeps them visible; the resulting dilation is the accepted price. |
| Treat background as special when projecting (clear a coarse voxel only if all finest-mag siblings are background) | More faithful, but requires reading every sibling — which re-couples mag propagation to bucket residency and forces loads during coarse-mag strokes. |
| Send only finest-mag diffs; let the backend derive coarse mags | Written-value-wins is order-dependent, so a backend seeing only final state cannot reproduce it under any derivation rule. Coarse mags would visibly change on reload. Sending all mags costs ~15–35% more payload and avoids this entirely. |
| Keep diffs at their authoring mag, never normalize | No single source of truth; reading mag *k* requires folding diffs authored at every other mag, with ill-defined ordering between them. |
| Snapshot-then-diff per bucket instead of a write map | Cannot represent writes to non-resident buckets, and costs O(bucket) per touched bucket even for a 5-voxel edit. |

---

## 9. Open Questions

- **Flood fill and unloaded data.** Fill needs the connected region resident to be correct. Options: block on fetches with a progress indicator, fill progressively as buckets arrive, or bound the fill to a region and refuse beyond it. Needs a UX decision — this is the one tool where "diffs for non-resident buckets" does not save us, because the *region itself* depends on data we do not have.
- **Interaction with mappings / agglomerates.** Proofreading edits operate on mapped IDs, and `EditContext.activeSegmentId` is then an agglomerate ID rather than a stored one. Where the mapping is resolved (before rasterization? at apply time?) is unresolved and deserves its own section.
- **Commit-time spike on coarse-mag strokes, and symbolic drive-down.** At mag 1 the commit-time propagation pass is small (no drive-down; project-up is O(voxels × mags)) and a throttled mid-stroke preview is enough to smooth it. At mag 16 it is not: drive-down expands ×4096, so a 2000-voxel stroke becomes ~8.2 M `Map` entries at pointer-up. Spreading that across the stroke does not help — the expansion is inherent and per-sample propagation would only multiply it. The real lever is to keep the drive-down **symbolic**: represent it as a list of `(box, value)` fills rather than expanding per voxel, and materialize only for buckets that are actually resident. The `toRuns` encoder already emits near-optimal output for block fills, so this is mostly a matter of not expanding eagerly in `driveDown` (the sketch in §5.4 does, for readability). Worth measuring before building.
- **Checkpoint interval *k*.** Too small → memory and storage overhead; too large → slow replay and slow eviction. Start around 20–50 entries per bucket and tune empirically. Interacts with the undo horizon.
- **Where does the rasterizer run?** It is a pure function of `(intent, context, reader)`, which makes it a good Web Worker candidate for large strokes. Not needed for correctness; the blocker is giving a worker a cheap read view of resident buckets (`SharedArrayBuffer`, probably).
- **Coarse mags diverge from a fresh downsampling, permanently.** Not drift between client and server — the backend applies the client's per-mag diffs verbatim, so reload is faithful (§5.4). But because written-value-wins is order-dependent, the stored coarse mags are a function of *how* the region was edited, and no later pass can reconstruct them from the finest mag. Principle 2 accepts this. If it ever stops being acceptable, the answer is a background re-derivation job that rewrites coarse mags from the finest mag on a schedule — which would also settle what "correct" means at coarse mags, a question this doc does not answer. Note that adopting a data-derivable rule instead would re-couple propagation to bucket residency; see §5.4.
- **Undo across a reload.** The log is currently in-memory. Persisting it (IndexedDB) would let undo survive a refresh, but raises the question of what "undo" means once the backend has already accepted the transaction. Probably out of scope, but worth deciding explicitly rather than by omission.
