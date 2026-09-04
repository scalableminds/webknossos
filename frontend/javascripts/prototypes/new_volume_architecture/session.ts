import type { WorkingDataCube } from "./cube";
import type { TransactionDiff, TransactionId } from "./diff";
import type { DataDependentShape, MaskShape } from "./intents";
import type { BucketJournal } from "./journal";
import { rasterize } from "./rasterizer";
import { resolve } from "./resolver";
import { VolumeTransaction } from "./transaction";
import type { BucketAddress, EditContext, MagList, Vector3 } from "./types";

/**
 * Drives one editing session: opens transactions, routes intents to the
 * rasterizer or the resolver, commits, and records the resulting diffs.
 *
 * Deliberately framework-free — no store, no sagas, no React. A caller feeds it
 * pointer events; it emits TransactionDiffs.
 */
export class VolumeEditingSession {
  private sequence = 0;
  private transactionCounter = 0;
  private stroke: {
    tx: VolumeTransaction;
    ctx: EditContext;
    path: Vector3[];
    radius: Vector3;
    planeAxis: 0 | 1 | 2 | null;
  } | null = null;

  /** Every committed transaction, in order. Stands in for the save queue. */
  readonly emitted: TransactionDiff[] = [];
  /** Undo stack of transaction ids, most recent last. */
  private readonly undoStack: TransactionId[] = [];
  private readonly redoStack: TransactionId[] = [];

  constructor(
    private readonly cube: WorkingDataCube,
    private readonly journal: BucketJournal,
    private readonly mags: MagList,
  ) {}

  private nextTransaction(ctx: EditContext): VolumeTransaction {
    this.transactionCounter++;
    return new VolumeTransaction(`tx-${this.transactionCounter}`, ctx, this.cube, this.mags);
  }

  private finish(tx: VolumeTransaction, toolName: string): TransactionDiff {
    this.sequence++;
    const diff = tx.commit(this.sequence, toolName);
    this.journal.append(diff);
    this.emitted.push(diff);
    this.undoStack.push(diff.id);
    this.redoStack.length = 0;
    return diff;
  }

  // ── Brush ────────────────────────────────────────────────────────────────

  /** Pointer-down. Freezes the EditContext for the whole stroke. */
  beginBrushStroke(
    ctx: EditContext,
    start: Vector3,
    /** Per-axis radius in source-mag voxels (§ intents.ts). */
    radius: Vector3,
    planeAxis: 0 | 1 | 2 | null = 2,
  ): void {
    if (this.stroke != null) throw new Error("A brush stroke is already open");
    const tx = this.nextTransaction(ctx);
    this.stroke = { tx, ctx, path: [start], radius, planeAxis };
    // A pointer-down alone already paints a dab.
    rasterize({ kind: "brush", path: [start], radius, planeAxis }, ctx, tx);
    tx.flushToCube();
  }

  /**
   * Pointer-move. Only the incremental capsule is rasterized; the transaction's
   * write set coalesces overlapping samples for free.
   */
  extendBrushStroke(point: Vector3): void {
    const stroke = this.stroke;
    if (stroke == null) throw new Error("No brush stroke is open");
    const previous = stroke.path[stroke.path.length - 1];
    stroke.path.push(point);
    rasterize(
      {
        kind: "brush",
        path: [previous, point],
        radius: stroke.radius,
        planeAxis: stroke.planeAxis,
      },
      stroke.ctx,
      stroke.tx,
    );
    stroke.tx.flushToCube();
  }

  /** Pointer-up. Runs mag propagation once and commits. */
  endBrushStroke(): TransactionDiff {
    const stroke = this.stroke;
    if (stroke == null) throw new Error("No brush stroke is open");
    this.stroke = null;
    return this.finish(stroke.tx, "brush");
  }

  /** Escape. Restores the touched resident buckets and emits nothing. */
  abortBrushStroke(): void {
    const stroke = this.stroke;
    if (stroke == null) return;
    this.stroke = null;
    stroke.tx.abort();
  }

  // ── Data-dependent tools ─────────────────────────────────────────────────

  /**
   * Resolves first — possibly over many fetches — and only then opens a
   * transaction, so a transaction never spans an await.
   */
  async floodFill(
    shape: DataDependentShape,
    ctx: EditContext,
    signal?: AbortSignal,
  ): Promise<TransactionDiff> {
    const writeSet = await resolve(shape, ctx, this.cube, signal);
    const tx = this.nextTransaction(ctx);
    tx.recordAll(writeSet);
    tx.flushToCube();
    return this.finish(tx, "floodFill");
  }

  /** ML / quick-select style tools hand over a dense patch directly. */
  applyMask(shape: MaskShape, ctx: EditContext): TransactionDiff {
    const tx = this.nextTransaction(ctx);
    rasterize(shape, ctx, tx);
    tx.flushToCube();
    return this.finish(tx, "mask");
  }

  // ── Undo / redo ──────────────────────────────────────────────────────────

  private rebuildAll(addresses: readonly BucketAddress[]): void {
    for (const address of addresses) {
      this.cube.install(address, this.journal.rebuild(address));
    }
  }

  /** Undo the most recent transaction (Ctrl+Z). */
  undo(): TransactionId | null {
    const id = this.undoStack.pop();
    if (id == null) return null;
    this.rebuildAll(this.journal.undo(id));
    this.redoStack.push(id);
    return id;
  }

  redo(): TransactionId | null {
    const id = this.redoStack.pop();
    if (id == null) return null;
    this.rebuildAll(this.journal.redo(id));
    this.undoStack.push(id);
    return id;
  }

  /**
   * Undo one specific transaction, leaving later ones in place — the history
   * panel case. Everything after it is replayed normally, which is the whole
   * point of folding forward rather than inverting.
   */
  undoById(id: TransactionId): void {
    this.rebuildAll(this.journal.undo(id));
    const index = this.undoStack.indexOf(id);
    if (index >= 0) this.undoStack.splice(index, 1);
    this.redoStack.push(id);
  }

  redoById(id: TransactionId): void {
    this.rebuildAll(this.journal.redo(id));
    const index = this.redoStack.indexOf(id);
    if (index >= 0) this.redoStack.splice(index, 1);
    this.undoStack.push(id);
  }
}
