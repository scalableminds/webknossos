import type { Vector3 } from "viewer/constants";

export type NodeSnapshot = {
  nodeId: number;
  treeId: number;
  position: Vector3;
};

const store = new Map<string, NodeSnapshot[]>();

export function snapshotLandmarkPositions(layerName: string, snapshots: NodeSnapshot[]): void {
  store.set(layerName, snapshots);
}

export function getLandmarkSnapshot(layerName: string): NodeSnapshot[] | undefined {
  return store.get(layerName);
}

export function discardLandmarkSnapshot(layerName: string): void {
  store.delete(layerName);
}
