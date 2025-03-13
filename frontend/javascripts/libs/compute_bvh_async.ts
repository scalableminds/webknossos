import type { MeshBVH } from "three-mesh-bvh";
// @ts-ignore
import { GenerateMeshBVHWorker } from "three-mesh-bvh/src/workers/GenerateMeshBVHWorker";

const bvhWorker = new GenerateMeshBVHWorker();
const bvhQueue: Array<{
  geometry: THREE.BufferGeometry;
  resolve: (bvh: MeshBVH) => void;
  reject: (error: unknown) => void;
}> = [];
let processing = false;

async function processBvhQueue() {
  if (processing || bvhQueue.length === 0) return;
  processing = true;

  const item = bvhQueue.shift();
  if (item == null) {
    throw new Error("Unexpected null value even though bvhQueue.length > 0");
  }
  const { geometry, resolve, reject } = item;
  try {
    const bvh = await bvhWorker.generate(geometry);
    resolve(bvh);
  } catch (error) {
    console.error("BVH generation failed", error);
    reject(error);
  } finally {
    processing = false;
    processBvhQueue(); // Process the next item in the queue
  }
}

export async function computeBvhAsync(geometry: THREE.BufferGeometry): Promise<MeshBVH> {
  return new Promise((resolve, reject) => {
    bvhQueue.push({ geometry, resolve, reject });
    processBvhQueue();
  });
}
