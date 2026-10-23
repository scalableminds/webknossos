import { mergeGeometries } from "libs/BufferGeometryUtils";
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import {
  type UnmergedBufferGeometryWithInfo,
  unifyNormalsAtChunkBorders,
} from "viewer/controller/mesh_helpers";
import { describe, expect, it } from "vitest";

function createChunk(
  positions: number[],
  unmappedSegmentId: bigint,
): UnmergedBufferGeometryWithInfo {
  const geometry = new BufferGeometry() as UnmergedBufferGeometryWithInfo;
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometry.computeVertexNormals();
  geometry.unmappedSegmentId = unmappedSegmentId;
  return geometry;
}

function merge(chunks: UnmergedBufferGeometryWithInfo[]) {
  const merged = mergeGeometries(chunks, false);
  if (merged == null) throw new Error("Merging the chunks failed.");
  return merged;
}

function getNormal(geometry: BufferGeometry, vertex: number) {
  return new Vector3().fromBufferAttribute(geometry.attributes.normal as BufferAttribute, vertex);
}

describe("unifyNormalsAtChunkBorders", () => {
  // Two chunks of a surface that bends at x=1: chunk A is tilted (z=x), chunk B is
  // flat (z=1). They share the border vertices (1, 0, 1) and (1, 1, 1).
  const chunkA = () => createChunk([0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1], 1n);
  const chunkB = () => createChunk([1, 0, 1, 2, 0, 1, 1, 1, 1, 2, 1, 1], 1n);

  it("should give border vertices of neighboring chunks the same normal", () => {
    const chunks = [chunkA(), chunkB()];
    const merged = merge(chunks);
    // Before: the copies of the border vertex have their chunk's normals.
    expect(getNormal(merged, 1).distanceTo(getNormal(merged, 4))).toBeGreaterThan(0.1);

    unifyNormalsAtChunkBorders(merged, chunks);

    for (const [vertexInA, vertexInB] of [
      [1, 4],
      [3, 6],
    ]) {
      const normalA = getNormal(merged, vertexInA);
      const normalB = getNormal(merged, vertexInB);
      expect(normalA.distanceTo(normalB)).toBeLessThan(1e-6);
      expect(normalA.length()).toBeCloseTo(1);
      // The unified normal lies between the tilted (-1, 0, 1) and the flat (0, 0, 1) normal.
      expect(normalA.x).toBeLessThan(0);
      expect(normalA.x).toBeGreaterThan(-Math.SQRT1_2);
      expect(normalA.y).toBeCloseTo(0);
    }

    // Vertices that only exist in one chunk keep the normal computed for that chunk.
    expect(getNormal(merged, 0).distanceTo(getNormal(chunks[0], 0))).toBeLessThan(1e-6);
    expect(getNormal(merged, 5).distanceTo(getNormal(chunks[1], 1))).toBeLessThan(1e-6);
  });

  it("should treat border vertices as identical despite float rounding differences", () => {
    // Shift the border vertices of chunk B by less than the tolerance, so that their
    // copies straddle any (rounded) grid boundary.
    const offset = 3e-5;
    const chunks = [
      chunkA(),
      createChunk([1 + offset, 0, 1 - offset, 2, 0, 1, 1 + offset, 1, 1 - offset, 2, 1, 1], 1n),
    ];
    const merged = merge(chunks);
    unifyNormalsAtChunkBorders(merged, chunks);

    expect(getNormal(merged, 1).distanceTo(getNormal(merged, 4))).toBeLessThan(1e-6);
    expect(getNormal(merged, 3).distanceTo(getNormal(merged, 6))).toBeLessThan(1e-6);
  });

  it("should not unify normals of different unmapped segments", () => {
    const otherSegmentChunk = createChunk([1, 0, 1, 2, 0, 1, 1, 1, 1, 2, 1, 1], 2n);
    const chunks = [chunkA(), otherSegmentChunk];
    const merged = merge(chunks);
    unifyNormalsAtChunkBorders(merged, chunks);

    expect(getNormal(merged, 1).distanceTo(getNormal(chunks[0], 1))).toBeLessThan(1e-6);
    expect(getNormal(merged, 4).distanceTo(getNormal(chunks[1], 0))).toBeLessThan(1e-6);
  });
});
