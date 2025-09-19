import _ from "lodash";

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

  // adjacency list of the *current* graph (edges themselves are *not* versioned)
  private readonly adjacencyList = new Map<number, Set<number>>();

  // snapshot of the component‑ID map after every operation, versions[0] = initial state
  private versions: Array<Map<number, number>> = [];

  public currentVersion = -1; // newest version index
  private largestMappedId: number; // monotone counter for fresh IDs

  constructor(
    public readonly edges: Array<[number, number]>,
    initialVersion: number = 0,
  ) {
    this.segmentIds = _.uniq(edges.flat());

    this.largestMappedId = Math.max(...this.segmentIds);
    const initialVersionMap = new Map<number, number>();
    for (const segmentId of this.segmentIds) {
      this.adjacencyList.set(segmentId, new Set());
      initialVersionMap.set(segmentId, segmentId); // each segment is its own component at v0
    }
    this.commit(initialVersionMap);

    for (const edge of edges) {
      this.addEdge(edge[0], edge[1]);
    }

    this.resetVersionCounter(initialVersion);
  }

  addEdge(segmentIdA: number, segmentIdB: number): void {
    /*
     * Add an edge and record the new version. All segment ids
     * that are present in the component defined by segmentIdB
     * are remapped to the mapped id of segmentIdA.
     */
    this.ensureNode(segmentIdA);
    this.ensureNode(segmentIdB);
    this.adjacencyList.get(segmentIdA)!.add(segmentIdB);
    this.adjacencyList.get(segmentIdB)!.add(segmentIdA);

    const previousVersionMap = this.versions[this.currentVersion];
    const nextVersionMap = new Map(previousVersionMap); // shallow copy for copy‑on‑write
    const componentIdA = previousVersionMap.get(segmentIdA)!;
    const componentIdB = previousVersionMap.get(segmentIdB)!;

    // Only merge if the components differ
    if (componentIdA !== componentIdB) {
      for (const [segmentId, componentId] of nextVersionMap) {
        if (componentId === componentIdB) nextVersionMap.set(segmentId, componentIdA);
      }
    }

    this.commit(nextVersionMap);
  }

  removeEdge(segmentIdA: number, segmentIdB: number): void {
    /*
     * Remove an edge, possibly splitting a component, and record the new version.
     * The source component (defined by segmentIdA) will keep its mapped id.
     * The target component is reassigned to a new id.
     */
    this.ensureNode(segmentIdA);
    this.ensureNode(segmentIdB);
    this.adjacencyList.get(segmentIdA)!.delete(segmentIdB);
    this.adjacencyList.get(segmentIdB)!.delete(segmentIdA);

    console.log("removing edge", segmentIdA, segmentIdB);

    const previousVersionMap = this.versions[this.currentVersion];
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
        for (const neighborSegmentId of this.adjacencyList.get(currentSegmentId) ?? []) {
          if (!visitedSegmentIds.has(neighborSegmentId)) {
            visitedSegmentIds.add(neighborSegmentId);
            bfsStack.push(neighborSegmentId);
          }
        }
      }

      // Determine the ID to assign:
      let newComponentId: number;
      if (
        componentSegmentIds.some(
          (segmentId) => previousVersionMap.get(segmentId) !== previousVersionMap.get(segmentIdA),
        )
      ) {
        // Unrelated component → keep previous IDs
        for (const segmentId of componentSegmentIds) {
          nextVersionMap.set(segmentId, previousVersionMap.get(segmentId)!);
        }
        continue;
      } else if (componentSegmentIds.includes(segmentIdA)) {
        // Component that includes `segmentIdA` keeps its ID
        newComponentId = keepComponentId;
      } else {
        // New component → assign fresh ID
        newComponentId = ++this.largestMappedId;
      }

      for (const segmentId of componentSegmentIds) {
        nextVersionMap.set(segmentId, newComponentId);
      }
    }

    this.commit(nextVersionMap);
  }

  mapSegment(segmentId: number, version: number): number {
    /*
     * Look up the component‑ID of `segmentId` at an arbitrary version.
     */
    const versionMap = this.getMap(version);
    const componentId = versionMap.get(segmentId);
    if (componentId === undefined) throw new Error("Unknown segmentId");
    return componentId;
  }

  getMap(version: number): Map<number, number> {
    /*
     * Get the entire mapping for a specific version.
     */
    if (version == null || version < 0 || version > this.currentVersion)
      throw new RangeError(`Invalid version: ${version}`);
    return this.versions[version];
  }

  private resetVersionCounter(initialVersion: number) {
    /*
     * Reset the most recent version to be stored as version `initialVersion`.
     * If `initialVersion` is greater than 0, all previous versions are set to the
     * newest version.
     */
    const newestMap = this.versions.at(-1);
    if (newestMap == null) {
      throw new Error("No initial version of map found.");
    }
    this.versions = Array.from({ length: initialVersion + 1 }, () => newestMap);
    this.currentVersion = initialVersion;
  }

  bumpVersion() {
    /*
     * Increment the version even though nothing changed (necessary
     * because the backend also stores other things than the agglomerate mapping
     * in the annotation).
     */
    const newestMap = this.versions.at(-1);
    if (newestMap == null) {
      throw new Error("No initial version of map found.");
    }
    this.commit(newestMap);
  }

  /* Helpers */

  private ensureNode(segmentId: number): void {
    if (!this.adjacencyList.has(segmentId)) {
      throw new Error(`Segment ${segmentId} was not in the original set`);
    }
  }

  private commit(newVersionMap: Map<number, number>): void {
    /*
     * Mush mapping snapshot and advance the global version counter
     */
    this.versions.push(newVersionMap);
    this.currentVersion++;
    console.log(
      `Committed v=${this.currentVersion} with mapping: `,
      newVersionMap.entries().toArray(),
    );
  }
}
