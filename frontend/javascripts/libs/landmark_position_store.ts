import type { Vector3 } from "viewer/constants";

export type NodeSnapshot = {
  nodeId: number;
  treeId: number;
  position: Vector3;
};

export class LandmarkPositionStore {
  private readonly snapshots = new Map<string, NodeSnapshot[]>();

  snapshot(layerName: string, items: NodeSnapshot[]): void {
    this.snapshots.set(layerName, items);
  }

  get(layerName: string): NodeSnapshot[] | undefined {
    return this.snapshots.get(layerName);
  }

  discard(layerName: string): void {
    this.snapshots.delete(layerName);
  }
}
