### define
../constants : constants
###

# This is a class with static methods dealing with dimensions and
# conversions between them.

Dimensions =

  PLANE_XY : constants.PLANE_XY
  PLANE_YZ : constants.PLANE_YZ
  PLANE_XZ : constants.PLANE_XZ
  TDView  : constants.TDView
	
  getIndices : (planeID) ->
    # Returns a ordered 3-tuple [x, y, z] which represents the dimensions from the viewpoint

    switch planeID
      when constants.PLANE_XY then [0, 1, 2]  # of each plane. For example, moving along the
      when constants.PLANE_YZ then [2, 1, 0]  # X-Axis of the YZ-Plane is eqivalent to moving
      when constants.PLANE_XZ then [0, 2, 1]  # along the Z axis in the cube -> ind[0]=2


  transDim : (array, planeID) ->
    # Translate Dimension: Helper method to translate arrays with three elements

    ind = @getIndices(planeID)
    return [array[ind[0]], array[ind[1]], array[ind[2]]]


  planeForThirdDimension : (dim) ->
    # Return the plane in which dim is always the same

    switch dim
      when 2 then @PLANE_XY
      when 0 then @PLANE_YZ
      when 1 then @PLANE_XZ


  thirdDimensionForPlane : (planeID) ->
    # Opposite of planeForThirdDimension

    switch planeID
      when @PLANE_XY then 2
      when @PLANE_YZ then 0
      when @PLANE_XZ then 1


  round : (number) ->
    # Floor number, as done at texture rendering

    return ~~number


  roundCoordinate : (coordinate) ->

    res = coordinate.slice()
    for i in [0...res.length]
      res[i] = @round(res[i])
    return res


  distance : (pos1, pos2) ->

    sumOfSquares = 0
    for i in [0...pos1.length]
      diff = pos1[i] - pos2[i]
      sumOfSquares += diff * diff
    return Math.sqrt(sumOfSquares)

