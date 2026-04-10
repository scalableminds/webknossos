import uniqBy from "lodash-es/uniqBy";
import { bench, describe } from "vitest";
import type { Vector3 } from "viewer/constants";

const hashPosition = ([x, y, z]: Vector3): number => 2 ** 32 * x + 2 ** 16 * y + z;

// Simulate a realistic bucket address space (e.g. 64^3 buckets with ~30% duplicates)
function generateBuckets(count: number, duplicationRate: number): Vector3[] {
  const buckets: Vector3[] = [];
  const pool: Vector3[] = [];
  for (let i = 0; i < count * (1 - duplicationRate); i++) {
    pool.push([Math.floor(i * 1034000), Math.floor(i * 1234), i * 64]);
  }
  for (let i = 0; i < count; i++) {
    const src = pool[Math.floor(Math.random() * pool.length)];
    buckets.push([...src]);
  }
  return buckets;
}

const INPUT = generateBuckets(20000, 0.0);
const ABORT_LIMIT = 20000;

describe("unique bucket strategies", () => {
  bench("push-all then uniqBy (old)", () => {
    const traversedBuckets: Vector3[] = [];
    for (const bucket of INPUT) {
      traversedBuckets.push(bucket);
    }
    const unique = uniqBy(traversedBuckets, hashPosition);
    return unique; // prevent dead-code elimination
  });

  bench("Set-based dedup while pushing (new)", () => {
    const seen = new Set<number>();
    const traversedBuckets: Vector3[] = [];
    for (const bucket of INPUT) {
      const key = hashPosition(bucket);
      if (!seen.has(key)) {
        seen.add(key);
        traversedBuckets.push(bucket);
        if (traversedBuckets.length > ABORT_LIMIT) break;
      }
    }
    return traversedBuckets;
  });
});
