# Green-Field Architecture: Frontend Volume Annotation Editing

Status: draft / discussion doc
Scope: how the **frontend** represents, edits, undoes and saves volume (segmentation) annotation data. Backend implications are called out where the contract necessarily spans both sides, but are not designed in depth here.

This document intentionally does not try to stay close to the current implementation. It proposes a design from first principles, given the constraints below, so that we have a "north star" to compare the existing architecture against. A follow-up doc can define an incremental migration path.

Code in this document is illustrative TypeScript — signatures and sketches meant to pin down responsibilities and data flow, not copy-pasteable implementations.

A working spike of the design lives in `frontend/javascripts/prototypes/new_volume_architecture`, exercised by unit tests and wired into the brush behind a toggle. Where this doc quotes concrete figures for the coarse-mag case (§5.4), they are measured from it rather than estimated.

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

### 1.1 Terminology

Three words this doc leans on heavily and that are not today's vocabulary.

#### Folding

To **fold** a bucket is to reduce an ordered sequence of diff entries onto a base array, producing the bucket's content. The name is the functional `fold`/`reduce`: a base value, a sequence, and a combining step. (`BucketLogEntry` and `VoxelRun` are defined in §5.7 and §5.6; only their shape matters here.)

```ts
function fold(
  base: BigUint64Array,
  entries: BucketLogEntry[],          // ascending by sequence
  include: (e: BucketLogEntry) => boolean,
): BigUint64Array {
  const data = base.slice();
  for (const entry of entries) {
    if (!include(entry)) continue;
    for (const run of entry.runs) applyRun(data, run);   // absolute writes
  }
  return data;
}
```

Everything rests on the runs being **absolute writes** — "voxel `i` becomes `v`", not "voxel `i` changes by `v`". A later entry simply overwrites an earlier one wherever they touch the same voxel, so replaying in sequence order is exactly what "last-write-wins" means mechanically. It is also why folding never has to invert anything and never has to run backwards: to remove an entry's effect you re-fold without it (principle 5), rather than computing its opposite.

The same loop serves both callers; only the base and the filter differ:

| Caller | Base | Filter |
|---|---|---|
| undo / redo (§5.7) | nearest local checkpoint | skip entries marked `skipped` |
| bucket load (§5.5) | freshly fetched backend data | skip entries that data already contains |

Per principle 3 the fold *is* the definition of a bucket's content; the `32³` array held in memory is a cached result of one, kept because the GPU needs an array rather than a log.

#### Authoritative

Something is **authoritative** when it *defines* content rather than holding a copy of it — everything else is a derived cache that may be discarded and rebuilt. The word appears in two scopes in this doc, answering different questions.

*Which representation defines the content.* Two claims, both in §3:

- **The journal is authoritative over the arrays** (principle 3). A bucket's content is *defined* as checkpoint plus ordered entries; the `32³` array in memory is a fold of that definition, kept only because the GPU needs an array. Evicting an array costs nothing but time; losing the journal loses the edit.
- **The finest mag is authoritative over the coarser ones** (principle 2). Every edit lands there at full fidelity, while coarser mags are lossy, order-dependent approximations produced for display. This concerns *fidelity only* — it does not mean coarse mags are second-class in the log, because every mag's diffs are logged and replayed identically (§5.4).

*Whether a particular bucket array holds real data.* Independently of the above, an array is authoritative when its bytes are the backend's content with all known diffs folded in — as opposed to the zero-filled placeholder a bucket carries while its fetch is in flight. This is exactly the `resident` versus `pending` distinction below, and it is what `VoxelReader.getResident` reports by returning `undefined`. Code that must not mistake "not loaded yet" for "empty" needs authority in this sense: the overwrite predicate (§5.3) and `beforeAccumulating` capture (§5.2).

#### Residency

This doc also uses **resident** throughout. Here is what it means and how it maps onto the states buckets actually have.

Two independent questions decide a bucket's state: *is there a `32³` array for it in memory?* and *does that array reflect the backend's content?*

| State | Array in memory | Contents authoritative | Can record diffs | Can render |
|---|---|---|---|---|
| **absent** | no | — | **yes** | no |
| **pending** | yes, zero-filled + local writes | no — backend data has not arrived | **yes** | local edits only |
| **resident** | yes | yes | **yes** | yes |

> **resident** = the array exists *and* holds the backend's content with all known diffs folded in.

Orthogonal to all three: **dirty** — the bucket has diffs not yet acknowledged by the backend. In this design that is simply "its log has unsaved entries", which is what §5.5's eviction rule keys off. A fourth case, the out-of-bounds *null bucket*, never reaches the write set at all: the rasterizer's clipping step (§5.3, step 1) discards those addresses.

**Why the pending/resident split matters.** Four things in this design read bucket state, and they need different guarantees:

- *Recording a diff* needs nothing. Any of the three states works — this is principle 4, and it is what makes coarse-mag editing viable.
- *Write-through for display* needs an array to exist, so `absent` must first become `pending`. Whether the backend data has arrived is irrelevant; the merge on arrival sorts it out.
- *The overwrite predicate* (§5.3) and *`beforeAccumulating` capture* (§5.2) need **authoritative** content, so `pending` is not good enough. A pending bucket's array is zero-filled, and reading it would report "everything is background" — under `overwrite-empty-only` that means painting over data that turns out to be labeled. `VoxelReader.getResident` therefore returns `undefined` for pending buckets, deliberately, so a placeholder can never be mistaken for real content.

**How this relates to the current implementation.** Today, brushing over unloaded data always instantiates the bucket (cheap), writes into the zero-filled array, marks it dirty, and merges when the backend data arrives. That is exactly the `absent → pending → resident` path above, and it stays valid here — with one change:

**Materialization on write becomes optional, driven by visibility.** Today it is unconditional. It cannot stay unconditional, because a single mag-16 stroke implies writes to ~520 finest-mag buckets the user is not looking at (§5.4); instantiating all of them costs ~134 MB to no purpose. The rule is: materialize on write only if the bucket is visible or about to be. Otherwise record the diff against its address and leave it `absent`.

The merge-on-arrival step generalizes too: folding a bucket's journal entries onto freshly fetched data (§5.5) is the same fold undo performs (§5.7), differing only in its starting point — so the temporal-bucket merge and undo replay become one mechanism instead of two.

### 1.2 Non-requirements

Things this design deliberately does *not* support. Each is argued where it comes up; they are collected here so the constraints are visible up front rather than discovered in a subsection.

- **Mag lists that are not a chain.** Every mag must be an integer multiple of the next-finer one, so that the list is totally ordered by resolution. A layer offering both `4-4-1` and `2-2-2` would violate this — neither divides the other, since one is finer in x/y and the other in z — and mag propagation (§5.4) would have no defined path between them. Standard pyramids, including anisotropic ones like `1-1-1, 2-2-1, 4-4-2`, are chains and are fine. Today's resampling does not support the non-chain case either, so this is not a regression.
- **Coarse mags exactly matching a re-downsampling of the finest mag.** They are derived from the write sequence and are order-dependent; see principle 2 and §9.
- **`overwrite-empty-only` as a guarantee about data the user cannot see.** The predicate is evaluated against resident source-mag content only, so it protects neither finer detail hidden inside a coarse voxel nor buckets that have not finished loading. It is a guard against overwriting what is on screen, not an invariant over the layer; see §5.4.
- **Multi-valued transactions.** One user interaction writes one segment ID. This is relied on by the write-set representation (§4) and by the equivalence argument in §5.4.

---

## 2. Answers in Brief

The four questions this doc was written to answer:

**What happens when a user draws?** A tool converts pointer input into a declarative *edit intent* (a brush stroke, a polygon, a flood-fill spec). A single `VolumeTransaction` is opened on pointer-down and stays open until pointer-up. On each pointer-move the intent grows, the incremental part is rasterized at the mag the user is looking at, and the resulting voxel writes are recorded into the transaction (and applied to resident buckets so the user sees them immediately). On pointer-up the transaction commits: mag propagation runs, the accumulated write set becomes a set of per-bucket diffs, and those go to the undo log and the save queue.

**Who draws the circular brush into the data?** A single `Rasterizer` — the one component that knows how to turn geometry into voxel indices. Tools never touch buckets; buckets never know about brushes. The Rasterizer also owns the overwrite-mode filter, because that filter is a per-voxel decision made against current data, which is exactly its job.

**What is the intermediary representation?** A per-transaction **write set**: `bucketAddress → (bitmask of touched voxels + the segment ID being written)`, last-write-wins. This is the pivot point of the whole design. It coalesces repeated writes within a stroke for free, it can hold writes for buckets that are *not* in memory, and it converts trivially to both "apply to a live bucket" and "encode as a diff". Tools fill it through a bucket-scoped, run-oriented cursor, so no step of the pipeline pays a per-voxel function call or address computation.

**Who downsamples, and how is the diff encoded?** The `MagPropagationService` runs at commit time. Starting from the write set at the mag the user drew in, it walks the pyramid outward one level at a time: upsampling (block replication) toward the finest mag, and downsampling (written-value-wins, with background treated as an ordinary value) toward the coarsest. It propagates the *write set*, never whole buckets — recomputing a coarse bucket from its finest-mag children is infeasible (a mag-16 bucket has 4096 mag-1 children) — and it reads no voxel data at all. The diff is encoded as run-length-grouped voxel runs over the bucket's flat index space, one `updateBucketDiff` update-action per touched bucket, for every mag; all actions of a transaction are submitted as one versioned group, and the backend applies them verbatim without resampling.

---

## 3. Design Principles

1. **Geometry first, voxels second.** Tools describe *what the user meant*; a separate stage turns that into voxel writes. This is what makes "annotate at any mag" tractable — we rasterize once and derive everything else, rather than reconciling N independently-rasterized grids.

2. **The finest mag is the source of truth; coarser mags are a derived view.** Every edit, whatever mag it was authored at, resolves into finest-mag writes at full fidelity. Coarser mags are derived *at edit time* by downsampling the same writes — cheaply and locally, without reading data — and their diffs are then logged and replayed exactly like the finest mag's (§5.4). "Derived" describes the pyramid as a whole; mechanically each level is resampled from its neighbour rather than from mag 1, which for single-valued writes amounts to the same thing (§5.4).

   Crucially, we downsample the **writes**, at edit time — not the stored content, after the fact. Those are different operations with different results: the write-set downsampling is order-dependent, so it cannot be reconstructed later, and coarse mags will drift from what re-downsampling the finest mag afterwards would produce. **This is an accepted trade-off, for now.** It buys a propagation step that needs no data access and no bucket loads, which is what makes editing at coarse mags viable at all (§5.4). Coarse mags are a display approximation; the finest mag is what the annotation *means*. If exactness at coarse mags ever becomes a requirement, the fix is a background re-derivation pass, not a change to the editing path.

3. **Diffs are the unit of truth; buckets are a materialized cache.** A bucket's content is *defined* as "checkpoint + ordered diffs". The `32³` typed array in memory is a fold of that definition, kept around because the GPU needs it.

4. **A diff may exist for a bucket that is not in memory.** This falls out of (3) and is what makes coarse-mag editing scale: drawing at mag 16 implies writes to hundreds of finest-mag buckets, and we must be able to record them without materializing well over 100 MB of typed arrays. Recording a write must never force a bucket load.

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

