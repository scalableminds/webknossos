import { M4x4, type Matrix4x4 } from "libs/mjs";
import {
  buildOverlapTest,
  collectBucketsInConvexPolyhedron,
  getSquareFrustum,
} from "viewer/model/bucket_data_handling/convex_polyhedron_buckets";
import { describe, expect, it } from "vitest";

const frustum = getSquareFrustum(7, 7, -0.5, 10, 10, 20);

// squareFrustum's vertices are ordered (x sign, y sign, near/far) as follows.
const FACES = [
  [0, 2, 6, 4], // near
  [1, 3, 7, 5], // far
  [0, 1, 3, 2], // -x
  [4, 6, 7, 5], // +x
  [0, 4, 5, 1], // -y
  [2, 3, 7, 6], // +y
];

function getVertices(matrix: Matrix4x4): Array<number> {
  return M4x4.transformPointsAffine(matrix, frustum.vertices);
}

function isInside(vertices: Array<number>, point: [number, number, number]): boolean {
  const vertex = (i: number) => [vertices[3 * i], vertices[3 * i + 1], vertices[3 * i + 2]];
  const centroid = [0, 1, 2].map((d) => (vertices[d] + vertices[21 + d]) / 2);
  for (const face of FACES) {
    const [a, b, c] = face.map(vertex);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const side = (p: number[]) =>
      normal[0] * (p[0] - a[0]) + normal[1] * (p[1] - a[1]) + normal[2] * (p[2] - a[2]);
    // Points on the centroid's side of each face are inside.
    if (side(point) * side(centroid) < 0) {
      return false;
    }
  }
  return true;
}

function getMatrix(angles: [number, number, number], translation: [number, number, number]) {
  let matrix = M4x4.rotate(angles[0], [1, 0, 0], M4x4.identity(), []);
  matrix = M4x4.rotate(angles[1], [0, 1, 0], matrix, []);
  matrix = M4x4.rotate(angles[2], [0, 0, 1], matrix, []) as Matrix4x4;
  matrix[12] = translation[0];
  matrix[13] = translation[1];
  matrix[14] = translation[2];
  return matrix;
}

const MATRICES: Matrix4x4[] = [
  getMatrix([0, 0, Math.PI], [100, 100, 100]),
  getMatrix([Math.PI / 6, Math.PI / 9, Math.PI / 18], [100.3, 99.7, 100.5]),
  getMatrix([Math.PI / 4, 0, Math.PI / 4], [100, 100, 100]),
  getMatrix([1.1, 2.3, 0.7], [57.25, 80.5, 31.75]),
];

function toSortedKeys(buckets: Int32Array): string[] {
  const keys: string[] = [];
  for (let i = 0; i < buckets.length; i += 3) {
    keys.push(`${buckets[i]},${buckets[i + 1]},${buckets[i + 2]}`);
  }
  return keys.sort();
}

function getBoundingBox(vertices: Array<number>): { min: number[]; max: number[] } {
  return {
    min: [0, 1, 2].map((d) => Math.floor(Math.min(...vertices.filter((_, i) => i % 3 === d))) - 2),
    max: [0, 1, 2].map((d) => Math.ceil(Math.max(...vertices.filter((_, i) => i % 3 === d))) + 2),
  };
}

// All buckets that pass the exact overlap test, found by testing every bucket.
function bruteForce(vertices: Array<number>, edgeIndices: Array<number>): string[] {
  const overlaps = buildOverlapTest(vertices, edgeIndices);
  const { min, max } = getBoundingBox(vertices);
  const keys: string[] = [];
  for (let x = min[0]; x <= max[0]; x++) {
    for (let y = min[1]; y <= max[1]; y++) {
      for (let z = min[2]; z <= max[2]; z++) {
        if (overlaps(x, y, z)) {
          keys.push(`${x},${y},${z}`);
        }
      }
    }
  }
  return keys.sort();
}

describe("collectBucketsInConvexPolyhedron", () => {
  it("picks exactly the buckets of an axis-aligned cuboid", () => {
    // Spans buckets 1 to 3 (inclusive) in each dimension; buckets 0 and 4 only touch it.
    const cuboid = getSquareFrustum(3, 3, 0, 3, 3, 3);
    const vertices = M4x4.transformPointsAffine(
      getMatrix([0, 0, 0], [2.5, 2.5, 1]),
      cuboid.vertices,
    );
    const buckets = collectBucketsInConvexPolyhedron(vertices, cuboid.edgeIndices);
    expect(buckets.length / 3).toBe(27);
    for (let i = 0; i < buckets.length; i++) {
      expect(buckets[i]).toBeGreaterThanOrEqual(1);
      expect(buckets[i]).toBeLessThanOrEqual(3);
    }
  });

  MATRICES.forEach((matrix, index) => {
    it(`finds exactly the overlapping buckets (matrix ${index})`, () => {
      const vertices = getVertices(matrix);
      const found = toSortedKeys(collectBucketsInConvexPolyhedron(vertices, frustum.edgeIndices));
      expect(found).toEqual(bruteForce(vertices, frustum.edgeIndices));

      // Independent check of the overlap test: if a sample point inside a bucket lies inside
      // the frustum, the bucket overlaps it.
      const foundSet = new Set(found);
      const { min, max } = getBoundingBox(vertices);
      const steps = [0.1, 0.3, 0.5, 0.7, 0.9];
      const missedBySamples: string[] = [];
      for (let x = min[0]; x <= max[0]; x++) {
        for (let y = min[1]; y <= max[1]; y++) {
          for (let z = min[2]; z <= max[2]; z++) {
            const hit = steps.some((sx) =>
              steps.some((sy) => steps.some((sz) => isInside(vertices, [x + sx, y + sy, z + sz]))),
            );
            if (hit && !foundSet.has(`${x},${y},${z}`)) {
              missedBySamples.push(`${x},${y},${z}`);
            }
          }
        }
      }
      expect(missedBySamples).toEqual([]);
    });
  });

  it("finds exactly the overlapping buckets for random and degenerate frustum poses", () => {
    // Deterministic PRNG, so failures are reproducible.
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const specialAngles = [0, Math.PI / 4, Math.PI / 2, Math.PI];
    for (let i = 0; i < 300; i++) {
      // Half of the cases use special angles and (half-)integer positions, which create ties.
      const isSpecial = i % 2 === 0;
      const angle = () =>
        isSpecial
          ? specialAngles[Math.floor(random() * specialAngles.length)]
          : random() * 2 * Math.PI;
      const coordinate = () => (isSpecial ? 50 + Math.floor(random() * 8) / 2 : 50 + random() * 4);
      let matrix = getMatrix(
        [angle(), angle(), angle()],
        [coordinate(), coordinate(), coordinate()],
      );
      if (random() < 0.5) {
        matrix = M4x4.scale([1, 1, 11 / 24], matrix, []) as Matrix4x4;
      }
      const vertices = getVertices(matrix);
      const found = toSortedKeys(collectBucketsInConvexPolyhedron(vertices, frustum.edgeIndices));
      expect(found, `case ${i}`).toEqual(bruteForce(vertices, frustum.edgeIndices));
    }
  });
});
