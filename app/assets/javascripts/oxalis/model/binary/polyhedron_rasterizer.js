import { M4x4, V3 } from "libs/mjs";

// Constants
const HEAP_SIZE = 1 << 25;
const HEAP = new ArrayBuffer(HEAP_SIZE);
const Int32_MIN = -2147483648;
const Int32_MAX = 2147483647;

// Macros

// unused?
// crossMacro = (o0, o1, a0, a1, b0, b1) ->
//   (a0 - o0) * (b1 - o1) - (a1 - o1) * (b0 - o0)


const drawFunction = function(x, y, z, buffer, shift_z) {

  const __index_y = (z << shift_z) + (y << 1);

  if (x < buffer[__index_y]) { buffer[__index_y]     = x; }
  if (x > buffer[__index_y + 1]) { return buffer[__index_y + 1] = x; }
};


// Returns the index of the next free bit.
// Example: 5 = 0000 0101 => 3
const nextFreeBit = function(x) {
  let n = 1;
  if ((x >> 16) === 0) {
    n = n + 16;
    x <<= 16;
  }
  if ((x >> 24) === 0) {
    n = n + 8;
    x <<= 8;
  }
  if ((x >> 28) === 0) {
    n = n + 4;
    x <<= 4;
  }
  if ((x >> 30) === 0) {
    n = n + 2;
    x <<= 2;
  }
  return 32 - n - (x >> 31);
};


