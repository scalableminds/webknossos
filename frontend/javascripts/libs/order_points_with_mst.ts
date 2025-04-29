import type * as THREE from "three";

export function orderPointsWithMST(points: THREE.Vector3[]): THREE.Vector3[] {
  /*
   * Find the order of points with the shortest distance heuristically.
   * This is done by computing the MST of the points and then traversing
   * that MST several times (each node is tried as the starting point).
   * The shortest order wins.
   */
  if (points.length === 0) return [];

  const mst = computeMST(points);
  let bestOrder: number[] = [];
  let minLength = Number.POSITIVE_INFINITY;

  for (let startIdx = 0; startIdx < points.length; startIdx++) {
    const order = traverseMstDfs(mst, startIdx);
    const length = computePathLength(points, order);

    if (length < minLength) {
      minLength = length;
      bestOrder = order;
    }
  }

  return bestOrder.map((index) => points[index]);
}

// Mostly generated with ChatGPT (treat with care):

class DisjointSet {
  // Union find datastructure
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = Array(n).fill(0);
  }

  find(i: number): number {
    if (this.parent[i] !== i) this.parent[i] = this.find(this.parent[i]);
    return this.parent[i];
  }

  union(i: number, j: number): void {
    let rootI = this.find(i),
      rootJ = this.find(j);
    if (rootI !== rootJ) {
      if (this.rank[rootI] > this.rank[rootJ]) this.parent[rootJ] = rootI;
      else if (this.rank[rootI] < this.rank[rootJ]) this.parent[rootI] = rootJ;
      else {
        this.parent[rootJ] = rootI;
        this.rank[rootI]++;
      }
    }
  }
}

interface Edge {
  i: number;
  j: number;
  dist: number;
}

function computeMST(points: THREE.Vector3[]): number[][] {
  const edges: Edge[] = [];
  const numPoints = points.length;

  // Create all possible edges with distances
  for (let i = 0; i < numPoints; i++) {
    for (let j = i + 1; j < numPoints; j++) {
      const dist = points[i].distanceTo(points[j]);
      edges.push({ i, j, dist });
    }
  }

  // Sort edges by distance (Kruskal's Algorithm)
  edges.sort((a, b) => a.dist - b.dist);

  // Compute MST using Kruskal’s Algorithm
  const ds = new DisjointSet(numPoints);
  const mst: number[][] = Array.from({ length: numPoints }, () => []);

  for (const { i, j } of edges) {
    if (ds.find(i) !== ds.find(j)) {
      ds.union(i, j);
      mst[i].push(j);
      mst[j].push(i);
    }
  }

  return mst;
}

function traverseMstDfs(mst: number[][], startIdx = 0): number[] {
  const visited = new Set<number>();
  const orderedPoints: number[] = [];

  function dfs(node: number) {
    if (visited.has(node)) return;
    visited.add(node);
    orderedPoints.push(node);
    for (let neighbor of mst[node]) {
      dfs(neighbor);
    }
  }

  dfs(startIdx);
  return orderedPoints;
}

function computePathLength(points: THREE.Vector3[], order: number[]): number {
  let length = 0;
  for (let i = 0; i < order.length - 1; i++) {
    length += points[order[i]].distanceTo(points[order[i + 1]]);
  }
  return length;
}
