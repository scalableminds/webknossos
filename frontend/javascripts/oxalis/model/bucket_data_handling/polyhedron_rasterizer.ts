import type { Matrix4x4 } from "libs/mjs";
import { M4x4 } from "libs/mjs";
import * as Utils from "libs/utils";
// Constants
const HEAP_SIZE = 1 << 25;
const HEAP = new ArrayBuffer(HEAP_SIZE);
const Int32MIN = -2147483648;
const Int32MAX = 2147483647;

// Macros
// unused?
// crossMacro = (o0, o1, a0, a1, b0, b1) ->
//   (a0 - o0) * (b1 - o1) - (a1 - o1) * (b0 - o0)
function drawFunction(x: number, y: number, z: number, buffer: Int32Array, shiftZ: number): void {
  const __indexY = (z << shiftZ) + (y << 1);

  if (x < buffer[__indexY]) {
    buffer[__indexY] = x;
  }

  if (x > buffer[__indexY + 1]) {
    buffer[__indexY + 1] = x;
  }
}

// Returns the index of the next free bit.
// Example: 5 = 0000 0101 => 3
function nextFreeBit(x: number): number {
  let n = 1;

  if (x >> 16 === 0) {
    n += 16;
    x <<= 16;
  }

  if (x >> 24 === 0) {
    n += 8;
    x <<= 8;
  }

  if (x >> 28 === 0) {
    n += 4;
    x <<= 4;
  }

  if (x >> 30 === 0) {
    n += 2;
    x <<= 2;
  }

  return 32 - n - (x >> 31);
} // Represents a convex polyhedron, which can be voxelized.
// Use it like this:
//     masterPolyhredon = new PolyhedronRasterizer.Master([...], [...])
//     polyhedron = masterPolyhedron.transformAffine(matrix)
//     output = polyhedron.collectPointsOnion(0, 0, 0)
//
// ##A word of caution:##
// The code is a bit verbose to keep it speedy. Also notice
// that using this class is nowhere near thread-safe. Each instance
// will use the same `HEAP`. Therefore two existing instances will
// definitely collide.
//
// ##How the algorithm works:##
// First, we use a buffer which holds all line segments orthogonal
// to the yz-plane belonging to the polyhedron, i.e. the smallest
// and highest x-coordinate for all y- and z-coordinates currently
// known.
// We start by drawing the edges of the polyhedron into the buffer.
// This results in having at least one point in each orthogonal plane.
// Knowing this, we slice polyhedron at each xy-plane (i.e. same
// z-coordinate). We collect all points in this plane and run a convex
// hull algorithm over them, resulting in a convex polygon. We then draw
// edges of that polygon into our buffer.
// Finally, we know all relevant line segments and can collect the points
// There are some algorithms available to determine the order of the
// collected points.
//

class PolyhedronRasterizer {
  // @ts-expect-error ts-migrate(2702) FIXME: 'PolyhedronRasterizer' only refers to a type, but ... Remove this comment to see the full error message
  static Master: PolyhedronRasterizer.Master;
  // Orientation of transformed polyhedron 1 if z orientation is positive else -1
  orientation: 1 | -1 = 1;
  bufferLength: number;
  buffer: Int32Array;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'deltaX' has no initializer and is not de... Remove this comment to see the full error message
  deltaX: number;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'deltaY' has no initializer and is not de... Remove this comment to see the full error message
  deltaY: number;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'deltaZ' has no initializer and is not de... Remove this comment to see the full error message
  deltaZ: number;
  indices: Array<number>;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'maxX' has no initializer and is not defi... Remove this comment to see the full error message
  maxX: number;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'maxY' has no initializer and is not defi... Remove this comment to see the full error message
  maxY: number;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'maxZ' has no initializer and is not defi... Remove this comment to see the full error message
  maxZ: number;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'minX' has no initializer and is not defi... Remove this comment to see the full error message
  minX: number;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'minY' has no initializer and is not defi... Remove this comment to see the full error message
  minY: number;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'minZ' has no initializer and is not defi... Remove this comment to see the full error message
  minZ: number;
  pointsBuffer: Int32Array;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'shiftZ' has no initializer and is not de... Remove this comment to see the full error message
  shiftZ: number;
  vertices: Array<number>;