// Represents a convex polyhedron, which can be voxelized.
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
  static initClass() {
  
    // Orientation of transformed polyhedron 1 if z orientation is positive else -1
    this.prototype.orientation  = 1;
  }


  constructor(vertices1, indices) {

    let buffer, bufferLength;
    this.vertices = vertices1;
    this.indices = indices;
    this.calcExtent();
    const { min_x, min_y, min_z, delta_z, delta_y, shift_z, vertices } = this;

    this.bufferLength = bufferLength = delta_z << shift_z;
    this.buffer = buffer = new Int32Array(HEAP, 0, bufferLength);

    // initialize buffer values
    for (let z = 0; z < delta_z; z++) {
      let index = z << shift_z;
      for (let index_y = 0; index_y < delta_y; index_y++) {
        buffer[index++] = Int32_MAX;
        buffer[index++] = Int32_MIN;
      }
    }

    // translate to 0 based coordinate system
    let i = vertices.length;
    while (i) {
      vertices[--i] -= min_z;
      vertices[--i] -= min_y;
      vertices[--i] -= min_x;
    }

    // create convex hull buffers
    this.pointsBuffer = new Int32Array(delta_y << 2);

    // draw edges of the polyhedron into the buffer
    this.drawEdges();
    // fill each xy-plane with points
    this.drawPolygons();
  }


  calcExtent() {

    let max_y, max_z, min_y, min_z;
    let min_x = min_y = min_z = Int32_MAX;
    let max_x = max_y = max_z = Int32_MIN;

    const { vertices } = this;

    let i = 0;
    while (i < vertices.length) {
      const x = vertices[i++];
      const y = vertices[i++];
      const z = vertices[i++];

      if (x < min_x) { min_x = x; }
      if (y < min_y) { min_y = y; }
      if (z < min_z) { min_z = z; }
      if (x > max_x) { max_x = x; }
      if (y > max_y) { max_y = y; }
      if (z > max_z) { max_z = z; }
    }

    this.min_x = min_x;
    this.min_y = min_y;
    this.min_z = min_z;
    this.max_x = max_x;
    this.max_y = max_y;
    this.max_z = max_z;
    this.delta_x = (max_x - min_x) + 1;
    this.delta_y = (max_y - min_y) + 1;
    this.delta_z = (max_z - min_z) + 1;
    this.shift_z = nextFreeBit((this.delta_y << 1) - 1);

  }


  //transformAffine : (matrix) ->
  //
  //  { min_x, min_y, min_z, vertices } = @
  //
  //  vertices1 = new Int32Array(vertices.length)
  //  i = vertices.length
  //  while i
  //    vertices1[--i] = vertices[i] + min_z
  //    vertices1[--i] = vertices[i] + min_y
  //    vertices1[--i] = vertices[i] + min_x
  //
  //  new PolyhedronRasterizer(
  //    M4x4.transformPointsAffine(matrix, vertices1, vertices1),
  //    @indices
  //  )


  draw(x, y, z) {

    const { buffer, shift_z } = this;
    drawFunction(x, y, z, buffer, shift_z);

  }

  drawEdges() {
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
        vertices[i1]
      );
    }

  }


  drawLine3d(x, y, z, x1, y1, z1) {
    // Source: https://sites.google.com/site/proyectosroboticos/bresenham-3d

    let __tmp, d, dx, dy, dz, mode;
    const { shift_z, buffer } = this;

    let x_inc = (dx = x1 - x) < 0 ? -1 : 1;
    let y_inc = (dy = y1 - y) < 0 ? -1 : 1;
    let z_inc = (dz = z1 - z) < 0 ? -1 : 1;

    drawFunction(x, y, z, buffer, shift_z);

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

      //swapMacro(y, x)
      __tmp = y;
      y = x;
      x = __tmp;

      //swapMacro(y_inc, x_inc)
      __tmp = y_inc;
      y_inc = x_inc;
      x_inc = __tmp;

      //swapMacro(dy2, dx2)
      __tmp = dy2;
      dy2 = dx2;
      dx2 = __tmp;

      d = dy;
      mode = 1;

    } else {
      //swapMacro(z, x)
      __tmp = z;
      z = x;
      x = __tmp;

      //swapMacro(z_inc, x_inc)
      __tmp = z_inc;
      z_inc = x_inc;
      x_inc = __tmp;

      //swapMacro(dz2, dx2)
      __tmp = dz2;
      dz2 = dx2;
      dx2 = __tmp;

      d = dz;
      mode = 2;
    }

    let err_1 = dy2 - d;
    let err_2 = dz2 - d;

    for (let i = 0; i < d; i++) {

      if (err_1 > 0) {
        y += y_inc;
        err_1 -= dx2;
      }
      if (err_2 > 0) {
        z += z_inc;
        err_2 -= dx2;
      }

      err_1 += dy2;
      err_2 += dz2;
      x     += x_inc;

      switch (mode) {
        case 0:
          drawFunction(x, y, z, buffer, shift_z);
          break;
        case 1:
          drawFunction(y, x, z, buffer, shift_z);
          break;
        default:
          drawFunction(z, y, x, buffer, shift_z);
      }
    }

  }

  drawLine2d(x, y, x1, y1, z) {
    // Source: http://en.wikipedia.org/wiki/Bresenham's_line_algorithm#Simplification

    let d, dx, dy, mode;
    const { shift_z, buffer } = this;

    let x_inc = (dx = x1 - x) < 0 ? -1 : 1;
    let y_inc = (dy = y1 - y) < 0 ? -1 : 1;

    dx = dx < 0 ? -dx : dx;
    dy = dy < 0 ? -dy : dy;

    let dx2 = dx << 1;
    let dy2 = dy << 1;

    drawFunction(x, y, z, buffer, shift_z);

    if (dx >= dy) {

      d = dx;
      mode = 0;

    } else {

      //swapMacro(y, x)
      let __tmp = y;
      y = x;
      x = __tmp;

      //swapMacro(y_inc, x_inc)
      __tmp = y_inc;
      y_inc = x_inc;
      x_inc = __tmp;

      //swapMacro(dy2, dx2)
      __tmp = dy2;
      dy2 = dx2;
      dx2 = __tmp;

      d = dy;
      mode = 1;
    }

    let err = dy2 - d;

    for (let i = 0; i < d; i++) {

      if (err > 0) {
        y += y_inc;
        err -= dx2;
      }

      err += dy2;
      x   += x_inc;

      if (mode) {
        drawFunction(y, x, z, buffer, shift_z);
      } else {
        drawFunction(x, y, z, buffer, shift_z);
      }
    }

  }

  drawPolygons() {
    // Iterates over all relevant xy-planes. The points in
    // each plane are used to build a convex polygon. The
    // edges of that polygon is then drawn into the buffer.
    // After that, we know all line segments that belong to
    // the polyhedron.

    const { delta_x, delta_y, delta_z, shift_z, buffer, pointsBuffer } = this;

    // build and rasterize convex hull of all xy-planes

    for (let z = 0; z < delta_z; z++) {

      // put found end points into an ordered collection
      // ordered by (y,x)
      let x0, x1;
      let pointsPointer = 0;
      let index_y = z << shift_z;
      for (let y = 0; y < delta_y; y++) {

        if ((x0 = buffer[index_y++]) !== Int32_MAX) {
          pointsBuffer[pointsPointer++] = y;
          pointsBuffer[pointsPointer++] = x0;
          if ((x1 = buffer[index_y++]) !== x0) {
            pointsBuffer[pointsPointer++] = y;
            pointsBuffer[pointsPointer++] = x1;
          }
        } else {
          index_y++;
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


  collectPoints() {

    const { buffer, min_x, min_y, min_z, shift_z, delta_y, delta_z } = this;

    const output = [];

    for (let z = 0; z < delta_z; z++) {
      let index = z << shift_z;
      for (let y = 0; y < delta_y; y++) {
        const x0 = buffer[index++];
        const x1 = buffer[index++];
        if (x0 !== Int32_MAX) {
          for (let x of __range__(x0, x1, true)) { output.push(x + min_x, y + min_y, z + min_z); }
        }
      }
    }

    return output;
  }


  collectPointsOnion(xs, ys, zs) {

    const { buffer, min_x, max_x, min_y, max_y, min_z, max_z, delta_x, delta_y, delta_z, shift_z } = this;

    const maxRadius = Math.max(
      Math.abs(xs - min_x),
      Math.abs(xs - max_x),
      Math.abs(ys - min_y),
      Math.abs(ys - max_y),
      Math.abs(zs - min_z),
      Math.abs(zs - max_z)
    );

    const outputBuffer = new Int32Array(HEAP, this.bufferLength * Int32Array.BYTES_PER_ELEMENT, delta_x * delta_y * delta_z * 3);
    let outputLength = 0;

    for (let radius = 0; radius <= maxRadius; radius++) {

      let radius_end_z, radius_start_z;
      const radius_min_z = Math.max(zs - radius, min_z);
      const radius_max_z = Math.min(zs + radius, max_z);
      const radius_min_y = Math.max(ys - radius, min_y);
      const radius_max_y = Math.min(ys + radius, max_y);

      if (this.orientation === 1) {
        radius_start_z = radius_max_z;
        radius_end_z = radius_min_z;
      } else {
        radius_end_z = radius_max_z;
        radius_start_z = radius_min_z;
      }

      for (let z of __range__(radius_start_z, radius_end_z, true)) {
        for (let y = radius_min_y; y <= radius_max_y; y++) {
          let index = ((z - min_z) << shift_z) + ((y - min_y) << 1);
          let x0 = buffer[index++];
          let x1 = buffer[index++];
          if (x0 !== Int32_MAX) {
            x0 += min_x;
            x1 += min_x;
            for (let x of __range__(Math.max(xs - radius, x0), Math.min(xs + radius, x1), true)) {
              if (x === xs - radius || x === xs + radius ||
              y === ys - radius || y === ys + radius ||
              z === zs - radius || z === zs + radius) {
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
PolyhedronRasterizer.initClass();

PolyhedronRasterizer.Master = class Master {

  // Works just like a regular mesh in WebGL.
  constructor(vertices, indices) {
    this.vertices = vertices;
    this.indices = indices;
  }

  transformAffine(matrix) {

    const { vertices, indices } = this;

    const transformedPolyhdron = new PolyhedronRasterizer(
      M4x4.transformPointsAffine(matrix, vertices, new Int32Array(vertices.length)),
      indices
    );

    const orientationVector = M4x4.transformLineAffine(matrix, [0, 0, 1], [0, 0, 0]);

    transformedPolyhdron.orientation = orientationVector[2] < 0 ? -1 : 1;

    return transformedPolyhdron;
  }


  static squareFrustum(nearFaceXWidth, nearFaceYWidth, nearFaceZ, farFaceXWidth, farFaceYWidth, farFaceZ) {

    const vertices = [
      -nearFaceXWidth / 2, -nearFaceYWidth / 2, nearFaceZ, //0
      -farFaceXWidth  / 2, -farFaceYWidth  / 2, farFaceZ, //3
      -nearFaceXWidth / 2,  nearFaceYWidth / 2, nearFaceZ, //6
      -farFaceXWidth  / 2,  farFaceYWidth  / 2, farFaceZ, //9
       nearFaceXWidth / 2, -nearFaceYWidth / 2, nearFaceZ, //12
       farFaceXWidth  / 2, -farFaceYWidth  / 2, farFaceZ, //15
       nearFaceXWidth / 2,  nearFaceYWidth / 2, nearFaceZ, //18
       farFaceXWidth  / 2,  farFaceYWidth  / 2, farFaceZ //21
    ];
    const indices = [
      0,3,
      0,6,
      0,12,
      3,9,
      3,15,
      6,9,
      6,18,
      9,21,
      12,15,
      12,18,
      15,21,
      18,21
    ];
    return new PolyhedronRasterizer.Master(vertices, indices);
  }


  static cuboid(width_x, width_y, width_z) {

    return this.squareFrustum(width_x, width_y, 0, width_x, width_y, width_z);
  }


  static cube(width) {

    return this.cuboid(width, width, width);
  }
};



export default PolyhedronRasterizer;

function __range__(left, right, inclusive) {
  let range = [];
  let ascending = left < right;
  let end = !inclusive ? right : ascending ? right + 1 : right - 1;
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }
  return range;
}