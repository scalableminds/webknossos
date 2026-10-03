import { M4x4, type Matrix4x4, V3 } from "libs/mjs";
import type { Vector3 } from "viewer/constants";
import { UnitLong } from "viewer/constants";
import { _getDummyFlycamMatrix } from "viewer/model/accessors/flycam_accessor";
import {
  buildOverlapTest,
  getSquareFrustum,
} from "viewer/model/bucket_data_handling/polyhedron_flood_fill";
import { PrefetchStrategyFlight } from "viewer/model/bucket_data_handling/prefetch_strategy_arbitrary";
import { MagInfo } from "viewer/model/helpers/mag_info";
import { describe, expect, it } from "vitest";

const MAGS: Vector3[] = [
  [1, 1, 1],
  [2, 2, 2],
  [4, 4, 4],
];

describe("getSquareFrustum", () => {
  it("has the expected vertices and twelve edges", () => {
    const { vertices, edgeIndices } = getSquareFrustum(2, 4, -1, 6, 8, 3);
    const points = new Set<string>();
    for (let i = 0; i < vertices.length; i += 3) {
      points.add(vertices.slice(i, i + 3).join(","));
    }
    expect([...points].sort()).toEqual(
      ["-1,-2,-1", "-1,2,-1", "1,-2,-1", "1,2,-1", "-3,-4,3", "-3,4,3", "3,-4,3", "3,4,3"].sort(),
    );
    expect(edgeIndices.length).toBe(24);
    // Every edge connects two vertices that differ in exactly one coordinate's sign or in z.
    const edges = new Set<string>();
    for (let i = 0; i < edgeIndices.length; i += 2) {
      const a = vertices.slice(edgeIndices[i], edgeIndices[i] + 3);
      const b = vertices.slice(edgeIndices[i + 1], edgeIndices[i + 1] + 3);
      const isLateral =
        a[2] !== b[2] && Math.sign(a[0]) === Math.sign(b[0]) && Math.sign(a[1]) === Math.sign(b[1]);
      const isOnFace = a[2] === b[2] && (a[0] === b[0]) !== (a[1] === b[1]);
      expect(isLateral || isOnFace).toBe(true);
      edges.add([a.join(","), b.join(",")].sort().join("|"));
    }
    expect(edges.size).toBe(12);
  });
});

describe("PrefetchStrategyFlight", () => {
  it("prefetches exactly the buckets overlapping the frustum, prioritized by distance", () => {
    let matrix = [
      ..._getDummyFlycamMatrix({ factor: [11, 11, 24], unit: UnitLong.nm }),
    ] as Matrix4x4;
    matrix = M4x4.rotate(Math.PI / 6, [1, 0, 0], matrix, []) as Matrix4x4;
    matrix = M4x4.rotate(Math.PI / 9, [0, 1, 0], matrix, []) as Matrix4x4;
    const position: Vector3 = [5000, 4000, 3000];
    matrix[12] = position[0];
    matrix[13] = position[1];
    matrix[14] = position[2];

    const strategy = new PrefetchStrategyFlight();
    const items = strategy.prefetch(matrix, 0, position, MAGS, new MagInfo(MAGS), null);

    // Same frustum transformation as the strategy: translation converted to bucket coordinates.
    const bucketMatrix = M4x4.clone(matrix);
    strategy.modifyMatrixForPoly(bucketMatrix, 0);
    const vertices = M4x4.transformPointsAffine(bucketMatrix, strategy.prefetchFrustum.vertices);
    const overlaps = buildOverlapTest(vertices, strategy.prefetchFrustum.edgeIndices);
    const expected: string[] = [];
    const min = [0, 1, 2].map((d) =>
      Math.floor(Math.min(...vertices.filter((_, i) => i % 3 === d))),
    );
    const max = [0, 1, 2].map((d) =>
      Math.floor(Math.max(...vertices.filter((_, i) => i % 3 === d))),
    );
    for (let x = min[0]; x <= max[0]; x++) {
      for (let y = min[1]; y <= max[1]; y++) {
        for (let z = min[2]; z <= max[2]; z++) {
          if (overlaps(x, y, z)) expected.push(`${x},${y},${z}`);
        }
      }
    }

    expect(items.map((item) => item.bucket.slice(0, 3).join(",")).sort()).toEqual(expected.sort());
    const positionBucket = position.map((value) => Math.floor(value / 32)) as Vector3;
    for (const { bucket, priority } of items) {
      expect(bucket[3]).toBe(0);
      expect(priority).toBeCloseTo(
        1 + V3.length(V3.sub([bucket[0], bucket[1], bucket[2]], positionBucket)),
      );
    }
  });
});
