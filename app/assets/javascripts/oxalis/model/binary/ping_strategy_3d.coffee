PolyhedronRasterizer = require("./polyhedron_rasterizer")
{M4x4, V3}           = require("libs/mjs")

class PingStrategy3d

  velocityRangeStart : 0
  velocityRangeEnd : 0

  roundTripTimeRangeStart : 0
  roundTripTimeRangeEnd : 0

  contentTypes : []

  name : 'Abstract'


  forContentType : (contentType) ->

    _.isEmpty(@contentTypes) or _.includes(@contentTypes, contentType)


  inVelocityRange : (value) ->

    @velocityRangeStart <= value <= @velocityRangeEnd


  inRoundTripTimeRange : (value) ->

    @roundTripTimeRangeStart <= value <= @roundTripTimeRangeEnd


  ping : ->

    throw "Needs to be implemented in subclass"


  getExtentObject : (poly0, poly1, zoom0, zoom1) ->

    min_x : Math.min(poly0.min_x << zoom0, poly1.min_x << zoom1)
    min_y : Math.min(poly0.min_y << zoom0, poly1.min_y << zoom1)
    min_z : Math.min(poly0.min_z << zoom0, poly1.min_z << zoom1)
    max_x : Math.max(poly0.max_x << zoom0, poly1.max_x << zoom1)
    max_y : Math.max(poly0.max_y << zoom0, poly1.max_y << zoom1)
    max_z : Math.max(poly0.max_z << zoom0, poly1.max_z << zoom1)


  modifyMatrixForPoly : (matrix, zoomStep) ->

    matrix[12] >>= (5 + zoomStep)
    matrix[13] >>= (5 + zoomStep)
    matrix[14] >>= (5 + zoomStep)
    matrix[12] += 1
    matrix[13] += 1
    matrix[14] += 1


class PingStrategy3d.DslSlow extends PingStrategy3d

  velocityRangeStart : 0
  velocityRangeEnd : Infinity

  roundTripTimeRangeStart : 0
  roundTripTimeRangeEnd : Infinity

  name : 'DSL_SLOW'

  pingPolyhedron0 : PolyhedronRasterizer.Master.squareFrustum(
    5, 5, -0.5
    4, 4, 2
  )

  pingPolyhedron1 : PolyhedronRasterizer.Master.squareFrustum(
    3,  3, -0.0
    3, 3, -3
  )

  ping : (matrix) ->

    pullQueue = []

    #-----------
    matrix1 = M4x4.clone(matrix)
    @modifyMatrixForPoly matrix1, 1

    polyhedron1 = @pingPolyhedron1.transformAffine(matrix1)

    testAddresses = polyhedron1.collectPointsOnion(matrix1[12], matrix1[13], matrix1[14])

    i = 0
    while i < testAddresses.length
      bucket_x = testAddresses[i++]
      bucket_y = testAddresses[i++]
      bucket_z = testAddresses[i++]

      pullQueue.push(bucket: [bucket_x, bucket_y, bucket_z, 1], priority: 0)

    #-----------
    matrix0 = M4x4.clone(matrix)
    @modifyMatrixForPoly matrix0, 0

    polyhedron0 = @pingPolyhedron0.transformAffine(matrix0)

    testAddresses = polyhedron0.collectPointsOnion(matrix0[12], matrix0[13], matrix0[14])

    i = 0
    while i < testAddresses.length
      bucket_x = testAddresses[i++]
      bucket_y = testAddresses[i++]
      bucket_z = testAddresses[i++]

      pullQueue.push(bucket: [bucket_x, bucket_y, bucket_z, 0], priority: 0)
    #-----------

    pullQueue
    #priority 0 is highests


module.exports = PingStrategy3d
