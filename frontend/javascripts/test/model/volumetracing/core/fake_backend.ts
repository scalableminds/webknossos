/**
 * The simplest thing that satisfies `BackendLike` (core/cube.ts): an in-memory
 * store of seeded buckets. Everything not explicitly seeded reads as empty.
 */

import type { BackendLike } from "viewer/model/volumetracing/core/cube";
import {
  BUCKET_VOXEL_COUNT,
  type BucketAddress,
  type BucketKey,
  bucketKey,
  type SegmentId,
  type Vector3,
  voxelIndexOf,
} from "viewer/model/volumetracing/core/types";

export class FakeBackend implements BackendLike {
  private readonly seeded = new Map<BucketKey, BigUint64Array>();
  version = 0;
  readonly fetched: BucketAddress[] = [];

  /** Pre-populate a bucket with data the frontend will later fetch. */
  seed(address: BucketAddress, data: BigUint64Array): void {
    this.seeded.set(bucketKey(address), data);
  }

  seedVoxel(address: BucketAddress, offset: Vector3, value: SegmentId): void {
    const key = bucketKey(address);
    let data = this.seeded.get(key);
    if (data == null) {
      data = new BigUint64Array(BUCKET_VOXEL_COUNT);
      this.seeded.set(key, data);
    }
    data[voxelIndexOf(offset[0], offset[1], offset[2])] = value;
  }

  async fetchBucket(address: BucketAddress): Promise<{ data: BigUint64Array; version: number }> {
    this.fetched.push(address);
    const seeded = this.seeded.get(bucketKey(address));
    const data = seeded != null ? seeded.slice() : new BigUint64Array(BUCKET_VOXEL_COUNT);
    return { data, version: this.version };
  }
}
