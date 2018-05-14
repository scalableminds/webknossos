/**
 * interpolation_collector.js
 * @flow
 */

import _ from "lodash";
import type ArbitraryCubeAdapter from "oxalis/model/binary/arbitrary_cube_adapter";
import type { Vector4 } from "oxalis/constants";

export type CollectedVertices = {
  buffer: Uint8Array,
  missingBuckets: Array<Vector4>,
  usedBuckets: Array<Vector4>,
};

function templateFill(str: string, params: Array<string>): string {
  params.forEach(param => {
    str = str.replace(
      new RegExp(`([^a-zA-Z0-9_])${param}([^a-zA-Z0-9_])`, "gm"),
      (match, pre, post) => `${pre}<%= ${param} %>${post}`,
    );
  });
  return str;
}

// This provides interpolation mechanics. It's a lot of code. But it
// should run fast.

// Finding points adjacent to the already found one.
// We make use of the bucket structure and index arithmetic to optimize
// lookup time.
// Returns a color value between 0 and 255.
//
// pointIndex = 111111 111111 111111
//                 x      y      z
//
// Parameters: output, xd, yd, zd
// Implicits: buckets, basePointIndex, baseBucketIndex, sizeZ, sizeZY, lastBucket, lastBucketIndex, lastBucketZoomStep, bucket
// Locals: bucketIndex, sub_x, sub_y, sub_Z
const subPointMacro = _.template(
  `\
//-- subPointMacro(<%= output %>, <%= xd %>, <%= yd %>, <%= zd %>)
bucketIndex = baseBucketIndex;

sub_x = x0;
sub_y = y0;
sub_z = z0;

// We use bitmasks to handle x, y and z coordinates.
<% if (zd) { %>
// \`31     = 00000 00000 11111\`
  sub_z++;
  if ((basePointIndex & 31744) == 31744) {

    // The point seems to be at the right border.
    bucketIndex++;

    // Bound checking.
    if (bucketIndex % sizeZ == 0)
      continue;
  }
<% } %>

<% if (yd) { %>
// \`992   = 00000 11111 00000\`
  sub_y++;
  if ((basePointIndex & 992) == 992) {

    // The point is to at the bottom border.
    bucketIndex += sizeZ;

    // Bound checking.
    if (bucketIndex % sizeZY == 0)
      continue;
  }
<% } %>

<% if (xd) { %>
// \`31744 = 11111 00000 00000\`
  sub_x++;
  if ((basePointIndex & 31) == 31) {
    // The point seems to be at the back border.
    bucketIndex += sizeZY;
  }
<% } %>

usedBuckets.add(bucketIndex);
\
`,
  { imports: {} },
);