  constructor(vertices1: Array<number>, indices: Array<number>) {
    this.vertices = vertices1;
    this.indices = indices;
    this.calcExtent();
    const { minX, minY, minZ, deltaZ, deltaY, shiftZ, vertices } = this;
    const bufferLength = deltaZ << shiftZ;
    this.bufferLength = bufferLength;
    const buffer = new Int32Array(HEAP, 0, bufferLength);
    this.buffer = buffer;

    // initialize buffer values
    for (let z = 0; z < deltaZ; z++) {
      let index = z << shiftZ;

      for (let indexY = 0; indexY < deltaY; indexY++) {
        buffer[index++] = Int32MAX;
        buffer[index++] = Int32MIN;
      }
    }

    // translate to 0 based coordinate system
    let i = vertices.length;

    while (i) {
      vertices[--i] -= minZ;
      vertices[--i] -= minY;
      vertices[--i] -= minX;
    }

    // create convex hull buffers
    this.pointsBuffer = new Int32Array(deltaY << 2);
    // draw edges of the polyhedron into the buffer
    this.drawEdges();
    // fill each xy-plane with points
    this.drawPolygons();
  }

  calcExtent(): void {
    let minX = Int32MAX;
    let minY = Int32MAX;
    let minZ = Int32MAX;
    let maxX = Int32MIN;
    let maxY = Int32MIN;
    let maxZ = Int32MIN;
    const { vertices } = this;
    let i = 0;

    while (i < vertices.length) {
      const x = vertices[i++];
      const y = vertices[i++];
      const z = vertices[i++];

      if (x < minX) {
        minX = x;
      }

      if (y < minY) {
        minY = y;
      }

      if (z < minZ) {
        minZ = z;
      }

      if (x > maxX) {
        maxX = x;
      }

      if (y > maxY) {
        maxY = y;
      }

      if (z > maxZ) {
        maxZ = z;
      }
    }

    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxY = maxY;
    this.maxZ = maxZ;
    this.deltaX = maxX - minX + 1;
    this.deltaY = maxY - minY + 1;
    this.deltaZ = maxZ - minZ + 1;
    this.shiftZ = nextFreeBit((this.deltaY << 1) - 1);
  }

  // transformAffine : (matrix) ->
  //
  //  { minX, minY, minZ, vertices } = @
  //
  //  vertices1 = new Int32Array(vertices.length)
  //  i = vertices.length
  //  while i
  //    vertices1[--i] = vertices[i] + minZ
  //    vertices1[--i] = vertices[i] + minY
  //    vertices1[--i] = vertices[i] + minX
  //
  //  new PolyhedronRasterizer(
  //    M4x4.transformPointsAffine(matrix, vertices1, vertices1),
  //    @indices
  //  )
  draw(x: number, y: number, z: number) {
    const { buffer, shiftZ } = this;
    drawFunction(x, y, z, buffer, shiftZ);
  }

  drawEdges(): void {
    // Draws the edges into the buffer.
    const { indices, vertices } = this;
    // rasterize edges with 3d bresenham
    let i = indices.length;

    while (i) {
      let i0 = indices[--i];
      let i1 = indices[--i];
      this.drawLine3d(
        vertices[i0++],
        vertices[i0++],
        vertices[i0],
        vertices[i1++],
        vertices[i1++],
        vertices[i1],
      );
    }
  }

  drawLine3d(x: number, y: number, z: number, x1: number, y1: number, z1: number): void {
    // Source: https://sites.google.com/site/proyectosroboticos/bresenham-3d
    let tmp;
    let d;
    let mode;
    let dx = x1 - x;
    let dy = y1 - y;
    let dz = z1 - z;
    const { shiftZ, buffer } = this;
    let incX = dx < 0 ? -1 : 1;
    let incY = dy < 0 ? -1 : 1;
    let incZ = dz < 0 ? -1 : 1;
    drawFunction(x, y, z, buffer, shiftZ);
    dx = dx < 0 ? -dx : dx;
    dy = dy < 0 ? -dy : dy;
    dz = dz < 0 ? -dz : dz;
    let dx2 = dx << 1;
    let dy2 = dy << 1;
    let dz2 = dz << 1;

    if (dx >= dy && dx >= dz) {
      d = dx;
      mode = 0;
    } else if (dy >= dz) {
      // swapMacro(y, x)
      tmp = y;
      y = x;
      x = tmp;
      // swapMacro(incY, incX)
      tmp = incY;
      incY = incX;
      incX = tmp;
      // swapMacro(dy2, dx2)
      tmp = dy2;
      dy2 = dx2;
      dx2 = tmp;
      d = dy;
      mode = 1;
    } else {
      // swapMacro(z, x)
      tmp = z;
      z = x;
      x = tmp;
      // swapMacro(incZ, incX)
      tmp = incZ;
      incZ = incX;
      incX = tmp;
      // swapMacro(dz2, dx2)
      tmp = dz2;
      dz2 = dx2;
      dx2 = tmp;
      d = dz;
      mode = 2;
    }

    let err1 = dy2 - d;
    let err2 = dz2 - d;

    for (let i = 0; i < d; i++) {
      if (err1 > 0) {
        y += incY;
        err1 -= dx2;
      }

      if (err2 > 0) {
        z += incZ;
        err2 -= dx2;
      }

      err1 += dy2;
      err2 += dz2;
      x += incX;

      switch (mode) {
        case 0: {
          drawFunction(x, y, z, buffer, shiftZ);
          break;
        }

        case 1: {
          drawFunction(y, x, z, buffer, shiftZ);
          break;
        }

        default:
          drawFunction(z, y, x, buffer, shiftZ);
      }
    }
  }

