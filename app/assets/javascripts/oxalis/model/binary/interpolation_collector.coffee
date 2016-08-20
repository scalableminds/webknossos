_ = require("lodash")

templateFill = (str, params) ->

  params.forEach( (param) ->
    str = str.replace(new RegExp("([^a-zA-Z0-9_])#{param}([^a-zA-Z0-9_])", "gm"), (match, pre, post) -> "#{pre}<%= #{param} %>#{post}")
  )
  str


# This provides interpolation mechanics. It's a lot of code. But it
# should run fast.

# See model/binary/cube to find out how this works
# Parameters: pointIndex, x, y, z, zoomStep
# Locals: coordMask
pointIndexMacro = _.template(
  templateFill(
    """
    //-- pointIndexMacro(pointIndex, x, y, z, zoomStep)
    coordMask = 31 << zoomStep;

    pointIndex =
      (
        ((z & coordMask) << (10 - zoomStep)) +
        ((y & coordMask) << (5 - zoomStep)) +
        ((x & coordMask) >> (zoomStep))
      ) >> 0;
    """
    ["pointIndex", "x", "y", "z", "zoomStep"]
  )
)

# Finding points adjacent to the already found one.
# We make use of the bucket structure and index arithmetic to optimize
# lookup time.
# Returns a color value between 0 and 255.
#
# pointIndex = 111111 111111 111111
#                 x      y      z
#
# Parameters: output, xd, yd, zd
# Implicits: buckets, basePointIndex, baseBucketIndex, sizeZ, sizeZY, lastBucket, lastBucketIndex, lastBucketZoomStep, bucket
# Locals: bucketIndex, sub_x, sub_y, sub_Z
subPointMacro = _.template(
  """
  //-- subPointMacro(<%= output %>, <%= xd %>, <%= yd %>, <%= zd %>)
  bucketIndex = baseBucketIndex;

  sub_x = x0;
  sub_y = y0;
  sub_z = z0;

  // We use bitmasks to handle x, y and z coordinates.
  <% if (zd) { %>
  // `31     = 00000 00000 11111`
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
  // `992   = 00000 11111 00000`
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
  // `31744 = 11111 00000 00000`
    sub_x++;
    if ((basePointIndex & 31) == 31) {
      // The point seems to be at the back border.
      bucketIndex += sizeZY;
    }
  <% } %>

  var isBucketMissing = false;

  if (bucketIndex == lastBucketIndex) {

    <%= pointIndexMacro({ pointIndex : "pointIndex", x : "sub_x", y : "sub_y", z : "sub_z", zoomStep : "lastBucketZoomStep" }) %>

    <%= output %> = lastBucket[pointIndex];

  } else if ((bucket = buckets.getBucket(bucketIndex)) != null) {

    bucketZoomStep = bucket.zoomStep || 0;
    isBucketMissing = bucket.isTemporalData;

    <%= pointIndexMacro({ pointIndex : "pointIndex", x : "sub_x", y : "sub_y", z : "sub_z", zoomStep : "bucketZoomStep" }) %>

    lastBucket = bucket;
    lastBucketIndex = bucketIndex;
    lastBucketZoomStep = bucketZoomStep;

    <%= output %> = bucket[pointIndex];

  } else {
    isBucketMissing = true;
  }

  if (isBucketMissing) {
    if(buckets.isValidBucket(bucketIndex) && missingBuckets.length < 100) {

      missingBuckets.push([
        Math.floor(bucketIndex / sizeZY),
        Math.floor((bucketIndex % sizeZY) / sizeZ),
        bucketIndex % sizeZ,
        0
      ])
    }
  }
  """
  { imports : { pointIndexMacro } }
)

# Trilinear interpolation (Point is in a cube)
# Parameters: output, p000, p100, p010, p110, p001, p101, p011, p111, d0, d1, d2
trilinearMacro = _.template(
  templateFill(
    """
    //-- trilinearMacro(output, p000, p100, p010, p110, p001, p101, p011, p111, d0, d1, d2)

    output =
      p000 * (1 - d0) * (1 - d1) * (1 - d2) +
      p100 * d0 * (1 - d1) * (1 - d2) +
      p010 * (1 - d0) * d1 * (1 - d2) +
      p110 * d0 * d1 * (1 - d2) +
      p001 * (1 - d0) * (1 - d1) * d2 +
      p101 * d0 * (1 - d1) * d2 +
      p011 * (1 - d0) * d1 * d2 +
      p111 * d0 * d1 * d2;

    """
    ["output", "p000", "p100", "p010", "p110", "p001", "p101", "p011", "p111", "d0", "d1", "d2" ]
  )
)


# This macro is used for collecting and interpolating the data.
# It aims to be fast, therefore the code is ugly.
# Parameters: x, y, z, buffer, j, buckets, min_x, min_y, min_z, max_x, max_y, max_z, sizeZ, sizeZY
# Locals: output0, output1, output2, output3, output4, output5, output6, output7, x0, y0, z0, xd, yd, zd, baseBucketIndex, basePointIndex
collectLoopMacro = _.template(
  templateFill(
    """
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
    <%= subPointMacro({ output : "output1", xd : 1,  yd : 0,  zd : 0 }) %>
    <%= subPointMacro({ output : "output2", xd : 0,  yd : 1,  zd : 0 }) %>
    <%= subPointMacro({ output : "output3", xd : 1,  yd : 1,  zd : 0 }) %>
    <%= subPointMacro({ output : "output4", xd : 0,  yd : 0,  zd : 1 }) %>
    <%= subPointMacro({ output : "output5", xd : 1,  yd : 0,  zd : 1 }) %>
    <%= subPointMacro({ output : "output6", xd : 0,  yd : 1,  zd : 1 }) %>
    <%= subPointMacro({ output : "output7", xd : 1,  yd : 1,  zd : 1 }) %>

    <%= trilinearMacro({
      output : "trilinearOutput",
      p000 : "output0",
      p100 : "output1",
      p010 : "output2",
      p110 : "output3",
      p001 : "output4",
      p101 : "output5",
      p011 : "output6",
      p111 : "output7",
      d0 : "xd",
      d1 : "yd",
      d2 : "zd"
    }) %>
    buffer[j] = trilinearOutput;
    """
    ["x", "y", "z", "buffer", "j", "buckets", "min_x", "min_y", "min_z", "max_x", "max_y", "max_z", "sizeZ", "sizeZY"]
  )
  { imports : { trilinearMacro, subPointMacro } }
)
InterpolationCollector =
  bulkCollect : new Function(
    "vertices", "buckets",
    _.template(
      """
      var buffer = new Uint8Array(vertices.length / 3);
      var missingBuckets = [];
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
        missingBuckets : missingBuckets
      };

      //# sourceURL=/oxalis/model/binary/interpolation_collector/bulkCollect
      """
    )({collectLoopMacro})
  )


module.exports = InterpolationCollector