// This macro is used for collecting and interpolating the data.
// It aims to be fast, therefore the code is ugly.
// Parameters: x, y, z, buffer, j, buckets, min_x, min_y, min_z, max_x, max_y, max_z, sizeZ, sizeZY
// Locals: output0, output1, output2, output3, output4, output5, output6, output7, x0, y0, z0, xd, yd, zd, baseBucketIndex, basePointIndex
const collectLoopMacro = _.template(
  templateFill(
    `\
//-- collectLoopMacro(x, y, z, buffer, j, buckets, min_x, min_y, min_z, max_x, max_y, max_z, sizeZ, sizeZY)

output0 = output1 = output2 = output3 = output4 = output5 = output6 = output7 = 0;

// Cube bound checking is necessary.
if (x < min_x || y < min_y || z < min_z || x > max_x || y > max_y || z > max_z)
  continue;

// Bitwise operations provide fast rounding of numbers.
x0 = x >> 0; xd = x - x0;
y0 = y >> 0; yd = y - y0;
z0 = z >> 0; zd = z - z0;

baseBucketIndex =
  ((x0 - min_x) >> 5) * sizeZY +
  ((y0 - min_y) >> 5) * sizeZ +
  ((z0 - min_z) >> 5);

basePointIndex =
  ((z0 & 31) << 10) +
  ((y0 & 31) << 5) +
  ((x0 & 31));

// trilinear x,y,z
<%= subPointMacro({ output : "output0", xd : 0,  yd : 0,  zd : 0 }) %>
// <%= subPointMacro({ output : "output1", xd : 1,  yd : 0,  zd : 0 }) %>
// <%= subPointMacro({ output : "output2", xd : 0,  yd : 1,  zd : 0 }) %>
// <%= subPointMacro({ output : "output3", xd : 1,  yd : 1,  zd : 0 }) %>
// <%= subPointMacro({ output : "output4", xd : 0,  yd : 0,  zd : 1 }) %>
// <%= subPointMacro({ output : "output5", xd : 1,  yd : 0,  zd : 1 }) %>
// <%= subPointMacro({ output : "output6", xd : 0,  yd : 1,  zd : 1 }) %>
// <%= subPointMacro({ output : "output7", xd : 1,  yd : 1,  zd : 1 }) %>
`,
    [
      "x",
      "y",
      "z",
      "buffer",
      "j",
      "buckets",
      "min_x",
      "min_y",
      "min_z",
      "max_x",
      "max_y",
      "max_z",
      "sizeZ",
      "sizeZY",
    ],
  ),
  { imports: { subPointMacro } },
);

class InterpolationCollector {
  // eslint-disable-next-line no-new-func
  _bulkCollect: Function = new Function(
    "vertices",
    "buckets",
    _.template(
      `\
var buffer = new Uint8Array(vertices.length / 3);
var missingBuckets = [];
var usedBuckets = new Set();
var x, y, z;
var sub_x, sub_y, sub_z;
var output0, output1, output2, output3, output4, output5, output6, output7, x0, y0, z0, xd, yd, zd, baseBucketIndex, basePointIndex;
var coordMask, boundary;
var bucketZoomStep, bucket;
var sizeZ, sizeZY, lastBucket, lastBucketIndex, lastBucketZoomStep;
var bucketIndex, sub_x, sub_y, sub_Z;
var min_x, min_y, min_z, max_x, max_y, max_z;
var i, j;

buckets.reset();

if (buckets) {

  boundary = buckets.boundary;

  sizeZ  = boundary[2];
  sizeZY = boundary[2] * boundary[1];

  min_x = 0; //cubeOffset[0] << 5;
  min_y = 0; //cubeOffset[1] << 5;
  min_z = 0; //cubeOffset[2] << 5;
  max_x = min_x + (boundary[0] << 5) - 1;
  max_y = min_y + (boundary[1] << 5) - 1;
  max_z = min_z + (boundary[2] << 5) - 1;

  lastBucket = null;
  lastBucketIndex = -1;
  lastBucketZoomStep = 0;

  i = vertices.length;

  j = -1;

  while (i) {

    z = vertices[--i];
    y = vertices[--i];
    x = vertices[--i];

    j++;

    <%= collectLoopMacro({
      x : "x", y : "y", z : "z",
      buffer : "buffer",
      j : "j", buckets : "buckets",
      min_x : "min_x", min_y : "min_y", min_z : "min_z",
      max_x : "max_x", max_y : "max_y", max_z : "max_z",
      sizeZ : "sizeZ", sizeZY : "sizeZY"
    }) %>
  }
}

return {
  buffer : buffer,
  missingBuckets : missingBuckets,
  usedBuckets : Array.from(usedBuckets).map(idx => buckets.getBucketAddress(idx))
};
`,
    )({ collectLoopMacro }),
  );

  bulkCollect(vertices: Array<number>, buckets: ArbitraryCubeAdapter): CollectedVertices {
    console.time("bulkCollect");
    const retVal = this._bulkCollect(vertices, buckets);
    console.timeEnd("bulkCollect");
    return retVal;
  }
}

export default new InterpolationCollector();
