import cloneDeep from "lodash-es/cloneDeep";
import uniq from "lodash-es/uniq";

type VersionSnapshot = {
  map: Map<number, number>;
  adjacencyList: Map<number, Set<number>>;
};

export function serializeAdjacencyList(map: Map<number, Set<number>>): string {
  return JSON.stringify([...map.entries()].map(([key, set]) => [key, [...set]]));
}

export class AgglomerateMapping {
  /*
   * This class is used to mock the backend in the proofreading
   * tests. The class maintains an agglomerate mapping which consists
   * of segment ids (nodes) and edges. The components in that graph
   * define to which agglomerate ids segment ids are mapped.
   * The class supports adding and removing edges. Each operation
   * creates a new version so that map requests can be paramaterized
   * with the version.
   */

  public segmentIds: number[];

  // snapshot of (component-ID map + adjacency list) after every operation
  // versions[0] = initial state
  private versions: VersionSnapshot[] = [];

  public currentVersion = -1; // newest version index
  private largestMappedId: number; // monotone counter for fresh IDs

  constructor(
    public readonly edges: Array<[number, number]>,
    initialVersion: number = 0,
  ) {
    this.segmentIds = uniq(edges.flat());
    this.largestMappedId = Math.max(...this.segmentIds);

    const initialAdjacencyList = new Map<number, Set<number>>();
    const initialVersionMap = new Map<number, number>();

    for (const segmentId of this.segmentIds) {
      initialAdjacencyList.set(segmentId, new Set());
      initialVersionMap.set(segmentId, segmentId); // each segment is its own component at v0
    }

    this.commit(
      {
        map: initialVersionMap,
        adjacencyList: initialAdjacencyList,
      },
      true,
    );

    for (const [a, b] of edges) {
      this.addEdge(a, b, true);
    }

    this.resetVersionCounter(initialVersion);
  }

  addEdge(segmentIdA: number, segmentIdB: number, bumpVersion: boolean): void {
    /*
     * Add an edge and record the new version. All segment ids
     * that are present in the component defined by segmentIdB
     * are remapped to the mapped id of segmentIdA.
     */
    const previous = this.versions[this.currentVersion];
    this.ensureNode(segmentIdA, previous.adjacencyList);
    this.ensureNode(segmentIdB, previous.adjacencyList);

    // copy adjacency list (shallow)
    const nextAdjacencyList = new Map<number, Set<number>>();
    for (const [k, v] of previous.adjacencyList) {
      nextAdjacencyList.set(k, new Set(v));
    }

    nextAdjacencyList.get(segmentIdA)!.add(segmentIdB);

    const previousVersionMap = previous.map;
    const nextVersionMap = new Map(previousVersionMap); // copy-on-write

    const componentIdA = previousVersionMap.get(segmentIdA)!;
    const componentIdB = previousVersionMap.get(segmentIdB)!;

    // Only merge if the components differ
    if (componentIdA !== componentIdB) {
      for (const [segmentId, componentId] of nextVersionMap) {
        if (componentId === componentIdB) {
          nextVersionMap.set(segmentId, componentIdA);
        }
      }
    }

    this.commit(
      {
        map: nextVersionMap,
        adjacencyList: nextAdjacencyList,
      },
      bumpVersion,
    );
  }

