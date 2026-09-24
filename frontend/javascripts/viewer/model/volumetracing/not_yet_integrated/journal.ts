import {
  applyRun,
  type BucketDiff,
  type TransactionDiff,
  type TransactionId,
  type VoxelRun,
} from "../core/diff";
import {
  BUCKET_VOXEL_COUNT,
  type BucketAddress,
  type BucketKey,
  bucketKey,
  type DenseBucketData,
} from "../core/types";

export interface BucketLogEntry {
  sequence: number;
  transactionId: TransactionId;
  runs: VoxelRun[];
  /** Set by undo, cleared by redo. */
  skipped: boolean;
  /** Server version this entry was acked at; null while unsaved. */
  acknowledgedAtVersion: number | null;
}

/** One not-yet-saved transaction, as the save queue will send it. */
export interface UnsavedTransaction {
  transactionId: TransactionId;
  sequence: number;
  bucketDiffs: BucketDiff[];
}

export interface BucketLog {
  address: BucketAddress;
  /**
   * The backend content this bucket was last loaded with, and the version it
   * reflects. Null while the bucket has never been fetched — in which case
   * nothing can be rebuilt, but nothing is being displayed either.
   *
   * This is the *load* base. It is not the local checkpoint design doc §5.7
   * folds undo from; that does not exist yet (see `rebuild`), so the two roles
   * currently share this one field.
   */
  base: { version: number; data: DenseBucketData } | null;
  entries: BucketLogEntry[]; // ascending by sequence
}

/**
 * Owns the per-bucket logs. Despite the undo/redo methods this is not an
 * undo-specific structure — it is where bucket content is *defined*, with three
 * consumers: undo/redo, bucket load, and save.
 */
export class BucketJournal {
  private readonly logs = new Map<BucketKey, BucketLog>();

  logFor(address: BucketAddress): BucketLog {
    const key = bucketKey(address);
    let log = this.logs.get(key);
    if (log == null) {
      log = { address, base: null, entries: [] };
      this.logs.set(key, log);
    }
    return log;
  }

  hasLog(address: BucketAddress): boolean {
    return this.logs.has(bucketKey(address));
  }

  /** Record the backend content a bucket was loaded with. */
  setBase(address: BucketAddress, data: DenseBucketData, version: number): void {
    this.logFor(address).base = { version, data };
  }

  /** Append a committed transaction's entries to each bucket it touched. */
  append(diff: TransactionDiff): void {
    for (const bucketDiff of diff.bucketDiffs) {
      this.logFor(bucketDiff.address).entries.push({
        sequence: diff.sequence,
        transactionId: diff.id,
        runs: bucketDiff.runs,
        skipped: false,
        acknowledgedAtVersion: null,
      });
    }
  }

  /** Mark a transaction as saved, so later loads know it is already included. */
  acknowledge(transactionId: TransactionId, version: number): void {
    for (const log of this.logs.values()) {
      for (const entry of log.entries) {
        if (entry.transactionId === transactionId) entry.acknowledgedAtVersion = version;
      }
    }
  }

  /**
   * The single fold. Callers differ only in the base they supply and, via
   * `baseVersion`, in which entries that base already contains.
   */
  private fold(log: BucketLog, base: DenseBucketData, baseVersion: number): DenseBucketData {
    const data = base.slice();
    for (const entry of log.entries) {
      if (entry.skipped) continue;
      // Already contained in the base; re-applying it could resurrect a write
      // that a later, unseen transaction superseded.
      if (entry.acknowledgedAtVersion != null && entry.acknowledgedAtVersion <= baseVersion) {
        continue;
      }
      for (const run of entry.runs) applyRun(data, run);
    }
    return data;
  }

  /** Fold local entries onto freshly fetched backend data (bucket load). */
  foldOntoFetched(
    address: BucketAddress,
    backendData: DenseBucketData,
    dataVersion: number,
  ): DenseBucketData {
    return this.fold(this.logFor(address), backendData, dataVersion);
  }

  /**
   * Fold from the bucket's recorded base (undo/redo rebuild).
   *
   * NOT YET ENFORCED: design doc §5.8 requires that nothing still undoable has
   * been folded into a base — "the backend's materialization/squashing point
   * must stay at or behind the undo horizon", the same rule §5.7 states for
   * local checkpoints. Nothing here upholds it: `setBase` advances the base to
   * whatever version was fetched. A fold can only *add* runs onto its base, so
   * once a transaction is inside `base.data` no skip flag can take it out
   * again, and undoing it would silently do nothing.
   *
   * Hence the throw rather than a stale array. When the journal goes on the
   * live path (§12.3 step 2), the callers of undo() decide per bucket: skip
   * and rebuild locally while the base predates the transaction, otherwise
   * send the `undoTransaction` marker (§5.8) and re-fetch the bucket, whose
   * content the backend has already re-folded without it.
   */
  rebuild(address: BucketAddress): DenseBucketData {
    const log = this.logFor(address);
    if (log.base == null) {
      return this.fold(log, new BigUint64Array(BUCKET_VOXEL_COUNT), -1);
    }
    const baseVersion = log.base.version;
    const undoneInsideBase = log.entries.find(
      (entry) =>
        entry.skipped &&
        entry.acknowledgedAtVersion != null &&
        entry.acknowledgedAtVersion <= baseVersion,
    );
    if (undoneInsideBase != null) {
      throw new Error(
        `Cannot rebuild ${bucketKey(address)}: transaction ${undoneInsideBase.transactionId} is ` +
          `undone but already folded into the base at version ${baseVersion}. The bucket has to be ` +
          "re-fetched instead (see this method's docstring).",
      );
    }
    return this.fold(log, log.base.data, baseVersion);
  }

  /** Mark a transaction skipped. Returns the buckets whose content changed. */
  undo(transactionId: TransactionId): BucketAddress[] {
    return this.setSkipped(transactionId, true);
  }

  redo(transactionId: TransactionId): BucketAddress[] {
    return this.setSkipped(transactionId, false);
  }

  private setSkipped(transactionId: TransactionId, skipped: boolean): BucketAddress[] {
    const affected: BucketAddress[] = [];
    for (const log of this.logs.values()) {
      let touched = false;
      for (const entry of log.entries) {
        if (entry.transactionId === transactionId && entry.skipped !== skipped) {
          entry.skipped = skipped;
          touched = true;
        }
      }
      if (touched) affected.push(log.address);
    }
    return affected;
  }

  /**
   * What the save queue still owes the backend, grouped as §5.8 requires: one
   * entry per transaction, each carrying one `BucketDiff` per bucket that
   * transaction touched, in `sequence` order.
   */
  unsavedTransactions(): UnsavedTransaction[] {
    const byTransaction = new Map<TransactionId, UnsavedTransaction>();
    for (const log of this.logs.values()) {
      for (const entry of log.entries) {
        if (entry.skipped || entry.acknowledgedAtVersion != null) continue;
        let unsaved = byTransaction.get(entry.transactionId);
        if (unsaved == null) {
          unsaved = {
            transactionId: entry.transactionId,
            sequence: entry.sequence,
            bucketDiffs: [],
          };
          byTransaction.set(entry.transactionId, unsaved);
        }
        unsaved.bucketDiffs.push({ address: log.address, runs: entry.runs });
      }
    }
    // Logs are iterated in insertion order, so the grouping has to be sorted:
    // §5.8 submits transactions in sequence order.
    return [...byTransaction.values()].sort((a, b) => a.sequence - b.sequence);
  }
}
