import * as THREE from "three";

// This function should only be used for mocking.
export function createUnitCubeBufferGeometry() {
  const geometry = new THREE.BufferGeometry();

  // 8 vertices (but we will duplicate for per-face normals if needed)
  const vertices = new Float32Array([
    // Front face
    0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,

    // Back face
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
  ]);

  // Indices for 12 triangles (2 per face)
  const indices = [
    // front
    0, 1, 2, 0, 2, 3,
    // right
    1, 5, 6, 1, 6, 2,
    // back
    5, 4, 7, 5, 7, 6,
    // left
    4, 0, 3, 4, 3, 7,
    // top
    3, 2, 6, 3, 6, 7,
    // bottom
    4, 5, 1, 4, 1, 0,
  ];

  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();

  return geometry;
}

// This function should only be used for mocking.
export function makeSimpleMesh(geometry: THREE.BufferGeometry) {
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }),
  );
}
