/*
 * AgglomerateMapping is only used in tests, but its implementation
 * is explicitly tested here, too.
 */
import { AgglomerateMapping } from "test/helpers/agglomerate_mapping_helper";
import { describe, expect, it } from "vitest";

const initialEdges: Array<[bigint, bigint]> = [
  [1n, 2n], // {1, 2, 3}
  [2n, 3n],
  [4n, 5n], // {4, 5}
  [6n, 7n], // {6, 7}
];

describe("AgglomerateMapping", () => {
  it("Should construct a basic agglomerate mapping", () => {
    const agglomerateMapping = new AgglomerateMapping(initialEdges);

    expect(agglomerateMapping.mapSegment(1n, 0)).toBe(1n);
    expect(agglomerateMapping.mapSegment(2n, 0)).toBe(1n);
    expect(agglomerateMapping.mapSegment(3n, 0)).toBe(1n);

    expect(agglomerateMapping.mapSegment(4n, 0)).toBe(4n);
    expect(agglomerateMapping.mapSegment(5n, 0)).toBe(4n);

    expect(agglomerateMapping.mapSegment(6n, 0)).toBe(6n);
    expect(agglomerateMapping.mapSegment(7n, 0)).toBe(6n);
  });

  it("should perform multiple merges", () => {
    const agglomerateMapping = new AgglomerateMapping(initialEdges);

    // V1
    agglomerateMapping.addEdge(1n, 4n, true);
    expect(agglomerateMapping.mapSegment(1n, 1)).toBe(1n);
    expect(agglomerateMapping.mapSegment(4n, 1)).toBe(1n);
    expect(agglomerateMapping.mapSegment(5n, 1)).toBe(1n);

    // V2
    agglomerateMapping.addEdge(7n, 5n, true);
    for (const id of [1n, 2n, 3n, 4n, 5n, 6n, 7n]) {
      expect(agglomerateMapping.mapSegment(id, 2)).toBe(6n);
    }
  });

  it("should perform multiple splits", () => {
    const agglomerateMapping = new AgglomerateMapping(initialEdges);

    // V1
    agglomerateMapping.removeEdge(1n, 2n, true);
    expect(agglomerateMapping.mapSegment(1n, 1)).toBe(1n);
    expect(agglomerateMapping.mapSegment(2n, 1)).toBe(8n);
    expect(agglomerateMapping.mapSegment(3n, 1)).toBe(8n);

    // V2
    agglomerateMapping.removeEdge(6n, 7n, true);
    expect(agglomerateMapping.mapSegment(6n, 2)).toBe(6n);
    expect(agglomerateMapping.mapSegment(7n, 2)).toBe(9n);

    // V3
    agglomerateMapping.removeEdge(2n, 3n, true);
    expect(agglomerateMapping.mapSegment(1n, 3)).toBe(1n);
    expect(agglomerateMapping.mapSegment(2n, 3)).toBe(8n);
    expect(agglomerateMapping.mapSegment(3n, 3)).toBe(10n);
  });

  it("should perform multiple splits and merges", () => {
    const agglomerateMapping = new AgglomerateMapping(initialEdges);

    // V1
    agglomerateMapping.removeEdge(1n, 2n, true);
    expect(agglomerateMapping.mapSegment(1n, 1)).toBe(1n);
    expect(agglomerateMapping.mapSegment(2n, 1)).toBe(8n);
    expect(agglomerateMapping.mapSegment(3n, 1)).toBe(8n);

    // V2
    agglomerateMapping.addEdge(7n, 1n, true);
    expect(agglomerateMapping.mapSegment(1n, 2)).toBe(6n);
    expect(agglomerateMapping.mapSegment(2n, 2)).toBe(8n);
    expect(agglomerateMapping.mapSegment(6n, 2)).toBe(6n);
    expect(agglomerateMapping.mapSegment(7n, 2)).toBe(6n);

    // V3
    agglomerateMapping.addEdge(2n, 6n, true);
    expect(agglomerateMapping.mapSegment(2n, 3)).toBe(8n);
    expect(agglomerateMapping.mapSegment(3n, 3)).toBe(8n);
    expect(agglomerateMapping.mapSegment(6n, 3)).toBe(8n);
    expect(agglomerateMapping.mapSegment(7n, 3)).toBe(8n);

    agglomerateMapping.removeEdge(6n, 7n, true);
    expect(agglomerateMapping.mapSegment(6n, 4)).toBe(8n);
    expect(agglomerateMapping.mapSegment(2n, 4)).toBe(8n);
    expect(agglomerateMapping.mapSegment(3n, 4)).toBe(8n);
    expect(agglomerateMapping.mapSegment(1n, 4)).toBe(9n);
    expect(agglomerateMapping.mapSegment(7n, 4)).toBe(9n);
  });

  it("shouldn't perform a split if a component is still connected", () => {
    const agglomerateMapping = new AgglomerateMapping([
      [6n, 7n],
      [1337n, 6n],
      [1337n, 7n],
      [1337n, 1338n],
    ]);

    // V0 and V1 (still not connected)
    agglomerateMapping.removeEdge(1337n, 7n, true);
    for (const version of [0, 1]) {
      expect(agglomerateMapping.mapSegment(6n, version)).toBe(1337n);
      expect(agglomerateMapping.mapSegment(7n, version)).toBe(1337n);
      expect(agglomerateMapping.mapSegment(1337n, version)).toBe(1337n);
      expect(agglomerateMapping.mapSegment(1338n, version)).toBe(1337n);
    }

    // V2
    agglomerateMapping.removeEdge(1337n, 6n, true); // source component will keep its agglomerate id
    expect(agglomerateMapping.mapSegment(1337n, 2)).toBe(1337n);
    expect(agglomerateMapping.mapSegment(1338n, 2)).toBe(1337n);
    expect(agglomerateMapping.mapSegment(6n, 2)).toBe(1339n);
    expect(agglomerateMapping.mapSegment(7n, 2)).toBe(1339n);
  });
});