  drawLine2d(x: number, y: number, x1: number, y1: number, z: number): void {
    // Source: http://en.wikipedia.org/wiki/Bresenham's_line_algorithm#Simplification
    let d;
    let mode;
    let dx = x1 - x;
    let dy = y1 - y;
    const { shiftZ, buffer } = this;
    let incX = dx < 0 ? -1 : 1;
    let incY = dy < 0 ? -1 : 1;
    dx = dx < 0 ? -dx : dx;
    dy = dy < 0 ? -dy : dy;
    let dx2 = dx << 1;
    let dy2 = dy << 1;
    drawFunction(x, y, z, buffer, shiftZ);

    if (dx >= dy) {
      d = dx;
      mode = 0;
    } else {
      // swapMacro(y, x)
      let tmp = y;
      y = x;
      x = tmp;
      // swapMacro(incY, incX)
      tmp = incY;
      incY = incX;
      incX = tmp;
      // swapMacro(dy2, dx2)
      tmp = dy2;
      dy2 = dx2;
      dx2 = tmp;
      d = dy;
      mode = 1;
    }

    let err = dy2 - d;

    for (let i = 0; i < d; i++) {
      if (err > 0) {
        y += incY;
        err -= dx2;
      }

      err += dy2;
      x += incX;

      if (mode) {
        drawFunction(y, x, z, buffer, shiftZ);
      } else {
        drawFunction(x, y, z, buffer, shiftZ);
      }
    }
  }

  drawPolygons(): void {
    // Iterates over all relevant xy-planes. The points in
    // each plane are used to build a convex polygon. The
    // edges of that polygon is then drawn into the buffer.
    // After that, we know all line segments that belong to
    // the polyhedron.
    const { deltaY, deltaZ, shiftZ, buffer, pointsBuffer } = this;

    // build and rasterize convex hull of all xy-planes
    for (let z = 0; z < deltaZ; z++) {
      // put found end points into an ordered collection
      // ordered by (y,x)
      let x0;
      let x1;
      let pointsPointer = 0;
      let indexY = z << shiftZ;

      for (let y = 0; y < deltaY; y++) {
        x0 = buffer[indexY++];

        if (x0 !== Int32MAX) {
          pointsBuffer[pointsPointer++] = y;
          pointsBuffer[pointsPointer++] = x0;
          x1 = buffer[indexY++];

          if (x1 !== x0) {
            pointsBuffer[pointsPointer++] = y;
            pointsBuffer[pointsPointer++] = x1;
          }
        } else {
          indexY++;
        }
      }

      // Generating convex hull by brute force. O(n²)
      let i = 0;

      while (i < pointsPointer) {
        const y0 = pointsBuffer[i++];
        x0 = pointsBuffer[i++];
        let j = i;

        while (j < pointsPointer) {
          const y1 = pointsBuffer[j++];
          x1 = pointsBuffer[j++];
          this.drawLine2d(x0, y0, x1, y1, z);
        }
      }
    }
  }

  collectPoints(): Array<number> {
    const { buffer, minX, minY, minZ, shiftZ, deltaY, deltaZ } = this;
    const output = [];

    for (let z = 0; z < deltaZ; z++) {
      let index = z << shiftZ;

      for (let y = 0; y < deltaY; y++) {
        const x0 = buffer[index++];
        const x1 = buffer[index++];

        if (x0 !== Int32MAX) {
          for (let x = x0; x <= x1; x++) {
            output.push(x + minX, y + minY, z + minZ);
          }
        }
      }
    }

    return output;
  }