  removeEdge(segmentIdA: number, segmentIdB: number, bumpVersion: boolean): void {
    /*
     * Remove an edge, possibly splitting a component, and record the new version.
     * The source component (defined by segmentIdA) will keep its mapped id.
     * The target component is reassigned to a new id.
     */
    const previous = this.versions[this.currentVersion];
    // copy adjacency list (shallow)
    const nextAdjacencyList = new Map<number, Set<number>>();
    for (const [k, v] of previous.adjacencyList) {
      nextAdjacencyList.set(k, new Set(v));
    }

    let didRemove = false;
    if (previous.adjacencyList.has(segmentIdA)) {
      didRemove = nextAdjacencyList.get(segmentIdA)!.delete(segmentIdB);
    }
    if (previous.adjacencyList.has(segmentIdB)) {
      didRemove = nextAdjacencyList.get(segmentIdB)!.delete(segmentIdA) || didRemove;
    }

    if (!didRemove) {
      // Commit the current version again.
      this.commit(this.versions.at(-1)!, bumpVersion);
      return;
    }

    const previousVersionMap = previous.map;
    const keepComponentId = previousVersionMap.get(segmentIdA)!;

    const nextVersionMap = new Map<number, number>();
    const visitedSegmentIds = new Set<number>();

    for (const startSegmentId of this.segmentIds) {
      if (visitedSegmentIds.has(startSegmentId)) continue;

      // BFS to collect this component
      const bfsStack = [startSegmentId];
      const componentSegmentIds: number[] = [];
      visitedSegmentIds.add(startSegmentId);

      while (bfsStack.length) {
        const currentSegmentId = bfsStack.pop()!;
        componentSegmentIds.push(currentSegmentId);

        // Get neighbors in both directions (outgoing and incoming edges)
        const neighbors = new Set<number>();
        // Outgoing edges
        for (const neighbor of nextAdjacencyList.get(currentSegmentId) ?? []) {
          neighbors.add(neighbor);
        }
        // Incoming edges
        for (const [segmentId, adjacentSet] of nextAdjacencyList) {
          if (adjacentSet.has(currentSegmentId)) {
            neighbors.add(segmentId);
          }
        }

        for (const neighbor of neighbors) {
          if (!visitedSegmentIds.has(neighbor)) {
            visitedSegmentIds.add(neighbor);
            bfsStack.push(neighbor);
          }
        }
      }

      let newComponentId: number;

      if (
        componentSegmentIds.some(
          (segmentId) => previousVersionMap.get(segmentId) !== previousVersionMap.get(segmentIdA),
        )
      ) {
        // unrelated component → keep previous IDs
        for (const segmentId of componentSegmentIds) {
          nextVersionMap.set(segmentId, previousVersionMap.get(segmentId)!);
        }
        continue;
      } else if (componentSegmentIds.includes(segmentIdA)) {
        // component containing A keeps its ID
        newComponentId = keepComponentId;
      } else {
        // split-off component → new ID
        newComponentId = ++this.largestMappedId;
      }

      for (const segmentId of componentSegmentIds) {
        nextVersionMap.set(segmentId, newComponentId);
      }
    }

    this.commit(
      {
        map: nextVersionMap,
        adjacencyList: nextAdjacencyList,
      },
      bumpVersion,
    );
  }

  mapSegment(segmentId: number, version: number): number {
    /*
     * Look up the component-ID of `segmentId` at an arbitrary version.
     */
    const snapshot = this.getSnapshot(version);
    const componentId = snapshot.map.get(segmentId);
    if (componentId === undefined) {
      throw new Error("Unknown segmentId");
    }
    return componentId;
  }

  getMap(version: number): Map<number, number> {
    /*
     * Get the entire mapping for a specific version.
     */
    return this.getSnapshot(version).map;
  }

  getAdjacencyList(version: number): Map<number, Set<number>> {
    /*
     * Get the adjacency list for a specific version.
     * It is a deep clone to avoid direct manipulation from outside.
     */
    return cloneDeep(this.getSnapshot(version).adjacencyList);
  }

  private getSnapshot(version: number): VersionSnapshot {
    if (version == null || version < 0 || version > this.currentVersion) {
      throw new RangeError(`Invalid version: ${version}`);
    }
    return this.versions[version];
  }

  private resetVersionCounter(initialVersion: number) {
    /*
     * Reset the most recent version to be stored as version `initialVersion`.
     * If `initialVersion` is greater than 0, all previous versions are set to the
     * newest version.
     */
    const newest = this.versions.at(-1);
    if (newest == null) {
      throw new Error("No initial version of map found.");
    }

    this.versions = Array.from({ length: initialVersion + 1 }, () => newest);
    this.currentVersion = initialVersion;
  }

  bumpVersion() {
    /*
     * Increment the version even though nothing changed (necessary
     * because the backend also stores other things than the agglomerate mapping
     * in the annotation).
     */
    const newest = this.versions.at(-1);
    if (newest == null) {
      throw new Error("No initial version of map found.");
    }
    this.commit(newest, true);
  }

  /* Helpers */

  private ensureNode(segmentId: number, adjacencyList: Map<number, Set<number>>): void {
    if (!adjacencyList.has(segmentId)) {
      throw new Error(`Segment ${segmentId} was not in the original set`);
    }
  }

  private commit(snapshot: VersionSnapshot, bumpVersion: boolean): void {
    /*
     * Push snapshot and advance the global version counter
     */
    if (bumpVersion) {
      this.currentVersion++;
      this.versions.push(snapshot);
      // console.log(
      //   `Committed v=${this.currentVersion} with mapping: `,
      //   // snapshot.entries().toArray(),
      // );
    } else {
      this.versions[this.currentVersion] = snapshot;
      // console.log(
      //   `Appended new update to v=${this.currentVersion}; resulting mapping: `,
      //   // snapshot.entries().toArray(),
      // );
    }
  }
}
