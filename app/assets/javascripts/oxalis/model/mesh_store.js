// @flow

// This is a very simple key-value store for the binary mesh objects.

const meshStore: { [key: string]: ArrayBuffer } = {};

export function getMeshBuffer(id: string): ?ArrayBuffer {
  return meshStore[id];
}

export function setMeshBuffer(id: string, buffer: ArrayBuffer): ?ArrayBuffer {
  meshStore[id] = buffer;
}
