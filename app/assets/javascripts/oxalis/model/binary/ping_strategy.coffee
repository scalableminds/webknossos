### define ###

class PingStrategy

  velocityRangeStart : 0
  velocityRangeEnd : 0

  roundTripTimeRangeStart : 0
  roundTripTimeRangeEnd : 0  


  inVelocityRange : (value) ->

    @velocityRangeStart <= value <= @velocityRangeEnd


  inRoundTripTimeRange : (value) ->

    @roundTripTimeRangeStart <= value <= @roundTripTimeRangeEnd


  ping : ->

    throw "Needs to be implemented in subclass"
    {
      pullQueue : [ x0, y0, z0, zoomStep0, x1, y1, z1, zoomStep1 ]
      extent : { min_x, min_y, min_z, max_x, max_y, max_z }
    }


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


PingStrategy