import { parseAdHocMeshResponse } from "admin/api/ad_hoc_mesh_response";
import { mergeVertices } from "libs/BufferGeometryUtils";
import { BufferAttribute, BufferGeometry } from "three";
import { describe, expect, it } from "vitest";

// An octahedron around the origin: six vertices, eight outward-facing triangles.
const octahedronVertices = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
const octahedronIndices = [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5];

function indexedBody(
  vertices: number[],
  indices: number[],
  IndexArray: Uint16ArrayConstructor | Uint32ArrayConstructor,
): ArrayBuffer {
  const vertexBytes = new Uint8Array(new Float32Array(vertices).buffer);
  const indexBytes = new Uint8Array(new IndexArray(indices).buffer);
  const body = new Uint8Array(vertexBytes.length + indexBytes.length);
  body.set(vertexBytes);
  body.set(indexBytes, vertexBytes.length);
  return body.buffer;
}

function triangleSoup(
  vertices: ArrayLike<number>,
  indices: ArrayLike<number>,
): Float32Array<ArrayBuffer> {
  const soup = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    for (let axis = 0; axis < 3; axis++) {
      soup[i * 3 + axis] = vertices[indices[i] * 3 + axis];
    }
  }
  return soup;
}

// The position and normal of each triangle corner.
function corners(geometry: BufferGeometry): number[][] {
  geometry.computeVertexNormals();
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const index = geometry.getIndex();
  const count = index != null ? index.count : position.count;
  const result = [];
  for (let i = 0; i < count; i++) {
    const vertex = index != null ? index.getX(i) : i;
    result.push([
      position.getX(vertex),
      position.getY(vertex),
      position.getZ(vertex),
      normal.getX(vertex),
      normal.getY(vertex),
      normal.getZ(vertex),
    ]);
  }
  return result;
}

describe("parseAdHocMeshResponse", () => {
  it("parses vertices and 16-bit indices", () => {
    const body = indexedBody(octahedronVertices, octahedronIndices, Uint16Array);
    const { vertices, indices } = parseAdHocMeshResponse(body, "6");
    expect(Array.from(vertices)).toEqual(octahedronVertices);
    expect(indices).toBeInstanceOf(Uint16Array);
    expect(Array.from(indices!)).toEqual(octahedronIndices);
    // Separate buffers, so that both can be transferred to a worker.
    expect(vertices.buffer).not.toBe(indices!.buffer);
  });

  it("parses 32-bit indices from 65536 vertices on", () => {
    // 16-bit indices would make vertex 65535 the WebGL 2 primitive restart index.
    const vertexCount = 65536;
    const body = indexedBody(new Array(vertexCount * 3).fill(0), [0, 65535, 3], Uint32Array);
    const { vertices, indices } = parseAdHocMeshResponse(body, String(vertexCount));
    expect(vertices.length).toBe(vertexCount * 3);
    expect(indices).toBeInstanceOf(Uint32Array);
    expect(Array.from(indices!)).toEqual([0, 65535, 3]);
  });

  it("parses an empty mesh", () => {
    const { vertices, indices } = parseAdHocMeshResponse(new ArrayBuffer(0), "0");
    expect(vertices.length).toBe(0);
    expect(indices!.length).toBe(0);
  });

  it("returns a triangle soup without vertex count", () => {
    const soup = triangleSoup(octahedronVertices, octahedronIndices);
    const { vertices, indices } = parseAdHocMeshResponse(soup.buffer, undefined);
    expect(vertices).toEqual(soup);
    expect(indices).toBeNull();
  });

  it("rejects inconsistent vertex counts", () => {
    const body = indexedBody(octahedronVertices, octahedronIndices, Uint16Array);
    for (const header of ["11", "-1", "abc", "1.5", ""]) {
      expect(() => parseAdHocMeshResponse(body, header)).toThrow();
    }
    // Indices that don't form whole triangles
    const truncated = body.slice(0, body.byteLength - 2);
    expect(() => parseAdHocMeshResponse(truncated, "6")).toThrow();
  });

  it("gives the same geometry as merging the vertices of the triangle soup", () => {
    const { vertices, indices } = parseAdHocMeshResponse(
      indexedBody(octahedronVertices, octahedronIndices, Uint16Array),
      "6",
    );
    const indexed = new BufferGeometry();
    indexed.setAttribute("position", new BufferAttribute(vertices, 3));
    indexed.setIndex(new BufferAttribute(indices!, 1));

    const soup = new BufferGeometry();
    soup.setAttribute(
      "position",
      new BufferAttribute(triangleSoup(octahedronVertices, octahedronIndices), 3),
    );
    const merged = mergeVertices(soup);

    const expected = corners(merged);
    const actual = corners(indexed);
    expect(actual.length).toBe(expected.length);
    actual.forEach((corner, i) => {
      corner.forEach((value, j) => {
        expect(value).toBeCloseTo(expected[i][j], 6);
      });
    });
  });
});
