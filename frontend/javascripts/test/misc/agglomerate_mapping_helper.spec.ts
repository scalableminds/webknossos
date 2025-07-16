/*
 * AgglomerateMapping is only used in tests, but its implementation
 * is explicitly tested here, too.
 */
import { AgglomerateMapping } from "test/helpers/agglomerate_mapping_helper";
import { describe, expect, it } from "vitest";

const initialEdges = [
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
    agglomerateMapping.addEdge(1, 4);
    expect(agglomerateMapping.mapSegment(1, 1)).toBe(1);
    expect(agglomerateMapping.mapSegment(4, 1)).toBe(1);
    expect(agglomerateMapping.mapSegment(5, 1)).toBe(1);

    // V2
    agglomerateMapping.addEdge(7, 5);
    for (const id of [1, 2, 3, 4, 5, 6, 7]) {
      expect(agglomerateMapping.mapSegment(id, 2)).toBe(6);
    }
  });

  it("should perform multiple splits", () => {
    const agglomerateMapping = new AgglomerateMapping(initialEdges);

    // V1
    agglomerateMapping.removeEdge(1, 2);
    expect(agglomerateMapping.mapSegment(1, 1)).toBe(1);
    expect(agglomerateMapping.mapSegment(2, 1)).toBe(8);
    expect(agglomerateMapping.mapSegment(3, 1)).toBe(8);

    // V2
    agglomerateMapping.removeEdge(6, 7);
    expect(agglomerateMapping.mapSegment(6, 2)).toBe(6);
    expect(agglomerateMapping.mapSegment(7, 2)).toBe(9);

    // V3
    agglomerateMapping.removeEdge(2, 3);
    expect(agglomerateMapping.mapSegment(1, 3)).toBe(1);
    expect(agglomerateMapping.mapSegment(2, 3)).toBe(8);
    expect(agglomerateMapping.mapSegment(3, 3)).toBe(10);
  });

  it("should perform multiple splits and merges", () => {
    const agglomerateMapping = new AgglomerateMapping(initialEdges);

    // V1
    agglomerateMapping.removeEdge(1, 2);
    expect(agglomerateMapping.mapSegment(1, 1)).toBe(1);
    expect(agglomerateMapping.mapSegment(2, 1)).toBe(8);
    expect(agglomerateMapping.mapSegment(3, 1)).toBe(8);

    // V2
    agglomerateMapping.addEdge(7, 1);
    expect(agglomerateMapping.mapSegment(1, 2)).toBe(6);
    expect(agglomerateMapping.mapSegment(2, 2)).toBe(8);
    expect(agglomerateMapping.mapSegment(6, 2)).toBe(6);
    expect(agglomerateMapping.mapSegment(7, 2)).toBe(6);

    // V3
    agglomerateMapping.addEdge(2, 6);
    expect(agglomerateMapping.mapSegment(2, 3)).toBe(8);
    expect(agglomerateMapping.mapSegment(3, 3)).toBe(8);
    expect(agglomerateMapping.mapSegment(6, 3)).toBe(8);
    expect(agglomerateMapping.mapSegment(7, 3)).toBe(8);

    agglomerateMapping.removeEdge(6, 7);
    expect(agglomerateMapping.mapSegment(6, 4)).toBe(8);
    expect(agglomerateMapping.mapSegment(2, 4)).toBe(8);
    expect(agglomerateMapping.mapSegment(3, 4)).toBe(8);
    expect(agglomerateMapping.mapSegment(1, 4)).toBe(9);
    expect(agglomerateMapping.mapSegment(7, 4)).toBe(9);
  });
});
