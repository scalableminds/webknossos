import type * as THREE from "three";

class DisjointSet {
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

function traverseMST_DFS(mst: number[][], startIdx = 0): number[] {
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

export function orderPointsMST(points: THREE.Vector3[]): THREE.Vector3[] {
  if (points.length === 0) return [];

  const mst = computeMST(points);
  let bestOrder: number[] = [];
  let minLength = Number.POSITIVE_INFINITY;

  for (let startIdx = 0; startIdx < points.length; startIdx++) {
    const order = traverseMST_DFS(mst, startIdx);
    const length = computePathLength(points, order);

    if (length < minLength) {
      minLength = length;
      bestOrder = order;
    }
  }

  return bestOrder.map((index) => points[index]);
}

export function enforceConsistentDirection(points: THREE.Vector3[]): THREE.Vector3[] {
  if (points.length < 2) return points;

  const first = points[0];
  const last = points[points.length - 1];

  // Check if the curve follows top-left → bottom-right order
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const maxDelta = Math.abs(dx) > Math.abs(dy) ? dx : dy;

  if (maxDelta < 0) {
    // The curve is flipped (going bottom-right → top-left), so reverse it
    return points.reverse();
  }
  return points;
}
