export type AdHocMeshGeometry = {
  // Three floats per vertex
  vertices: Float32Array;
  // Three vertex indices per triangle
  indices: Uint16Array | Uint32Array;
};

// Parses the body of an ad-hoc mesh response. It contains the vertices, followed by the indices,
// which are 16-bit if there are at most 65535 vertices, else 32-bit (WebGL 2 treats the 16-bit
// index 65535 as primitive restart). The Vertex-Count header locates the indices.
export function parseAdHocMeshResponse(
  buffer: ArrayBuffer,
  vertexCountHeader: string | undefined,
): AdHocMeshGeometry {
  if (vertexCountHeader == null) {
    throw new Error("Ad-hoc mesh response is missing the Vertex-Count header");
  }
  const vertexCount = Number(vertexCountHeader);
  const indexBytes = vertexCount <= 65535 ? 2 : 4;
  if (
    !/^\d+$/.test(vertexCountHeader) ||
    vertexCount * 12 > buffer.byteLength ||
    (buffer.byteLength - vertexCount * 12) % (3 * indexBytes) !== 0
  ) {
    throw new Error(`Invalid ad-hoc mesh response with vertex count ${vertexCountHeader}`);
  }
  // Separate buffers, because the BVH worker transfers each attribute's buffer.
  const vertices = new Float32Array(buffer.slice(0, vertexCount * 12));
  const indexBuffer = buffer.slice(vertexCount * 12);
  const indices = indexBytes === 2 ? new Uint16Array(indexBuffer) : new Uint32Array(indexBuffer);
  return { vertices, indices };
}
