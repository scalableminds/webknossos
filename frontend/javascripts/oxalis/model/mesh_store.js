// @flow

// This is a very simple key-value store for the binary mesh objects.

import { getMeshData } from "admin/admin_rest_api";

const meshStore: { [key: string]: ArrayBuffer } = {};

export default async function getMeshBufferFromStore(id: string): Promise<?ArrayBuffer> {
  if (!meshStore[id]) {
    const meshBuffer = await getMeshData(id);
    meshStore[id] = meshBuffer;
  }

  return meshStore[id];
}

export function addMeshBufferToStore(id: string, buffer: ArrayBuffer): void {
  meshStore[id] = buffer;
}
