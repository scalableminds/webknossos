/*
 * AgglomerateMapping is only used in tests, but its implementation
 * is explicitly tested here, too.
 */
import { AgglomerateMapping } from "test/helpers/agglomerate_mapping_helper";
import type { Vector2 } from "viewer/constants";
import { describe, expect, it } from "vitest";

const initialEdges: Vector2[] = [
  [1, 2], // {1, 2, 3}
  [2, 3],
  [4, 5], // {4, 5}
  [6, 7], // {6, 7}
];

describe("AgglomerateMapping", () => {
  it("Should construct a basic agglomerate mapping", () => {
    const agglomerateMapping = new AgglomerateMapping(initialEdges);

    expect(agglomerateMapping.mapSegment(1, 0)).toBe(1);
    expect(agglomerateMapping.mapSegment(2, 0)).toBe(1);
    expect(agglomerateMapping.mapSegment(3, 0)).toBe(1);

    expect(agglomerateMapping.mapSegment(4, 0)).toBe(4);
    expect(agglomerateMapping.mapSegment(5, 0)).toBe(4);

    expect(agglomerateMapping.mapSegment(6, 0)).toBe(6);
    expect(agglomerateMapping.mapSegment(7, 0)).toBe(6);
  });

  it("should perform multiple merges", () => {
    const agglomerateMapping = new AgglomerateMapping(initialEdges);

    // V1
    agglomerateMapping.addEdge(1, 4, true);
    expect(agglomerateMapping.mapSegment(1, 1)).toBe(1);
    expect(agglomerateMapping.mapSegment(4, 1)).toBe(1);
    expect(agglomerateMapping.mapSegment(5, 1)).toBe(1);

    // V2
    agglomerateMapping.addEdge(7, 5, true);
    for (const id of [1, 2, 3, 4, 5, 6, 7]) {
      expect(agglomerateMapping.mapSegment(id, 2)).toBe(6);
    }
  });

  it("should perform multiple splits", () => {
    const agglomerateMapping = new AgglomerateMapping(initialEdges);

    // V1
    agglomerateMapping.removeEdge(1, 2, true);
    expect(agglomerateMapping.mapSegment(1, 1)).toBe(1);
    expect(agglomerateMapping.mapSegment(2, 1)).toBe(8);
    expect(agglomerateMapping.mapSegment(3, 1)).toBe(8);

    // V2
    agglomerateMapping.removeEdge(6, 7, true);
    expect(agglomerateMapping.mapSegment(6, 2)).toBe(6);
    expect(agglomerateMapping.mapSegment(7, 2)).toBe(9);

    // V3
    agglomerateMapping.removeEdge(2, 3, true);
    expect(agglomerateMapping.mapSegment(1, 3)).toBe(1);
    expect(agglomerateMapping.mapSegment(2, 3)).toBe(8);
    expect(agglomerateMapping.mapSegment(3, 3)).toBe(10);
  });

  it("should perform multiple splits and merges", () => {
    const agglomerateMapping = new AgglomerateMapping(initialEdges);

    // V1
    agglomerateMapping.removeEdge(1, 2, true);
    expect(agglomerateMapping.mapSegment(1, 1)).toBe(1);
    expect(agglomerateMapping.mapSegment(2, 1)).toBe(8);
    expect(agglomerateMapping.mapSegment(3, 1)).toBe(8);

    // V2
    agglomerateMapping.addEdge(7, 1, true);
    expect(agglomerateMapping.mapSegment(1, 2)).toBe(6);
    expect(agglomerateMapping.mapSegment(2, 2)).toBe(8);
    expect(agglomerateMapping.mapSegment(6, 2)).toBe(6);
    expect(agglomerateMapping.mapSegment(7, 2)).toBe(6);

    // V3
    agglomerateMapping.addEdge(2, 6, true);
    expect(agglomerateMapping.mapSegment(2, 3)).toBe(8);
    expect(agglomerateMapping.mapSegment(3, 3)).toBe(8);
    expect(agglomerateMapping.mapSegment(6, 3)).toBe(8);
    expect(agglomerateMapping.mapSegment(7, 3)).toBe(8);

    agglomerateMapping.removeEdge(6, 7, true);
    expect(agglomerateMapping.mapSegment(6, 4)).toBe(8);
    expect(agglomerateMapping.mapSegment(2, 4)).toBe(8);
    expect(agglomerateMapping.mapSegment(3, 4)).toBe(8);
    expect(agglomerateMapping.mapSegment(1, 4)).toBe(9);
    expect(agglomerateMapping.mapSegment(7, 4)).toBe(9);
  });

  it("shouldn't perform a split if a component is still connected", () => {
    const agglomerateMapping = new AgglomerateMapping([
      [6, 7],
      [1337, 6],
      [1337, 7],
      [1337, 1338],
    ]);

    // V0 and V1 (still not connected)
    agglomerateMapping.removeEdge(1337, 7, true);
    for (const version of [0, 1]) {
      expect(agglomerateMapping.mapSegment(6, version)).toBe(1337);
      expect(agglomerateMapping.mapSegment(7, version)).toBe(1337);
      expect(agglomerateMapping.mapSegment(1337, version)).toBe(1337);
      expect(agglomerateMapping.mapSegment(1338, version)).toBe(1337);
    }

    // V2
    agglomerateMapping.removeEdge(1337, 6, true); // source component will keep its agglomerate id
    expect(agglomerateMapping.mapSegment(1337, 2)).toBe(1337);
    expect(agglomerateMapping.mapSegment(1338, 2)).toBe(1337);
    expect(agglomerateMapping.mapSegment(6, 2)).toBe(1339);
    expect(agglomerateMapping.mapSegment(7, 2)).toBe(1339);
  });
});
