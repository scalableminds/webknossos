# This is a class with static methods and constants dealing with dimensions and
# conversions between them.

Dimensions =

  PLANE_XY : 0
  PLANE_YZ : 1
  PLANE_XZ : 2
  VIEW_3D  : 3
	
  getIndices : (planeID) ->         # Returns a ordered 3-tuple [x, y, z] which
    switch planeID                  # represents the dimensions from the viewpoint
      when @PLANE_XY then [0, 1, 2]  # of each plane. For example, moving along the
      when @PLANE_YZ then [2, 1, 0]  # X-Axis of the YZ-Plane is eqivalent to moving
      when @PLANE_XZ then [0, 2, 1]  # along the Z axis in the cube -> ind[0]=2

  # Translate Dimension: Helper method to translate arrays with three elements
  transDim : (array, planeID) ->
    ind = @getIndices(planeID)
    return [array[ind[0]], array[ind[1]], array[ind[2]]]

  # Return the plane in which dim is always the same
  planeForThirdDimension : (dim) ->
    switch dim
      when 2 then @PLANE_XY
      when 0 then @PLANE_YZ
      when 1 then @PLANE_XZ

  # Opposite of planeForThirdDimension
  thirdDimensionForPlane : (planeID) ->
    switch planeID
      when @PLANE_XY then 2
      when @PLANE_YZ then 0
      when @PLANE_XZ then 1