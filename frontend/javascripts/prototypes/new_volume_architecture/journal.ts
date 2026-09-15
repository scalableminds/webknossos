import {
  applyRun,
  type BucketDiff,
  type TransactionDiff,
  type TransactionId,
  type VoxelRun,
} from "./diff";
import { BUCKET_VOXEL_COUNT, type BucketAddress, type BucketKey, bucketKey } from "./types";

export interface BucketLogEntry {
  sequence: number;
  transactionId: TransactionId;
  runs: VoxelRun[];
  /** Set by undo, cleared by redo. */
  skipped: boolean;
  /** Server version this entry was acked at; null while unsaved. */
  acknowledgedAtVersion: number | null;
}

export interface BucketLog {
  address: BucketAddress;
  /**
   * The backend content this bucket was last loaded with, and the version it
   * reflects. Null while the bucket has never been fetched — in which case
   * nothing can be rebuilt, but nothing is being displayed either.
   */
  base: { version: number; data: BigUint64Array } | null;
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
  setBase(address: BucketAddress, data: BigUint64Array, version: number): void {
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
  private fold(log: BucketLog, base: BigUint64Array, baseVersion: number): BigUint64Array {
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
    backendData: BigUint64Array,
    dataVersion: number,
  ): BigUint64Array {
    return this.fold(this.logFor(address), backendData, dataVersion);
  }

  /** Fold from the bucket's recorded base (undo/redo rebuild). */
  rebuild(address: BucketAddress): BigUint64Array {
    const log = this.logFor(address);
    if (log.base == null) {
      return this.fold(log, new BigUint64Array(BUCKET_VOXEL_COUNT), -1);
    }
    return this.fold(log, log.base.data, log.base.version);
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

  /** Diffs not yet acknowledged by the backend, for the save queue. */
  unsavedBucketDiffs(): BucketDiff[] {
    const diffs: BucketDiff[] = [];
    for (const log of this.logs.values()) {
      const runs = log.entries
        .filter((entry) => !entry.skipped && entry.acknowledgedAtVersion == null)
        .flatMap((entry) => entry.runs);
      if (runs.length > 0) diffs.push({ address: log.address, runs });
    }
    return diffs;
  }
}