/** One bit per voxel: 32_768 bits = 1024 words = 4 KB per bucket. */
class VoxelMask {
  /**
   * A "word" is one Uint32 holding the flags of 32 consecutive voxels, so
   * voxel `i` lives at bit `i & 31` of word `i >>> 5`.
   *
   * Because VoxelIndex is `x + y*32 + z*1024` and BUCKET_WIDTH is also 32,
   * a word is exactly one x-row of the bucket: word `w` covers the row at
   * `y = w & 31, z = w >>> 5`. That alignment is what makes `markRun` cheap —
   * a scanline never straddles a word boundary, so filling one is a single
   * store rather than a read-modify-write of two.
   */
  private words = new Uint32Array(BUCKET_VOXEL_COUNT / 32);
  mark(i: VoxelIndex): void;
  /** Word-wise fill; the hot path. `start..start+length` must stay in-bucket. */
  markRun(start: VoxelIndex, length: number): void;
  has(i: VoxelIndex): boolean;
  /**
   * Ascending runs of set bits, found by word scan. Runs never cross a word
   * boundary, and since a word is one x-row that means **every run is an
   * x-run** — mag propagation multiplies and divides a run's length as an
   * x-extent, so a run spanning rows would streak sideways across rows it
   * never touched. A solid bucket therefore yields 1024 runs, not one.
   */
  runs(): Iterable<{ start: VoxelIndex; length: number }>;
  get count(): number;
}

/**
 * Writes for one bucket: which voxels were touched, and the single value being
 * written. A transaction is always single-valued — one brush stroke, one fill,
 * one interpolation each write one activeSegmentId, and mag propagation
 * preserves values — so no per-voxel value is ever stored.
 */
interface BucketWrites {
  mask: VoxelMask;
  value: SegmentId;
}

/** Voxel writes across buckets — the output of rasterization and propagation. */
type VoxelWriteSet = Map<BucketKey, { address: BucketAddress; writes: BucketWrites }>;
```

`VoxelWriteSet` is deliberately the *only* currency exchanged between the rasterizer, the mag propagation service and the transaction. Every tool, at every mag, produces one of these, and nothing downstream needs to know which tool produced it.

**Why a mask and not `Map<VoxelIndex, SegmentId>`.** The per-voxel map is the obvious encoding and it does not survive contact with the numbers. The mag-16 stroke measured in §5.4 writes 9.25 M voxels; at V8's ~40–50 bytes per `Map` entry that is ~400 MB of hash-table overhead, versus 2.9 MB for 736 buckets' worth of 4 KB masks. It also pays a per-voxel value slot for a degree of freedom nothing uses. The mask form additionally makes §5.6's run extraction a word scan instead of a sort.

**Why there is no multi-valued variant.** Nothing produces one. Tools are single-valued by construction; propagation preserves values; undo folds stored runs directly into bucket arrays (§5.7) rather than building a write set; and undo is communicated to the backend as a skip marker rather than as a compensating diff (§5.8), so no "restore these various old values" write set is ever assembled. The one genuinely multi-valued data in the design is the pre-transaction values (`beforeAccumulating` / `beforeCommitted`, §5.2), which are never a `BucketWrites`.

A sparse form (a short index list) would beat a 4 KB mask for buckets the stroke merely grazes at its edges. Worth adding if profiling says edge buckets dominate; not worth the branch until then.

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
   │ (write set, per      │                      │
   │  bucket, LWW)        │                ┌─────┴────────────┐
   └──────┬───────────────┘                │ WorkingDataCube  │
          │ on commit                      │ (resident        │
          ▼                                │  buckets → GPU)  │
   ┌──────────────────────┐                └─────┬────────────┘
   │ MagPropagation       │──── apply writes ───▶│
   │  A: upsample→finest  │                      │
   │  B: downsample→coarse│                      │
   └──────┬───────────────┘
          │ TransactionDiff (finest mag = full fidelity;
          ▼                   every mag logged and replayed alike)
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
/**
 * Two families, split by *how the intent becomes voxels* — synchronously from
 * a region we already know, or asynchronously by reading data to discover one.
 */
type EditIntent = RasterizableShape | DataDependentShape;

/** Region already known; the Rasterizer converts it synchronously (§5.3). */
type RasterizableShape = AnalyticShape | MaskShape;

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

/**
 * An explicit dense region over an axis-aligned box, in source-mag voxel
 * space. Emitted directly by ML and quick-select tools, whose models naturally
 * produce a small dense patch and which should not have to know about buckets.
 * Rasterizable, because the region is already known — it merely happens to
 * have been derived from data at some earlier point.
 *
 * `selected` holds **one byte per voxel** (0 = outside, non-zero = inside),
 * indexed `x + y * size[0] + z * size[0] * size[1]`, with `x` fastest.
 * Length is exactly `size[0] * size[1] * size[2]`.
 */
type MaskShape = {
  kind: "mask";
  origin: Vector3;
  size: Vector3;
  selected: Uint8Array;
};

/**
 * Region discovered by reading the data, across buckets that may not be
 * loaded. Handled by the ShapeResolver, not the Rasterizer — see below.
 */
type DataDependentShape =
  | { kind: "floodFill"; seed: Vector3; is3D: boolean; bounds: BoundingBox | null }
  | { kind: "sliceInterpolation"; axis: 0 | 1 | 2; sliceA: number; sliceB: number };
```

A second, cross-cutting distinction: analytic shapes are mag-independent — the same brush stroke rasterized at mag 1 and mag 4 describes the same physical region. Mask and data-dependent shapes are **not**: a flood fill seeded at the same point yields a different region at mag 1 than at mag 4, because connectivity is evaluated on different data. So `EditIntent` coordinates are expressed in *source-mag* voxel space and `sourceMagIndex` is part of the intent's meaning, not an incidental detail. Framing all intents as mag-1-space geometry would be wrong for every variant except `AnalyticShape`. Note this cuts across the rasterizable/data-dependent split rather than following it: `MaskShape` is rasterizable but very much mag-specific.

Adding a tool means adding an `EditIntent` variant and one producer case — nothing else in the system changes.

**Why `MaskShape` is a byte array while `VoxelMask` (§4) is a packed `Uint32Array`.** They are solving different problems, and the divergence is deliberate.

`VoxelMask` is an internal hot-path structure. It is always exactly `32³` bits, `markRun` fills whole words, `runs()` scans them, and one word maps exactly onto one x-row of a bucket. The word width is load-bearing; nothing about it would survive a different representation.

`MaskShape` is an **interchange** format, and its constraints come from whoever hands it to us:

- **Alignment.** `new Uint32Array(buffer, byteOffset, …)` throws unless `byteOffset` is 4-aligned. A patch arriving as a slice of a WASM heap, a worker transfer, or a fetch response often is not. `Uint8Array` has no such constraint.
- **Interop.** It is the lingua franca for binary in JS — what `postMessage`, WASM memory views and network responses already give you, without a copy or a re-view.
- **Byte order.** Reinterpreting wider typed arrays as bytes is platform-endian-dependent; a byte array has one unambiguous meaning across a worker or WASM boundary.
- **Simplicity at the producer.** One byte per voxel is what a thresholded model output looks like anyway, and it spares every tool author the bit-packing convention.

The cost is 8× the memory of a packed bitset — 256 KB rather than 32 KB for a `512×512` patch — and it is paid only transiently, by tools that fire once per click rather than once per pointer-move. Packing it is a straightforward later optimization (§11.2) that touches only the producers and the mask-to-write-set conversion.

#### Two producers, one output

Both families end at the same place, a `VoxelWriteSet` (§4). They differ only in whether getting there can block:

```
RasterizableShape  ──Rasterizer.rasterize (sync)───────▶  VoxelWriteSet
DataDependentShape ──ShapeResolver.resolve (async)─────▶  VoxelWriteSet
```

```ts
interface ShapeResolver {
  /** The only component in the design permitted to await a bucket load. */
  resolve(
    shape: DataDependentShape, ctx: EditContext, signal: AbortSignal,
  ): Promise<VoxelWriteSet>;
}

/** Loading reader, distinct from §5.3's deliberately non-fetching VoxelReader. */
interface LoadingVoxelReader {
  ensureLoaded(address: BucketAddress): Promise<BigUint64Array>;
}
```

Flood fill cannot be rasterized the way a brush can: its region is discovered by walking the data, the walk crosses bucket boundaries, and buckets it reaches may not be loaded, so it must `await`. Putting that in the rasterizer would cost the properties that make the rasterizer worth having — synchronous, pure, side-effect-free, and therefore a Web Worker candidate (§11).

**The resolver produces a write set directly; there is no intermediate shape.** For these tools, resolution and rasterization are the same step — once the walk finishes there is nothing left to convert. A traversal naturally works bucket by bucket (load a bucket, mark voxels, move on), which is exactly the shape of a `VoxelWriteSet`, so it can write into one as it goes:

```ts
async function resolveFloodFill(shape, ctx, reader, signal): Promise<VoxelWriteSet> {
  const out = new WriteSetBuilder(ctx.sourceMagIndex, ctx);
  const seedValue = (await reader.ensureLoaded(bucketOf(shape.seed)))[indexOf(shape.seed)];
  const queue = [shape.seed];

  while (queue.length > 0) {
    signal.throwIfAborted();
    const v = queue.pop();
    if (!inBounds(v, shape.bounds)) continue;
    const data = await reader.ensureLoaded(bucketOf(v));       // the only await
    if (data[indexOf(v)] !== seedValue) continue;
    if (out.has(v)) continue;                                  // visited check
    out.mark(v, ctx.activeSegmentId);
    queue.push(...neighbours(v, shape.is3D));
  }
  return out.build();
}
```

Note `out.has(v)` doubles as the **visited** set. A flood fill only enqueues voxels matching the seed value, so visited and painted coincide, and the write set *is* the traversal state — no second allocation.