  collectPointsOnion(xs: number, ys: number, zs: number): Int32Array {
    const { buffer, minX, maxX, minY, maxY, minZ, maxZ, deltaX, deltaY, deltaZ, shiftZ } = this;
    const maxRadius = Math.max(
      Math.abs(xs - minX),
      Math.abs(xs - maxX),
      Math.abs(ys - minY),
      Math.abs(ys - maxY),
      Math.abs(zs - minZ),
      Math.abs(zs - maxZ),
    );
    const outputBuffer = new Int32Array(
      HEAP,
      this.bufferLength * Int32Array.BYTES_PER_ELEMENT,
      deltaX * deltaY * deltaZ * 3,
    );
    let outputLength = 0;

    for (let radius = 0; radius <= maxRadius; radius++) {
      let radiusEndZ;
      let radiusStartZ;
      const radiusMinZ = Math.max(zs - radius, minZ);
      const radiusMaxZ = Math.min(zs + radius, maxZ);
      const radiusMinY = Math.max(ys - radius, minY);
      const radiusMaxY = Math.min(ys + radius, maxY);

      if (this.orientation === 1) {
        radiusStartZ = radiusMaxZ;
        radiusEndZ = radiusMinZ;
      } else {
        radiusEndZ = radiusMaxZ;
        radiusStartZ = radiusMinZ;
      }

      for (const z of Utils.__range__(radiusStartZ, radiusEndZ, true)) {
        for (let y = radiusMinY; y <= radiusMaxY; y++) {
          let index = ((z - minZ) << shiftZ) + ((y - minY) << 1);
          let x0 = buffer[index++];
          let x1 = buffer[index++];

          if (x0 !== Int32MAX) {
            x0 += minX;
            x1 += minX;

            for (const x of Utils.__range__(
              Math.max(xs - radius, x0),
              Math.min(xs + radius, x1),
              true,
            )) {
              if (
                x === xs - radius ||
                x === xs + radius ||
                y === ys - radius ||
                y === ys + radius ||
                z === zs - radius ||
                z === zs + radius
              ) {
                outputBuffer[outputLength++] = x;
                outputBuffer[outputLength++] = y;
                outputBuffer[outputLength++] = z;
              }
            }
          }
        }
      }
    }

    return outputBuffer.subarray(0, outputLength);
  }
}

PolyhedronRasterizer.Master = class Master {
  indices: Array<number>;
  vertices: Array<number>;

  // Works just like a regular mesh in WebGL.
  constructor(vertices: Array<number>, indices: Array<number>) {
    this.vertices = vertices;
    this.indices = indices;
  }

  transformAffine(matrix: Matrix4x4): PolyhedronRasterizer {
    const { vertices, indices } = this;
    const transformedPolyhdron = new PolyhedronRasterizer(
      // @ts-ignore
      M4x4.transformPointsAffine(matrix, vertices, new Int32Array(vertices.length)),
      indices,
    );
    const orientationVector = M4x4.transformLineAffine(matrix, [0, 0, 1], [0, 0, 0]);
    transformedPolyhdron.orientation = orientationVector[2] < 0 ? -1 : 1;
    return transformedPolyhdron;
  }

  static squareFrustum(
    nearFaceXWidth: number,
    nearFaceYWidth: number,
    nearFaceZ: number,
    farFaceXWidth: number,
    farFaceYWidth: number,
    farFaceZ: number,
  ): Master {
    const vertices = [
      -nearFaceXWidth / 2,
      -nearFaceYWidth / 2,
      nearFaceZ, // 0
      -farFaceXWidth / 2,
      -farFaceYWidth / 2,
      farFaceZ, // 3
      -nearFaceXWidth / 2,
      nearFaceYWidth / 2,
      nearFaceZ, // 6
      -farFaceXWidth / 2,
      farFaceYWidth / 2,
      farFaceZ, // 9
      nearFaceXWidth / 2,
      -nearFaceYWidth / 2,
      nearFaceZ, // 12
      farFaceXWidth / 2,
      -farFaceYWidth / 2,
      farFaceZ, // 15
      nearFaceXWidth / 2,
      nearFaceYWidth / 2,
      nearFaceZ, // 18
      farFaceXWidth / 2,
      farFaceYWidth / 2,
      farFaceZ, // 21
    ];
    const indices = [
      0, 3, 0, 6, 0, 12, 3, 9, 3, 15, 6, 9, 6, 18, 9, 21, 12, 15, 12, 18, 15, 21, 18, 21,
    ];
    return new PolyhedronRasterizer.Master(vertices, indices);
  }

  static cuboid(widthX: number, widthY: number, widthZ: number): Master {
    return this.squareFrustum(widthX, widthY, 0, widthX, widthY, widthZ);
  }

  static cube(width: number): Master {
    return this.cuboid(width, width, width);
  }
};
export default PolyhedronRasterizer;