**Why not resolve to a dense `MaskShape` first.** Because a fill with `bounds: null` has no known extent, so a dense box-shaped mask would mean either allocating the worst case up front (unbounded — the layer's maximum extent), computing the bbox by walking twice, or reallocating as the frontier grows. All of that to then convert into per-bucket masks, which is what `VoxelWriteSet` already is. Per-bucket `VoxelMask`s allocate 4 KB only for buckets actually touched, which is also what production does today.

That overhead is negligible in context: 4 KB of mask against the 256 KB of bucket data the fill had to load in order to visit that bucket at all — about 1.5%. The data is the real cost, which is why bounding a fill is still an open question (§10) and not something this structure solves.

**The transaction opens after resolution, not before.** A flood fill click resolves first — potentially over hundreds of milliseconds and many fetches — and only then opens a `VolumeTransaction`, hands it the finished write set via `recordAll`, propagates and commits, all synchronously. This keeps an invariant worth having: **a transaction never spans an `await`.** Sequence numbers stay meaningful, no other transaction can interleave with a half-built one, and the commit path is the same for every tool.

The cost is that a long resolution can be based on data that changed underneath it — a collaborator's edit landing mid-walk yields a region computed against a mix of old and new state. Passing an `AbortSignal` lets the UI cancel a resolution that has been overtaken; making the result *transactionally* consistent would require snapshot isolation over the fetch set, which is well beyond what this buys.

`sliceInterpolation` resolves the same way, reading the two reference sections and synthesizing masks for the intermediate ones. Quick-select and ML tools skip resolution entirely by emitting `mask` directly.

Note this leaves §10's flood-fill open question exactly where it was: resolution makes the *awaiting* well-structured, but it does not answer how many buckets a fill may pull in, or what to show while it does.

### 5.2 `VolumeTransaction` — the write set

One transaction per user interaction. It is a write recorder, not a snapshot differ.

```ts
/**
 * Bucket-scoped write cursor. Obtained once per (bucket, value), then written
 * to in a tight loop. Nothing in here computes a bucket address or a BucketKey:
 * that work happened once, in `writerFor`.
 */
interface BucketWriter {
  mark(index: VoxelIndex): void;
  /** The hot path. Runs are runs along x (see VoxelIndex), i.e. scanlines. */
  markRun(start: VoxelIndex, length: number): void;
  /** Dense current content, if resident. Read once, then index directly —
   *  this is how the overwrite predicate avoids a global lookup per voxel. */
  readonly current: BigUint64Array | undefined;
}

class VolumeTransaction {
  readonly id: TransactionId;
  readonly ctx: EditContext;

  private writes = new Map<BucketKey, { address: BucketAddress; writes: BucketWrites }>();

  /** Pre-transaction values, recorded on first touch — only for resident buckets. */
  private beforeAccumulating = new Map<BucketKey, Map<VoxelIndex, SegmentId>>();

  /**
   * Open a write cursor for one bucket. Does NOT require the bucket to be
   * resident (principle 4). Resident buckets are also written through to the
   * live array so the GPU picks the change up on the next texture update.
   */
  writerFor(address: BucketAddress, value: SegmentId): BucketWriter;

  /** Merge a whole VoxelWriteSet (from mag propagation, or a remote peer). */
  recordAll(writeSet: VoxelWriteSet): void;

  /** Finalize: run mag propagation, drop no-ops, build the diff. */
  commit(propagation: MagPropagationService): TransactionDiff;

  /** Restore every touched resident bucket from `beforeAccumulating`. */
  abort(): void;
}
```

**The API is bucket-scoped on purpose, independently of how `BucketWrites` is represented.** A per-voxel `record(address, index, value)` would be the more obvious signature, but it pushes address-to-key computation into every rasterizer inner loop, and it shapes all calling code into a per-voxel style — so changing the representation later would become a call-site migration across every tool rather than a swap behind an interface. `writerFor` + `markRun` costs nothing extra today and keeps the mask, a sparse list, or a slice-oriented buffer interchangeable.

Why a write set at all, rather than "snapshot the bucket, mutate freely, diff at the end":

- Repeated writes to the same voxel during a stroke coalesce for free — a brush passing over the same voxel 40 times sets the same bit 40 times.
- It works for non-resident buckets, which snapshot-and-diff cannot: there is nothing to snapshot.
- Its cost is bounded by *touched buckets* × 4 KB, not by touched buckets × 256 KB, and it never materializes a bucket that was not already resident.

**`beforeAccumulating` and `beforeCommitted` are the same information at two lifecycle stages**, mirroring the write side exactly:

| | accumulating (live, in the transaction) | committed (frozen, on the diff) |
|---|---|---|
| new values | `BucketWrites` — mask + one value | `BucketDiff.runs` |
| old values | `beforeAccumulating` — `Map<VoxelIndex, SegmentId>` | `BucketDiff.beforeCommitted` — `VoxelRun[]` |

The shapes differ because the stages have different access patterns. While the stroke is open, values are recorded lazily on first touch of each voxel and arrive in whatever order the brush wanders, so the accumulator needs O(1) "have I already recorded this one?" checks — a `Map`. At commit the same run-grouping pass that builds `runs` freezes it into `beforeCommitted`, which from then on is only iterated in order.

The rows differ from each other because new values are single-valued and compress to mask-plus-value, whereas old values are arbitrary (`3, 5, 0`, …) and need one per voxel. That is the sole reason `VoxelRun.values` has a `BigUint64Array` arm.

Both are populated only for resident buckets, and **neither is required for correctness** — forward replay never reads them (§5.7). `beforeAccumulating` exists so `abort()` is cheap; `beforeCommitted` exists so the common case of undoing your most recent action can skip a checkpoint replay.

**Cancel is not free, but it is cheap.** Because we do apply writes live (the user must see the stroke), cancelling means restoring the touched voxels from `beforeAccumulating`, not "throwing away an untouched buffer". That is O(number of written voxels), which is fine.

### 5.3 Rasterizer

The single place that turns geometry into voxel indices.

```ts
/** Read-only view over the cube; keeps the rasterizer decoupled from storage. */
interface VoxelReader {
  /** Dense content of a resident bucket. Fetch once per bucket, then index
   *  directly — never call this per voxel. Returns undefined for `absent` AND
   *  for `pending` buckets (§1.1): a zero-filled placeholder must never be
   *  mistaken for "all background". Never triggers a fetch. */
  getResident(address: BucketAddress): BigUint64Array | undefined;
}
// One method, deliberately. Per-voxel random access lived here for flood fill's
// neighbour walk; that moved to the ShapeResolver (§5.1), which needs an async
// loading reader instead. Nothing left in the rasterizer reads outside the
// bucket it is currently writing.

interface Rasterizer {
  /**
   * Rasterize `shape` at ctx.sourceMagIndex, writing through `tx`. Always the
   * source mag — never called a second time for another mag (see §5.4).
   */
  rasterize(shape: RasterizableShape, ctx: EditContext, tx: VolumeTransaction): void;
}
```

Responsibilities, in order:

1. Compute the candidate region: the shape's bounding box at the source mag, clipped against `ctx.editableBoundingBox` and the layer bounding box, then **split by bucket**.
2. Per bucket, scanline the shape: for each row, produce the x-intervals it covers (a single interval for convex shapes, several for a polygon).
3. Apply the **overwrite predicate**, which splits an interval into sub-intervals.

The bucket split comes first, and that ordering is the whole point: bucket address, `BucketKey` and the writer are resolved once per bucket, and the inner loop touches nothing but integers and a `Uint32Array`.

```ts
function rasterizeBrush(
  shape: Extract<AnalyticShape, { kind: "brush" }>,
  ctx: EditContext,
  tx: VolumeTransaction,
): void {
  for (const [a, b] of consecutivePairs(shape.path)) {
    // Capsule: everything within `radius` of the segment a→b, in source-mag space.
    const bbox = capsuleBoundingBox(a, b, shape.radius).clipTo(ctx.editableBoundingBox);

    for (const { address, localBox } of bucketsIntersecting(bbox, ctx)) {
      const w = tx.writerFor(address, ctx.activeSegmentId);   // once per bucket

      for (const { y, z } of rowsOf(localBox, shape.planeAxis)) {
        const rowStart = y * BUCKET_WIDTH + z * BUCKET_WIDTH ** 2;  // x === 0

        for (const [x0, x1] of capsuleRowSpans(a, b, shape.radius, y, z, localBox)) {
          emitSpan(w, rowStart + x0, x1 - x0 + 1, ctx);
        }
      }
    }
  }
}

/** Applies the overwrite predicate to a contiguous span, emitting sub-runs. */
function emitSpan(w: BucketWriter, start: VoxelIndex, length: number, ctx: EditContext): void {
  if (ctx.overwriteMode === "overwrite-all") {
    w.markRun(start, length);              // fast path: word-wise fill, no reads
    return;
  }
  const current = w.current;
  if (current == null) {
    // Absent or pending (§1.1): no authoritative content to test against.
    // Paint optimistically — overwrite mode protects what is visible, and an
    // unloaded bucket renders as background. See §5.4.
    w.markRun(start, length);
    return;
  }
  let runStart = -1;
  for (let i = start; i < start + length; i++) {
    if (current[i] === 0n) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      w.markRun(runStart, i - runStart);
      runStart = -1;
    }
  }
  if (runStart >= 0) w.markRun(runStart, start + length - runStart);
}
```

Three things this buys over the per-voxel formulation. The overwrite predicate reads `current[i]` — a direct typed-array index — instead of resolving a global coordinate to a bucket on every voxel. `overwrite-all`, the common mode, does no reads at all and fills whole words. And a solid interior row costs one `markRun` regardless of its length, which is what makes the block fills of §5.4's upsample cheap.

**The rasterizer runs exactly once per transaction, at the source mag.** Every other mag's content is derived by §5.4, never by re-rasterizing the same geometry at a different resolution. Rasterizing independently per mag would (a) cost N× and (b) produce boundary disagreements — a circle rasterized at mag 1 and a circle rasterized at mag 2 do not agree about their edges, so the pyramid would be internally inconsistent in a way no downsampling rule could repair.

Erasing is not a special case: it is a rasterization with `activeSegmentId = 0n` and `overwriteMode = "overwrite-all"`.

### 5.4 `MagPropagationService`

Three terms, used consistently from here on:

- **Propagation** — the umbrella process: everything this service does, both directions together.
- **Upsample** (Step A) — walk from the source mag toward the finest, one level at a time, emitting a write set at each. Increases resolution, so one voxel becomes a block. One-to-many; no conflicts possible.
- **Downsample** (Step B) — walk from the source mag toward the coarsest, one level at a time, emitting a write set at each. Decreases resolution, so many voxels collapse onto one. Many-to-one, which means a rule is needed to decide which value survives.

Both walks start at the **source mag** — the mag the user drew in — and move outward through *adjacent* mags. Between neighbours the factor is small (typically 2 per axis), and every mag in the list is visited exactly once: those finer than the source by Step A, those coarser by Step B.

Note these are the same terms, in the same directions, as `upsampleVoxelMap` / `downsampleVoxelMap` in today's `volume_annotation_sampling.ts`. Beware that they run *opposite* to mag index: upsampling moves toward mag 1, downsampling away from it. Sampling direction is stated in terms of resolution throughout this doc, never in terms of "up" or "down" the mag list.

```ts
interface MagPropagationService {
  /**
   * Source mag → every other mag, walking the pyramid outward in both
   * directions. Pure; reads no voxel data. Requires the mag list to be a
   * chain (§1.2).
   */
  propagate(
    sourceWrites: VoxelWriteSet, ctx: EditContext,
  ): Map<MagIndex, VoxelWriteSet>;
}

// Sketch of the walk. `relativeFactor(a, b)` is the per-axis ratio between
// two adjacent mags — normally [2,2,1] or [2,2,2], never the ratio to mag 1.
function propagate(sourceWrites: VoxelWriteSet, ctx: EditContext) {
  const out = new Map([[ctx.sourceMagIndex, sourceWrites]]);

  let writes = sourceWrites;                                   // Step A: finer
  for (let i = ctx.sourceMagIndex; i > FINEST_MAG_INDEX; i--) {
    writes = upsampleOneLevel(writes, relativeFactor(mags[i], mags[i - 1]), i - 1, ctx);
    out.set(i - 1, writes);
  }

  writes = sourceWrites;                                       // Step B: coarser
  for (let i = ctx.sourceMagIndex; i < mags.length - 1; i++) {
    writes = downsampleOneLevel(writes, relativeFactor(mags[i], mags[i + 1]), i + 1, ctx);
    out.set(i + 1, writes);
  }
  return out;
}
```

**Why cascade rather than deriving every mag from the finest one.** A hub model — upsample straight to the finest mag, then downsample from there into every other mag — produces *identical* results, because the writes are single-valued (§4) and block replication composes: a mag-4 voxel `q=3` upsampled directly to mag 1 gives the block `[12,16)`, and `⌊12/8⌋ = ⌊15/8⌋ = 1` is the same mag-8 voxel that `⌊3/2⌋` gives by cascading. The cascade is preferred because it is cheaper and more obvious, not because the hub is wrong.

Cheaper because each step works from the nearest, smallest write set rather than from the largest one. Drawing at mag 16, a hub model would derive mag 32 by iterating the 260 K-run finest-mag set; cascading derives it from the ~2000-voxel mag-16 set. For mag-1 strokes the two are identical, since source *is* finest.

The cascade's one requirement is that adjacent mags divide each other, i.e. that the mag list forms a chain. That is a declared non-requirement to violate (§1.2). It also depends on transactions being single-valued: with multi-valued writes, collapsing in stages and collapsing once could disagree, so the equivalence above would no longer hold.

#### Step A — upsample toward the finest mag

A voxel `q` at one level covers the axis-aligned block `[q · f, (q+1) · f)` at the next finer level, where `f` is the *relative* factor between the two adjacent mags. Replicate the value across the block:

```ts
function upsampleOneLevel(
  writes: VoxelWriteSet, f: Mag, targetMagIndex: MagIndex, ctx: EditContext,
): VoxelWriteSet {
  const out = new WriteSetBuilder(targetMagIndex, ctx);

  for (const { address, writes: bw } of writes.values()) {
    const origin = originVoxelOf(address);                   // this level's grid
    for (const { start, length, value } of runsOf(bw)) {
      const [x, y, z] = voxelOffsetOf(start);
      const base: Vector3 = [
        (origin[0] + x) * f[0], (origin[1] + y) * f[1], (origin[2] + z) * f[2],
      ];
      // A run of `length` voxels becomes a solid block, emitted as one run of
      // `length * f[0]` per (dy, dz) — not length * f[0]*f[1]*f[2] writes.
      for (let dz = 0; dz < f[2]; dz++)
        for (let dy = 0; dy < f[1]; dy++)
          out.markRun([base[0], base[1] + dy, base[2] + dz], length * f[0], value);
    }
  }
  return out.build();
}
```

This needs no reads and no bucket loads, and it is exact: drawing at a coarse mag *means* producing blocky finest-mag geometry. That is the accepted cost of annotating at low resolution.

Note the loop nest is over `f[1] * f[2]`, not `f[0] * f[1] * f[2] * length` — the x extent is handled by `markRun`. Compounded across the chain, that is the difference between ~300 K run emissions and ~9.25 M individual writes for the mag-16 case below.

**Overwrite mode is evaluated against what the user can see, and nothing else.** The predicate runs once, in §5.3, against resident source-mag data. Two consequences follow from the same principle, and both are deliberate:

- *Finer detail is not protected.* The upsample writes unconditionally, so in `overwrite-empty-only` at mag 4, a coarse voxel that reads as empty may still contain labeled finest-mag voxels, and those get overwritten. Re-evaluating the predicate per finest-mag voxel would require those buckets to be resident — turning every coarse-mag stroke into hundreds of fetches.
- *Not-yet-loaded data is not protected.* Where the source-mag bucket is `absent` or `pending`, there is no authoritative content to test, and `emitSpan` paints optimistically rather than skipping the span.

The unifying rule is that `overwrite-empty-only` protects what is *visible*, not what exists. Data hidden inside a coarse voxel and data that has not arrived yet are both invisible to the user, and in the second case the viewport is literally rendering background — so painting is what the user sees themselves doing. Failing the other way, skipping unloaded spans, would punch holes into a stroke over a region that looks empty, contradicting the display for the sake of a guarantee the mode never made.

The honest cost is a timing race: the same stroke over the same region gives different results depending on whether the fetch had landed. The window is small, because source-mag buckets are by definition the ones on screen and therefore already being fetched, but it is real. Mitigation belongs in the UI — indicate that a region is still loading — rather than in the editing path, where the alternatives are stalling the brush or deferring the transaction's outcome until the network responds.

**Write amplification is the thing to watch here.** At mag `16-16-16`, each source voxel expands to 4096 finest-mag voxels. The figures below are measured from the prototype in `frontend/javascripts/prototypes/new_volume_architecture`, for a radius-25 dab at mag 16 over an isotropic `1,2,4,8,16` pyramid — 1976 source voxels:

| | finest mag | all mags |
|---|---|---|
| voxels written | 8.09 M | 9.25 M |
| buckets touched | 524 | 736 |
| runs emitted | 260 K | 300 K |
| encoded diff | 1.0 MB | 1.2 MB |

Three things keep that affordable:

- Those buckets are not materialized as `32³` typed arrays, which would be ~134 MB at the finest mag alone. Per principle 4 writes are recorded against bucket addresses whether or not the bucket is resident, and per §4 a touched bucket costs a 4 KB mask — 2.9 MB across all mags.
- The work is `markRun` calls rather than per-voxel writes: each fills one scanline of a block, so the count scales with runs (300 K) not voxels (9.25 M).
- The diff run-length-encodes well, though not as well as a naive estimate suggests: a disk is mostly bucket-*edge* rather than solid interior, so the finest mag averages ~2 KB per bucket rather than the ~1 KB a fully solid block fill would cost.

Non-resident buckets are never loaded just to be written; when they are later fetched, the backend has already folded the diff in, and any not-yet-saved local diffs are applied on load.

#### Step B — downsample toward the coarsest mag

At each step, a voxel `p` belongs to coarse voxel `⌊p / f⌋` at the next coarser level, where `f` is again the relative factor between adjacent mags. Many voxels collapse into one, so a rule is needed:

```ts
/**
 * Written-value-wins: a written voxel sets its coarse voxel to that value.
 * Background (0n) is not special — it is just another segment ID.
 *
 * Run-oriented like the rasterizer: a run along x downsamples to a run along
 * x, so the whole pyramid is built without ever visiting an individual voxel.
 */
function downsampleOneLevel(
  writes: VoxelWriteSet, f: Mag, targetMagIndex: MagIndex, ctx: EditContext,
): VoxelWriteSet {
  const out = new WriteSetBuilder(targetMagIndex, ctx);

  for (const { address, writes: bw } of writes.values()) {
    const origin = originVoxelOf(address);                   // this level's grid
    for (const { start, length, value } of runsOf(bw)) {
      const [x, y, z] = voxelOffsetOf(start);
      const cy = Math.floor((origin[1] + y) / f[1]);
      const cz = Math.floor((origin[2] + z) / f[2]);
      const cx0 = Math.floor((origin[0] + x) / f[0]);
      const cx1 = Math.floor((origin[0] + x + length - 1) / f[0]);
      out.markRun([cx0, cy, cz], cx1 - cx0 + 1, value);      // may span buckets
    }
  }
  return out.build();
}
```

`WriteSetBuilder` is the propagation-side counterpart of `BucketWriter`: it caches the current bucket and only re-resolves the address when a run crosses a bucket boundary.

Three things about this rule are worth stating explicitly, because they are choices, not consequences:

- **Background is not a special value.** Erasing is painting with `0n`, and it downsamples like any other value: one erased finest-mag voxel clears its whole coarse voxel. The tempting alternative — "only clear the coarse voxel if *all* its finest-mag siblings are now background" — is more faithful but needs a read of every sibling, which drags bucket residency back into a step that otherwise needs no data at all. Not worth it for a display-only approximation. This is also what webKnossos does today (`downsampleVoxelMap` any-hits a 0/1 *mask*, and `applyVoxelMap` then writes the segment ID — zero included — into every masked voxel at every mag).
- **The downsampling rule is written-value-wins, and it dilates in both directions.** Paint overstates presence at coarse mags; erase overstates absence. Majority vote — the textbook rule, and what "downsampling" might otherwise be assumed to mean here — would instead make thin structures disappear entirely — a 1-voxel-wide process annotated at mag 1 would be invisible the moment the user zooms out, which is unacceptable for tracing work. The upside of written-value-wins is predictability: whatever you just did is visible at every zoom level.
- **We propagate the write set, not the bucket.** The natural-sounding alternative — "recompute each affected coarse bucket from its finest-mag children" — is infeasible: a mag-16 bucket covers `512³` finest-mag voxels, i.e. `16·16·16 = 4096` finest-mag buckets. (The child count is the product of the per-axis ratio — a `2-2-1` bucket has 4 children, a `16-16-16` bucket has 4096.) Propagating the write set touches only the voxels the user actually edited and requires no additional loads.

Because background is not special, **mag propagation reads no data whatsoever** — it is a pure function of `(writeSet, magList)`. That is why `propagate` above takes no `VoxelReader`, and it is what makes principle 4 hold end-to-end: no step between pointer input and diff can be forced to load a bucket.

If the layer's finest mag is not mag 1 (some datasets start coarser), "finest mag" means index 0 throughout — nothing else changes.

#### What is authoritative

**Every mag's diffs go into the log and are replayed identically.** There is no distinction between "authored" and "derived" entries at replay time: a coarse bucket's content is the fold of its own log, exactly like a finest-mag bucket's.

The tempting alternative is to treat only finest-mag diffs as authoritative and, after an undo, re-downsample the affected coarse buckets from the rebuilt finest-mag content. Don't. It is worse in four ways:

- It needs a rule that does not exist. Written-value-wins is defined over a *sequence of writes*; re-deriving from static content is a downsample, which needs some other rule (majority, any-non-zero, …) that nothing else in this design specifies.
- It requires the finest-mag buckets to be resident, so undoing from a history panel after panning away would have to fetch them.
- It breaks convergence under collaboration: a client that re-downsamples and a client that replays compute different coarse content from the same history.
- It is the only thing that would ever need a multi-valued write set, since the rebuilt content carries arbitrary prior values (§4).

Replaying is also the more principled choice. Folding a coarse log with one entry skipped does not equal re-downsampling the finest mag afterwards — but principle 2 already declares that equality a non-goal. Coarse mags *are* the downsampled write sequence, and skipping one entry of that sequence yields exactly what the rule prescribes.

**All mags' diffs are sent to the backend, which applies them verbatim per mag and never resamples.** This is the same division of labour as today, where `updateBucket` ships per-mag bucket data and the backend stores what it is given; only the payload changes from a whole bucket to a diff.

The alternative — send only finest-mag diffs and let the backend derive the coarser mags — is tempting for payload size but does not actually work here, and the reason is worth spelling out because it constrains the downsampling rule:

- Written-value-wins is **order-dependent**: it is a function of the sequence of writes, not of the final voxel data.
- A backend deriving coarse mags from stored finest-mag data only ever sees final state, so it cannot reproduce an order-dependent rule under *any* choice of derivation rule.
- The result would be coarse mags that visibly change on reload.

So the downsampling rule and the save strategy are coupled: a simple order-dependent rule requires sending all mags; a data-derivable rule (majority vote, any-non-zero, …) would permit finest-mag-only payloads but drags back the per-voxel sibling reads this design just removed, and pins client and server to an identical rule forever.

Sending all mags is cheap. Coarse-mag diffs shrink geometrically with the pyramid, so the total is roughly `1.15×` the finest-mag diff for a 3D stroke and `~1.33×` for a thin/2D one — a small price for eliminating drift by construction and for asking the backend only to fold diffs (which requirement 3 needs regardless) rather than to fold *and* derive.

### 5.5 `WorkingDataCube`

Unchanged in spirit from today: one `32³` typed array per materialized `(bucketPosition, magIndex, additionalCoordinates)`, lazily fetched, evicted under memory pressure, feeding GPU textures directly.

```ts
interface WorkingDataCube extends VoxelReader {
  // getResident is inherited from VoxelReader and never triggers a fetch;
  // ShapeResolver's loading reads go through a separate path (§5.1).
  state(address: BucketAddress): "absent" | "pending" | "resident";   // §1.1
  /** Allocates a zero-filled array (absent → pending) and starts a fetch.
   *  Called on write only when the bucket is visible or about to be. */
  materialize(address: BucketAddress): void;
  /** Applies a whole bucket's writes at once, walking the mask's runs. */
  applyWrites(address: BucketAddress, writes: BucketWrites): void;
  markDirtyForGpu(address: BucketAddress): void;
}
```

Three constraints the new model adds:

- **Eviction must respect unsaved state.** A bucket with unsaved diffs, or whose diff log is still needed by the undo horizon, cannot simply be dropped. Either keep it, or persist its log (checkpoint + entries) alongside the eviction — the log, not the array, is the thing that must survive.
- **Load must fold local diffs, and the journal owns that fold.** See below.
- **Materialization is a rendering decision, not a writing one.** Writes never force it (principle 4). The cube materializes a bucket because something needs to *display* it — which is why a mag-16 stroke leaves its ~520 finest-mag buckets `absent` while the mag-16 buckets on screen become `resident`.

#### When a fetched bucket arrives

The cube does not merge anything itself. Principle 3 says the journal holds the truth and the array is a materialized fold of it, so the journal performs the fold and the cube installs the result:

```ts
// WorkingDataCube, on the fetch completing
receiveData(address: BucketAddress, backendData: BigUint64Array, dataVersion: number) {
  const folded = journal.foldOntoFetched(address, backendData, dataVersion);
  this.install(address, folded);        // pending → resident
  this.markDirtyForGpu(address);
}
```

Note what this does *not* do: it does not try to reconcile the zero-filled placeholder that a `pending` bucket was carrying. The fetched data replaces the array outright and the journal's entries are re-folded on top. Merging two partially-written arrays would be both harder and wrong; re-folding from a known base is neither. Today's `mergeDataWithBackendDataInPlace` works the same way — `set(backendData)` first, then replay `pendingOperations`.

**Which entries get folded is the part that needs care.** "All of this bucket's entries" is the obvious answer and it is wrong. Fold only those the fetched data does not already contain:

```ts
foldOntoFetched(address, backendData, dataVersion) {
  const data = backendData.slice();
  for (const entry of this.logFor(address).entries) {
    if (entry.skipped) continue;
    // Unsaved, or saved after the server produced this data.
    if (entry.acknowledgedAtVersion != null && entry.acknowledgedAtVersion <= dataVersion) continue;
    for (const run of entry.runs) applyRun(data, run);
  }
  return data;
}
```

For a single client, folding everything would happen to be harmless: the entries are absolute writes replayed in sequence order, so re-applying them idempotently reproduces the same result. It breaks as soon as a second writer exists. Suppose our `T1` sets voxel `p = 5`, a collaborator's later `T2` sets `p = 7`, and we never received `T2`. The fetched data correctly reads `p = 7`; blindly replaying our `T1` on top rewrites it to `5`, resurrecting a superseded write. Version-gating avoids this because `T1` is already contained in the fetched data and is therefore skipped.

This also means the fetch response must carry the version its data reflects, and `BucketLogEntry` gains an `acknowledgedAtVersion` — set when the save queue receives the ack, `null` while the entry is still unsaved (§5.7).

### 5.6 Diff types

```ts
/** A run of consecutive voxel indices. `values` is a single SegmentId when the
 *  run is constant (the common case for painting), otherwise one per voxel. */
interface VoxelRun {
  start: VoxelIndex;
  length: number;
  /** A single SegmentId for a constant run — which is every run a transaction
   *  produces, since transactions are single-valued (§4). The per-voxel array
   *  is reached for only by `beforeCommitted`, which holds prior values. */
  values: SegmentId | BigUint64Array;
}

interface BucketDiff {
  address: BucketAddress;
  runs: VoxelRun[];
  /** Pre-transaction values, if known. Optional — see §5.7. */
  beforeCommitted?: VoxelRun[];
}

interface TransactionDiff {
  id: TransactionId;
  layerId: string;
  /** Monotonic per client. Becomes the merge key in collaborative mode (§8). */
  sequence: number;
  timestamp: number;
  toolName: string;                       // diagnostics only, not load-bearing
  /** The mag the user authored at; every other mag's diffs are resampled from it. */
  sourceMagIndex: MagIndex;               // diagnostics only, not load-bearing
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

Building the diff from the write set falls out of the representation — a word scan over the mask, with no sort and no per-voxel value lookup:

```ts
function toRuns(writes: BucketWrites): VoxelRun[] {
  // VoxelMask.runs() walks 1024 words, emitting per-row spans of set bits.
  return [...writes.mask.runs()].map(({ start, length }) => ({
    start, length, values: writes.value,            // constant run: one value
  }));
}
```

No-op writes (`newValue === oldValue`, knowable for resident buckets) are dropped before this step, so a stroke that repaints voxels already carrying the active segment ID produces no diff at all for those voxels.

### 5.7 `BucketJournal` — undo/redo and the per-bucket log

Requirement: per-transaction undo that does not discard edits that happened afterwards — which rules out "restore the bucket snapshot from before the transaction".

**Model: a per-bucket ordered event log, not a global stack of inverses.**

```ts
interface BucketLogEntry {
  sequence: number;
  transactionId: TransactionId;
  runs: VoxelRun[];
  skipped: boolean;              // set by undo, cleared by redo
  /** Server version this entry was acked at; null while unsaved (§5.5). */
  acknowledgedAtVersion: number | null;
}

interface BucketLog {
  /** Folded content at `checkpoint.sequence`; bounds how far replay must go. */
  checkpoint: { sequence: number; data: BigUint64Array } | null;
  entries: BucketLogEntry[];     // ascending by sequence
}

/**
 * Owns the per-bucket logs. Despite the undo/redo methods this is not an
 * undo-specific structure — it is where bucket content is *defined*
 * (principle 3), with three consumers:
 *   1. undo/redo      — fold with an entry skipped        (§5.7)
 *   2. load           — fold onto freshly fetched data    (§5.5)
 *   3. save           — hand entries to the queue, record acks (§5.8)
 */
interface BucketJournal {
  append(diff: TransactionDiff): void;
  undo(id: TransactionId): void;
  redo(id: TransactionId): void;
  foldOntoFetched(
    address: BucketAddress, backendData: BigUint64Array, dataVersion: number,
  ): BigUint64Array;
}
```

The two folds differ only in their base. Undo starts from a local checkpoint and replays every non-skipped entry after it; load starts from freshly fetched backend data and replays only entries that data does not already contain. Same loop, same `applyRun`, different starting point and filter.

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

"Each bucket log it touched" includes the coarse-mag buckets, which replay exactly like the finest-mag ones (§5.4). Nothing is re-downsampled and no voxel data is read, so undo works whether or not the affected buckets are resident. `sideEffects` are reverted through the normal update-action mechanism.

**`beforeCommitted` is not what makes forward-only undo work** — forward replay never reads it. It is optional, and worth keeping for three narrower reasons:

1. **Fast-path undo.** If T is the newest transaction touching a bucket, undo is just "write `beforeCommitted` back", which is O(voxels changed) instead of a checkpoint replay. This is the overwhelmingly common case in single-user editing, so the fast path carries almost all real traffic.
2. **`abort()`** (Escape during a stroke) uses them.
3. **Conflict detection** later: comparing a remote diff's `beforeCommitted` against local state reveals concurrent edits to the same voxels, which is what a merge policy needs.

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
    /** The binary run encoding below. Stays binary in memory; it is base64'd
     *  only when serialized, and only because the update stream is JSON. */
    runs: Uint8Array;
  };
}

/**
 * Binary run encoding for UpdateBucketDiffAction.runs.
 * Little-endian. Every run in a bucket carries the same
 * value — transactions are single-valued (§4), and `beforeCommitted` is never
 * sent — so the value is hoisted into the header and a run is just 4 bytes:
 *
 *   uint64  value             // the segment ID this transaction writes
 *   uint32  runCount
 *   repeat runCount times:
 *     uint16  startIndex      // flat voxel index in the 32³ bucket (< 32768)
 *     uint16  length          // <= 32: runs never cross an x-row (§4)
 *
 * Encoded and decoded through a DataView: the field widths are mixed, and
 * DataView takes an explicit `littleEndian` argument, so the format does not
 * silently inherit the platform's byte order the way a typed-array view would.
 */

/**
 * Undo is transmitted as a marker, not as data. The backend already holds T's
 * diff and everything after it, so it can re-fold on its own.
 */
interface UndoTransactionAction {
  name: "undoTransaction" | "redoTransaction";
  value: { actionTracingId: string; transactionId: TransactionId };
}
```

**Why undo is a marker and not a compensating diff.** The obvious alternative is to emit a normal forward transaction that restores the old values. It fails on two counts. It needs absolute prior values for every touched bucket — but undoing a mag-16 stroke means ~520 finest-mag buckets that were never resident and for which the client has no baseline, so it would have to fetch them all just to describe the undo. And those restored values are arbitrary and multi-valued, which is the one thing that would force a multi-valued write set back into §4.

A marker has neither problem: it is O(1) regardless of how many buckets T touched, and a collaborator receiving it performs the identical skip-and-refold, so client, peer and server stay in agreement by construction.

The update stream stays append-only — an undo appends a marker, it does not rewrite history. "Version N" still means "fold the first N actions", with the fold honouring whatever skip markers appear among them. Redo appends a second marker; for a given transaction, the last marker wins.

Encoding notes:

**Why runs, specifically.** Worth writing down, because the obvious justification is the wrong one and the alternatives are better than they first look.

*Not* for the compression ratio. The transport is compressed anyway, and gzip is excellent at exactly the shape run records have — near-identical structs with starts in arithmetic progression. Any argument for runs that rests on pre-compression byte counts is an argument against a straw man.

The real comparison is against three specific alternatives:

- **A dense `32³` array of segment IDs, gzipped.** This is the one runs clearly beat, and the reason is materialization, not size: producing it means allocating 256 KB per touched bucket, including the ~520 non-resident finest-mag buckets a mag-16 stroke writes to (§5.4). That is ~134 MB to describe one stroke, and it breaks principle 4 outright.
- **A `32³` *bitmask* plus one value, gzipped.** This one is genuinely competitive and does *not* require materialization — the mask is 4 KB, we already build one (§4), and a sparse mask gzips down to very little. The trade is fixed versus proportional cost: a bucket the stroke merely grazes costs 5 runs (20 B) but a full 4 KB mask, while a densely-written bucket costs a fixed 4 KB as a mask but up to 8 KB as runs. So neither wins universally — which is precisely why the box/bitmask payload is kept on the table in §11.1 rather than dismissed.
- **Compressing the in-memory representation.** Also viable, and not hypothetical: `frontend/javascripts/viewer/model/bucket_data_handling/bucket_snapshot.ts` does exactly this today, gzipping bucket clones for undo snapshots. The cost is not CPU but **asynchrony** — encode and decode become promises, and that file's comments document the resulting race conditions and redundant-compression caveats. Runs are small enough to keep uncompressed, so `rebuild` (§5.7) stays a tight synchronous fold and log entries stay directly inspectable.

What is left, once the size argument is discarded, is narrow but solid: runs are the rasterizer's **native output** (it emits scanline spans, so no conversion step exists in either direction), they need no materialization, they stay synchronous in memory, and both client and backend **apply them as range writes** rather than decompressing a blob and scattering per voxel.
- **Runs are runs along x**, because the flat index is `x + y·32 + z·1024`. XY and XZ strokes both scan along x and encode well. A YZ stroke (x constant) is the one bad case: y steps by 32 and z by 1024, so every run degenerates to length 1 — a radius-10 disk becomes ~314 runs instead of ~20. See §11 if that turns out to matter.
- **Block fills encode compactly**, which is part of what makes coarse-mag editing viable: the upsample of one mag-16 voxel into a finest-mag bucket is a solid `16×16×16` block, i.e. 256 runs of length 16 — about 1 KB against 256 KB for the full bucket. Note runs cannot merge across rows (§4), so a *fully* written bucket costs 1024 runs (4 KB) rather than one; §11.1 is the lever if that ever matters.
- **base64 is a transport artifact, not part of the format.** `runs` is a `Uint8Array` everywhere it is built, stored in the log, and applied. It becomes a string only at the JSON boundary, because the update stream is a heterogeneous array of JSON actions and JSON cannot carry binary. Apply it last, after compression, as `wkstore_adapter.ts` does today (LZ4 in a worker, then base64) — the 33% expansion then lands on an already-compressed payload rather than on the raw bytes. If the update stream ever moves to a binary framing (multipart, CBOR, protobuf), the base64 step disappears and nothing else about the format changes.
- **One action per touched bucket; one versioned group per transaction.** This gives the backend (and later, other clients) the transaction boundary explicitly instead of making it infer grouping from timing.
- **Ordering and idempotency.** Transactions are submitted in `sequence` order and are idempotent on retry, so a reconnect can safely resend the tail of the queue.
- **Backend counterpart.** Two changes are needed. First, accept per-bucket diffs and fold them into the bucket's stored content rather than overwriting wholesale — that is what unlocks multi-user diff composition; without it, two users' concurrent edits to one bucket still resolve as last-writer-wins over the entire bucket. Second, retain the per-bucket diff log and support re-folding it with entries skipped, which is what `undoTransaction` requires. The backend still never resamples and needs no notion of the mag pyramid: diffs arrive for every mag and are applied verbatim to that mag (§5.4).
- **The two horizons are coupled.** The backend's materialization/squashing point must stay at or behind the undo horizon. If T gets folded into a materialized base, it can no longer be skipped and becomes un-undoable. This is the same constraint as local checkpoints in §5.7 — one rule, enforced on both sides.

### 5.9 Sequence: one brush stroke

Pointer-down through pointer-up, showing which component does what and which structure crosses each boundary.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant B as BrushTool
  participant T as VolumeTransaction
  participant R as Rasterizer
  participant C as WorkingDataCube
  participant P as MagPropagationService
  participant L as BucketJournal
  participant S as SaveQueue
  participant K as Backend

  U->>B: pointer-down
  B->>B: freeze EditContext
  Note right of B: sourceMagIndex, activeSegmentId,<br/>overwriteMode, additionalCoordinates,<br/>editableBoundingBox
  B->>T: open(EditContext)
  Note right of B: EditIntent { kind: "brush",<br/>path: [p0], radius, planeAxis }

  loop each pointer-move
    U->>B: pointer-move(pN)
    B->>B: path.push(pN)
    B->>R: rasterize(capsule prev→pN, ctx, tx)
    Note over R: clip to bbox, split by bucket
    loop each intersecting bucket
      R->>T: writerFor(address, activeSegmentId)
      T->>C: getResident(address)
      C-->>T: BigUint64Array, or undefined if absent/pending
      T-->>R: BucketWriter
      opt overwrite-empty-only AND resident
        R->>R: split each scanline where current[i] is not 0n
      end
      R->>T: markRun(start, length) per scanline
      Note over T: VoxelMask bit-fill,<br/>4 KB per touched bucket
      T->>C: applyWrites(address, BucketWrites)
      C->>C: markDirtyForGpu
    end
    C-->>U: stroke visible at the source mag
  end

  U->>B: pointer-up
  B->>T: commit(propagation)
  T->>P: propagate(sourceWrites, ctx)
  Note over P: Step A: upsample source → finest<br/>Step B: downsample source → coarsest<br/>one adjacent level at a time
  P-->>T: writes per mag (MagIndex to VoxelWriteSet)
  T->>C: applyWrites(...) for resident buckets only
  T->>T: toRuns() per bucket
  Note right of T: TransactionDiff { id, sequence,<br/>sourceMagIndex, bucketDiffs, sideEffects }
  T->>L: append(TransactionDiff)
  T->>S: enqueue(TransactionDiff)
  S->>S: debounce, batch, encode runs, base64
  S->>K: one versioned group of updateBucketDiff actions
```

Two things the diagram makes visible that the prose does not. The `getResident` call returning `undefined` is the *normal* case for a coarse-mag stroke — most touched buckets are `absent` (§1.1), the overwrite predicate is skipped for them, and no fetch is triggered. And mag propagation appears exactly once, after pointer-up, not inside the move loop (§6.1).

What crosses each boundary:

| Structure | Produced by | Consumed by | Defined in |
|---|---|---|---|
| `EditContext` | BrushTool, at pointer-down | everything downstream | §4 |
| `EditIntent` | BrushTool, growing per move | Rasterizer | §5.1 |
| `BucketWriter` | VolumeTransaction, one per bucket | Rasterizer's inner loop | §5.2 |
| `BucketWrites` (mask + value) | accumulated in the transaction | cube, `toRuns` | §4 |
| `VoxelWriteSet` | Rasterizer, then propagation | transaction, cube | §4 |
| `TransactionDiff` | `commit()` | BucketJournal, SaveQueue | §5.6 |
| `UpdateBucketDiffAction[]` | SaveQueue encoder | backend | §5.8 |

---

## 6. Worked Examples

### 6.1 Brush stroke at the finest mag

1. **Pointer-down.** `VolumeTransaction` opens with an `EditContext` snapshotting the active segment ID, overwrite mode, source mag and additional coordinates. An empty `brush` intent is created, with the brush radius fixed for the stroke.
2. **Pointer-move.** The tool appends a point to the path. Only the *incremental* capsule (previous point → new point) is rasterized, at the source mag. The rasterizer walks it bucket by bucket, opening one `BucketWriter` per bucket and emitting scanline runs through the overwrite predicate.
3. **Record + display.** Those runs land in the transaction's write set and are written through to resident buckets; their GPU textures are refreshed. The user sees the stroke immediately.
4. Steps 2–3 repeat. Overlapping samples coalesce in the write set at no cost.
5. **Pointer-up → commit.** Mag propagation runs *once*, over the whole accumulated write set. Step A is a no-op — the source mag already *is* the finest — so the walk only goes outward: mag 1 → 2 → 4 → …, each level downsampled from the one before it. Those writes are applied to resident coarse buckets too.
6. The write set becomes a `TransactionDiff` (no-ops dropped, runs grouped), appended to the `BucketJournal` and enqueued for save.

Running mag propagation on *every pointer-move* was considered and discarded: it does strictly more total work, since overlapping samples get re-propagated, for no correctness benefit.

Two costs come with that choice. A second viewport showing a different mag lags until pointer-up. And the propagation work lands as a spike on pointer-up rather than being spread across the stroke, which may read as a hitch even though the total CPU cost is lower.

**Both are tunable without touching the architecture.** Propagation is a pure function `VoxelWriteSet → VoxelWriteSet` applied to the cube, not to the diff, and — because upsampling and written-value-wins are both per-voxel maps — it distributes over the write set: `propagate(A ∪ B) == propagate(A) ∪ propagate(B)`. So running it mid-stroke on a throttle, for visible mags only, produces exactly the same result as running it once at commit. The throttle interval is a free parameter, including "never", which is the default above.

The spike is worst for coarse-mag strokes, and there the throttle is the wrong lever — see §9.

### 6.2 Brush stroke at mag 16

Identical, except at commit:

- Step A walks mag 16 → 8 → 4 → 2 → 1, expanding ~2000 mag-16 voxels into ~8.1 M finest-mag voxels across ~520 finest-mag buckets (the intermediate levels are emitted on the way and are far smaller — 148, 45 and 15 buckets respectively; see §5.4 for the measured breakdown). Almost none of those buckets are resident (the user is zoomed out); no fetches are triggered. Their writes live only as 4 KB masks in the write set, then in the diff, run-encoded as block fills.
- Step B walks the other way from mag 16 — to mag 32, 64, … — each level derived from the small set one step finer, never from the 8.1 M-voxel finest set. The mag-16 buckets the user is looking at were already written by the rasterizer in step 3 and are simply carried through as the walk's starting point, so there is no visible re-flicker.
- The save payload is ~736 `updateBucketDiff` actions totalling ~1.2 MB — not the ~190 MB the same buckets would cost as raw data.

### 6.3 Undo with an intervening transaction

The user paints stroke `T1` (segment 5) over a region, then stroke `T2` (segment 7) partially overlapping it, then presses Ctrl+Z.

- `T2` is the newest transaction on every bucket it touched → **fast path**: write `T2.beforeCommitted` back. Done, O(voxels in T2).
- Had the user instead undone `T1` (via a history panel), the slow path runs: mark `T1`'s entries skipped in each affected bucket log, rebuild from the nearest checkpoint replaying `T2` but not `T1`. Voxels that `T2` painted stay segment 7; voxels only `T1` touched revert to their pre-`T1` value. Under the old snapshot-restore model, `T2`'s overlapping work would have been silently destroyed.
- The coarse-mag bucket logs are folded the same way, skipping `T1`'s entries — no re-downsampling, and no need for the finest-mag buckets to be resident.

---

## 7. Backend Changes

The frontend design above implies a matching change in the tracingstore. This section covers what that is; it is deliberately less settled than §5, and the open items are called out as such.

### 7.1 Two new update actions

**`updateBucketPartial`** replaces `updateBucket` on the write path. It carries runs instead of a whole bucket:

```scala
case class UpdateBucketPartialVolumeAction(
    actionTracingId: String,
    position: Vec3Int,                 // bucket position
    mag: Vec3Int,
    additionalCoordinates: Option[Seq[AdditionalCoordinate]],
    /** base64 of the binary run encoding (§5.8). Deliberately *not* LZ4'd —
      * RLE is already a compression, and a few hundred (start, length) pairs
      * give LZ4 almost nothing to work with. */
    runs: String,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None
) extends BucketMutatingVolumeUpdateAction
```

Note this breaks the length-based heuristic in `VolumeBucketCompression`, which today infers "already compressed" from `data.length != expectedUncompressedBucketSize`. A runs payload could coincidentally be bucket-sized. Whatever stores these needs an explicit marker rather than a length check.

**`invalidateUpdateActionsFromVersion`** is the tombstone, and it is how undo (§5.8's `undoTransaction`) is realised server-side. This action invalidates **the update actions belonging to exactly one version** — read the name as "the update actions *originating from* version V", not "everything from V onwards".

```scala
case class InvalidateUpdateActionsFromVersionAction(
    actionTracingId: String,
    /** The single version whose update actions are invalidated. */
    invalidatedVersion: Long,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None
) extends VolumeUpdateAction
```

Single-version is the right granularity because it matches what undo means in §5.7: one transaction is skipped, everything around it still applies. Undoing several transactions appends several tombstones. It also keeps the frontend and backend models identical, so a peer replaying the stream reaches the same state by the same rule.

The stream stays **append-only**: an invalidation is appended, never a rewrite. What it does to materialized buckets that already folded the now-invalid actions is the subject of §7.5.

### 7.2 Storage layout

Two FossilDB collections, split by lifecycle:

| collection | key | value | written |
|---|---|---|---|
| `volumeUpdateActions` | per bucket | the runs of one transaction | every version that touches the bucket |
| `volumeData` | per bucket | full LZ4-compressed bucket | only at *materialized* versions |

Both are versioned by FossilDB, and both rely on the same primitive: `Get(key, version)` returns the newest entry at or below `version`, and `GetMultipleVersions(key, from, to)` returns a range. That is precisely "find the base, then the diffs since".

Splitting collections rather than key-prefixing matters because the two have very different sizes and access patterns, and RocksDB keeps per-column-family memtables and block cache accounting. Note FossilDB fixes its collection list at startup (`-c skeletons,volumeData,…`), so adding one is a deployment change, not just a code change.

**Not every version is materialized.** The interval is the main tuning knob, measured by `VolumeVersioningBenchmarkService` (tracingstore, exposed at `POST /tracings/benchmark/volumeVersioning`); candidate policies, in increasing order of sophistication:

- every k-th version (simple, predictable, materializes buckets nobody reads),
- ad hoc on read, then cached (materializes exactly what is wanted, but the first reader pays),
- a background service (see §7.6) that materializes when there is spare capacity.

### 7.3 Ingestion

Per `updateBucketPartial`, in the common case:

1. Append the runs to `volumeUpdateActions` at the transaction's version. **That is the whole hot path** — no read, no decompress, no fold, no recompress.
2. Update the segment index (see §7.6 — today this dominates, and it is where the work should go).
3. If the version is a materialization point, materialize (below). Otherwise nothing.

`invalidateUpdateActionsFromVersion` appends its tombstone. It writes nothing else — which materializations that invalidates is decided at read time, not at write time (§7.5).

### 7.4 Reading, and materialization

Reading bucket *B* at version *X*:

1. `Get(volumeData, key(B), X)` → the newest materialized bucket at or below *X*, at some version *S*. Decompress it.
2. `GetMultipleVersions(volumeUpdateActions, key(B), S+1, X)` → every action since.
3. Drop actions covered by a tombstone, then fold the remaining runs onto the base.

Materializing at version *X* is exactly the same procedure followed by an LZ4 compress and a `Put` into `volumeData`. It is not free — the benchmark above measures it at 25–52% of ingestion time (interval 10 to 50) when it runs synchronously every k-th version, which is the main argument for moving it off the write path.

**Versions are sparse, per bucket.** This is the part that trips people up: an update action touches only the buckets that transaction actually edited, so bucket version streams advance independently. One bucket can sit at version 1 while its neighbour is at 500.

```
                                    version ───▶
              1    2    3    4    5    6    7    8    9   10
           ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
 bucket A  │ ▣  │ ●  │    │ ●  │ ▣  │    │    │ ●  │    │ ▣  │
           ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
 bucket B  │ ▣  │    │    │    │    │    │    │    │    │    │
           ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
 bucket C  │ ▣  │    │ ●  │ ●  │ ●  │ ●  │ ▣  │ ●  │ ●  │    │
           └────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘

  ●  updateBucketPartial touched this bucket at this version
  ▣  materialized bucket stored in `volumeData` at this version
     blank — this bucket was not touched at this version
```

Reading each bucket at version 10:

- **A** — newest ▣ ≤ 10 is at v10. Zero actions to fold; one `Get`, one decompress.
- **B** — newest ▣ ≤ 10 is at v1, and there are no actions after it. Also zero folds. A bucket nobody has edited costs the same as under today's scheme, however old the annotation gets.
- **C** — newest ▣ ≤ 10 is at v7, so fold the actions at v8 and v9. Note v10 is *not* in C's stream at all: the range query returns two entries, not three.

The read cost therefore depends on how many *touched* versions lie between the base and *X* for that bucket, not on how far the annotation as a whole has advanced. A materialization policy keyed on the global version number would materialize bucket B nine times for no reason; one keyed on per-bucket action count would not.

### 7.5 Invalidation and the folding base

§7.4 glossed over what a tombstone does to the materializations that precede it. Take bucket C, and suppose version 10 carries `invalidateUpdateActionsFromVersion(6)` — invalidating the update actions of version 6, and only those:

```
                                    version ───▶
              1    2    3    4    5    6    7    8    9   10
           ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
 bucket C  │ ▣  │    │ ●  │ ●  │ ●  │ ✗  │ ▣! │ ●  │ ●  │ ⊘  │
           └────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘

  ⊘   invalidateUpdateActionsFromVersion(6), appended at v10
  ✗   the update actions of v6, now invalidated — v7 onwards are untouched
  ▣!  materialization that folded v6 and is therefore no longer a usable base
```

Note what is *not* invalidated: v8 and v9 still apply. Only one version is dropped, so the fold has a hole in it rather than a truncation.

**The semantics that make this tractable.** A tombstone is itself a versioned entry in an append-only stream, so **a read at version X honours exactly the tombstones appended at or before X**. A read at v7 does not see the tombstone at v10, and therefore still yields the pre-undo content — which is what the version history UI asks for when it shows you v7. The v7 materialization is *not* wrong; it is the correct answer to a question nobody stopped asking.

That is the argument against deleting it on invalidation. "Valid" and "usable as a folding base" are different properties, and the second depends on the *read* version: the same v7 entry is a fine base at X = 8 and unusable at X = 10. It therefore cannot be a flag stored on the materialization at all. Deleting would throw away correct, expensive-to-recompute data and break historical reads, to fix a problem that only exists for reads after the tombstone.

**The rule.** Let `inv(X)` be the set of versions invalidated by tombstones appended at or before X. A materialization at version *S* is a usable base for a read at *X* iff every version it folded is still valid at *X* — equivalently, iff no tombstone appended in *(S, X]* names a version at or before *S*:

```
usable(S, X)  ⟺  ∄ t ∈ tombstones :  S < t.version ≤ X  ∧  t.invalidatedVersion ≤ S
```

Tombstones appended at or before *S* are already reflected in it, which is why the range starts at *S*.

**The algorithm**, replacing step 1 of §7.4:

```
read(bucket, X):
  tombs = tombstones appended at or before X   // one annotation-wide key, cached
  inv   = { t.invalidatedVersion : t ∈ tombs }
  S     = newest materialization ≤ X
  while S exists and ∃ t ∈ tombs with S < t.version ≤ X and t.invalidatedVersion ≤ S:
      S = newest materialization < S           // backtrack
  base    = materialization at S, or an empty bucket if none survives
  actions = GetMultipleVersions(volumeUpdateActions, key(bucket), S+1, X)
  fold    every action whose version ∉ inv
```

For bucket C at X = 10: the newest materialization is v7, but the tombstone at v10 names v6 ≤ 7, so v7 is rejected and we backtrack to v1. No tombstone names a version ≤ 1, so v1 is the base. Fold v3, v4, v5, **skip v6**, then fold v8 and v9.

**Tombstones belong in their own annotation-wide key**, not in each bucket's stream. An invalidation is a property of the annotation, and duplicating it per bucket would mean writing to buckets the transaction never touched. It also keeps the algorithm cheap: read a small tombstone list first, decide the base, then fetch only the actions you will actually fold. If tombstones lived in the bucket streams you would have to load every action just to discover which ones to drop.

**Backtracking is the cost, and it is unbounded** — in the worst case a read after an invalidation walks back to version 0. The mitigation is to materialize eagerly straight after applying a tombstone, so the expensive fold is paid once by the invalidating transaction rather than repeatedly by every subsequent reader. That makes invalidation the one case where synchronous materialization is clearly worth it, whatever policy §7.2 settles on for the ordinary path.

**Redo** is the inverse and needs a decision: either append a re-validating action, or treat a tombstone as itself invalidatable by a later tombstone naming *its* version. The second is more uniform — everything is an action, and undo-of-undo is just another tombstone — but it makes `inv(X)` a fold over the tombstone list rather than a set union, since a tombstone may itself be invalid. Unresolved (§10).

### 7.6 Performance: the segment index is the real bottleneck

The benchmark — `VolumeVersioningBenchmarkService` (tracingstore, exposed at `POST /tracings/benchmark/volumeVersioning`) — compares the two storage schemes **in isolation, with no segment index update at all**. That is its central limitation, and it cuts in the diff scheme's favour once corrected — because the cost it omits is the one that dominates in production, and it is shared by both schemes.

Today `VolumeSegmentIndexService.updateFromBucket` does the following per updated bucket:

1. decompress the new bucket bytes,
2. **read the previous bucket** (an extra fetch),
3. `collectSegmentIds` over both — two full 32³ scans,
4. `additions = new \ prev`, `removals = prev \ new`,
5. write an index entry per addition and per removal.

So the current write path already pays a read, two full-bucket scans and a set diff per bucket. Against that, the difference between appending 1.2 KB of runs and writing a 5.5 KB compressed bucket is small. **The relative penalty it measures (~1.4× ingestion, with realistic LZ4-compressible content) should shrink substantially once this shared cost is included** — though that needs measuring, not assuming.

#### Decoupling, in three steps

1. **Update the index only when materializing.** The index then lags the newest version by at most one materialization interval, which is acceptable for the things that read it.
2. **Update it only when its contents are needed.** Materialization stops being the trigger; the first reader of the index for a region pays for bringing it up to date.
3. **A background service** that consumes pending work when the tracingstore has spare capacity, so neither writers nor readers pay in the common case.

Each step is independently shippable, and each strictly reduces work on the hot path.

#### Additions are free; removals are the expensive half

There is a sharper optimization available, and it is specific to the diff scheme.

An `updateBucketPartial` is **single-valued** — one transaction writes one segment id (§4). So the set of possible *additions* to the segment index is known from the action itself, with **no read and no scan**: it is that one id. Steps 1–3 above exist entirely to compute *removals*.

Removals require knowing that a segment id no longer appears anywhere in the bucket, which genuinely needs the full before-and-after. But **completely erasing a segment from a bucket is rare** — most strokes overwrite part of a segment, leaving some of it behind. So the proposal is to **skip the removal computation entirely** and update the index from the action's value alone.

The resulting error is one-sided and benign: the index becomes an **over-approximation**, claiming a segment is present in a bucket it has since vanished from. It never *misses* a bucket that does contain the segment. Consumers already have to tolerate a bucket that turns out not to contain the segment they were looking for; the cost is a wasted bucket fetch, not a wrong answer. And code that scans a segment exhaustively anyway — segment statistics aggregation being the obvious case — can prune the stale entry when it notices, so the index self-heals where it matters.

That turns the current bottleneck into an append of one `(segmentId, bucket)` pair per action. Whether the over-approximation is acceptable for every consumer of the index is the thing to check before building it (§10).

---

## 8. Toward Collaborative Editing

Not implemented here, but the shape is deliberately compatible:

- Diffs, not snapshots, are the unit of truth, so a remote peer's diff and a local one are the same object.
- The per-bucket ordered log with last-write-wins folding is already the merge structure. A remote `TransactionDiff` is handled exactly like an undo replay: insert its entries at the right sequence position in the affected bucket logs and re-fold.
- `TransactionDiff.sequence` is today just local chronological order. Making it a *total* order across users needs either server-assigned sequence numbers (simple, costs a round-trip) or a logical clock (no round-trip, more complexity). Either slots into the existing `sequence` field without changing the model.
- `BucketDiff.beforeCommitted` becomes useful here: comparing it against local state detects genuine conflicts rather than assuming last-writer-wins is always acceptable.
- Undo becomes "skip *my* transaction, keep everyone else's", which is exactly what the forward-replay model already does. Because it travels as a marker rather than as data (§5.8), a peer applies it by performing the identical skip-and-refold, so no reconciliation step is needed.
- Convergence holds at every mag, not just the finest: all parties fold the same ordered per-mag diffs, and none of them re-derive coarse content locally.

---

## 9. Rejected Alternatives

| Alternative | Why not |
|---|---|
| Send full bucket snapshots (today's model) | Simple, but two users' edits to one bucket can only resolve as last-writer-wins over the whole bucket. Blocks requirement 3. |
| Undo as a stack of inverse diffs applied to live state | Correct only if nothing else touched those voxels in between. Breaks under collaboration and even under some local redo orderings. |
| Undo as full-bucket snapshot restore | Same problem, worse: silently reverts *all* later edits to the bucket, not just the undone ones. |
| Rasterize the shape independently at each mag | N× the work, and the per-mag results disagree at boundaries, leaving the pyramid inconsistent in a way no downsampling can fix. |
| Recompute each coarse bucket from its finest-mag children | Infeasible: a mag-16 bucket has 4096 finest-mag children. Propagate the *write set* instead. |
| Majority-vote downsampling into coarse mags | Thin structures vanish when zooming out. Written-value-wins keeps them visible; the resulting dilation is the accepted price. |
| Treat background as special when downsampling (clear a coarse voxel only if all finest-mag siblings are background) | More faithful, but requires reading every sibling — which re-couples mag propagation to bucket residency and forces loads during coarse-mag strokes. |
| Send only finest-mag diffs; let the backend derive coarse mags | Written-value-wins is order-dependent, so a backend seeing only final state cannot reproduce it under any derivation rule. Coarse mags would visibly change on reload. Sending all mags costs ~15–35% more payload and avoids this entirely. |
| Keep diffs at their authoring mag, never normalize | No single source of truth; reading mag *k* requires folding diffs authored at every other mag, with ill-defined ordering between them. |
| Snapshot-then-diff per bucket instead of a write set | Cannot represent writes to non-resident buckets, and costs O(bucket) per touched bucket even for a 5-voxel edit. |
| Re-downsample coarse mags from the finest mag after an undo, instead of replaying their logs | Needs a downsample rule nothing specifies, requires the finest-mag buckets to be resident, breaks convergence between a re-downsampling and a replaying client, and is the only thing that would force multi-valued write sets. |
| Transmit undo as a compensating diff that restores the old values | Needs absolute prior values for every touched bucket — including the hundreds of non-resident ones a coarse-mag stroke writes — and those values are multi-valued. A skip marker is O(1) and needs no data (§5.8). |

---

## 10. Open Questions

- **Flood fill and unloaded data.** Fill needs the connected region resident to be correct. Options: block on fetches with a progress indicator, fill progressively as buckets arrive, or bound the fill to a region and refuse beyond it. Needs a UX decision — this is the one tool where "diffs for non-resident buckets" does not save us, because the *region itself* depends on data we do not have.
- **Interaction with mappings / agglomerates.** Proofreading edits operate on mapped IDs, and `EditContext.activeSegmentId` is then an agglomerate ID rather than a stored one. Where the mapping is resolved (before rasterization? at apply time?) is unresolved and deserves its own section.
- **Commit-time spike on coarse-mag strokes.** Two things already blunt this. The run-oriented upsample (§5.4) works in scanlines rather than voxels, so the measured mag-16 case is ~300 K run emissions over 2.9 MB of masks rather than 9.25 M individual writes; and cascading means the *downsample* side never touches the large finest-mag set at all, deriving each coarser level from the small one beside it. What remains is the upsample chain, which is irreducible — the finest level genuinely has 8.1 M voxels in it. What is unmeasured is whether ~300 K run emissions plus a ~1.2 MB encode land as a perceptible hitch on pointer-up. If they do, the lever is *not* the mid-stroke throttle — the expansion is inherent to drawing at a coarse mag, and per-sample propagation would only repeat it. It would instead be keeping the upsample fully symbolic: carry `(box, value)` fills through to §5.8's encoder and never build masks for non-resident finest-mag buckets at all. Measure before building.
- **Checkpoint interval *k*.** Too small → memory and storage overhead; too large → slow replay and slow eviction. Start around 20–50 entries per bucket and tune empirically. Interacts with the undo horizon.
- **Where does the rasterizer run?** It is a pure function of `(intent, context, reader)`, which makes it a good Web Worker candidate for large strokes. Not needed for correctness; the blocker is giving a worker a cheap read view of resident buckets (`SharedArrayBuffer`, probably).
- **Coarse mags diverge from re-downsampling the finest mag, permanently.** Not drift between client and server, and not drift between collaborators: every party folds the same ordered per-mag diffs, so everyone agrees (§5.4). But because written-value-wins is order-dependent, the stored coarse mags are a function of *how* a region was edited, and no later pass can reconstruct them from the finest mag. Principle 2 accepts this. If it stops being acceptable, the answer is a background re-derivation job on a schedule — which would first have to settle what "correct" means at coarse mags, a question this doc does not answer. Adopting a data-derivable rule instead would re-couple propagation to bucket residency and reintroduce multi-valued write sets; see §5.4.
- **How is redo expressed (§7.5)?** Either a re-validating action, or a tombstone that names another tombstone's version. The second is more uniform but makes the invalidated-version set a fold over the tombstone list rather than a plain union, since a tombstone may itself have been invalidated. The choice also decides whether undo/redo cycles grow the stream without bound.
- **Is an over-approximating segment index acceptable to every consumer (§7.6)?** Skipping removal detection turns the current bottleneck into a single append, at the cost of an index that sometimes claims a segment is in a bucket it has left. Consumers must already tolerate a fetched bucket not containing the wanted segment, but that should be verified against each one — mesh generation, statistics aggregation, and the segment list — rather than assumed.
- **Materialization policy (§7.2).** Every k-th version is simplest but wrong-shaped: version numbers are global while bucket streams are sparse, so it materializes untouched buckets repeatedly and under-materializes hot ones. Keying on per-bucket action count is the obvious fix; ad-hoc-on-read and a background service are the other candidates.
- **Undo across a reload.** The log is currently in-memory. Persisting it (IndexedDB) would let undo survive a refresh, but raises the question of what "undo" means once the backend has already accepted the transaction. Probably out of scope, but worth deciding explicitly rather than by omission.

---

## 11. Potential Performance Improvements

Deliberately out of the baseline design. Each is a local change behind an existing interface, and none should be built before the corresponding cost has been measured.

### 11.1 Sub-box + bitmask payload for YZ strokes and block fills

The run encoding (§5.8) has one bad shape and one wasteful one. A YZ-plane stroke produces only length-1 runs, because x — the fast axis — is constant in that plane. And an upsampled block fill produces hundreds of short runs describing what is really just a box.

Both are fixed by the same thing: let a bucket's payload be an axis-aligned sub-box plus, optionally, a bitmask over that box. A one-byte header selects the shape, and the encoder picks whichever is smallest.

| Case | `RUNS` @ 4 B/run | `BOX` / `BOX_MASK` |
|---|---|---|
| YZ disk, r = 10 | ~314 runs → 1256 B | bbox `1×21×21` → 6 B + 56 B mask = **62 B** |
| XY disk, r = 10 | ~20 runs → 80 B | 62 B |
| mag-16 upsample, full bucket | 1024 runs → 4 KB | solid box → **6 B** |

This is preferable to the more obvious fix of adding a **stride** to each run (`start, count, stride`, so a YZ column becomes one strided run). Strides help only the YZ case and do nothing for block fills; they require detecting stride patterns during `VoxelMask.runs()`, which is an awkward word scan; and extracting a sub-box bitmask from the mask is simpler than either.

The degenerate case of `BOX_MASK` — box = the whole bucket — is just "a `32³` bitmask plus one value", the alternative weighed in §5.8. It is a fixed 4 KB and therefore beats runs for densely-written buckets while losing badly for lightly-grazed ones. Letting the encoder choose per bucket is what makes the two complementary rather than competing.

Measure first. The transport is compressed, and 314 near-identical records with starts in arithmetic progression compress extremely well, so the gap after gzip is likely far smaller than the raw numbers suggest. Raw size matters more in the in-memory undo log — but note that compressing *there* is also possible (`bucket_snapshot.ts` does it today) at the cost of making access asynchronous, so the comparison is against that complexity rather than against nothing.

Note this does not help the CPU side: filling the mask for a YZ stroke is bit-at-a-time, because `markRun`'s word-fill only applies along x (§4). For a brush dab that is a few hundred OR operations — negligible, and O(voxels) either way.

### 11.2 Pack `MaskShape.selected` into a bitset

`MaskShape` carries one byte per voxel (§5.1), which is 8× a packed bitset — 256 KB rather than 32 KB for a `512×512` patch, and 16 MB rather than 2 MB for a `256³` volume patch. Simplicity was chosen over density because the format is an interchange boundary: byte arrays impose no alignment constraint on the producer, have unambiguous byte order across worker and WASM boundaries, and match what a thresholded model output already looks like.

Packing it is a contained change — the producers, and the loop that converts a mask into a `VoxelWriteSet`. Nothing else reads `selected`. Two caveats if it is done:

- The bit addressing must be specified, not assumed: index `x + y·size[0] + z·size[0]·size[1]`, LSB-first within each byte, is the obvious convention but two implementations will otherwise disagree about it.
- It cannot reuse `VoxelMask`. That class is fixed at `32³` and its word/x-row alignment is meaningful only inside a bucket; a mask over an arbitrary box shares none of that.

Worth doing when a tool starts producing large 3D patches. For the 2D patches quick-select emits today, the absolute numbers are small and transient — the mask is discarded as soon as it becomes a write set.

### 11.3 Others, tracked in §10

Two further performance items are open questions rather than designed improvements, and are listed in §10: keeping the upsample fully symbolic to flatten the commit-time spike on coarse-mag strokes, and moving the rasterizer into a Web Worker.
