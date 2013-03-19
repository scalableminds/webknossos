### define
../constants : constants
###

# This is a class with static methods dealing with dimensions and
# conversions between them.

Dimensions =

  PLANE_XY : constants.PLANE_XY
  PLANE_YZ : constants.PLANE_YZ
  PLANE_XZ : constants.PLANE_XZ
  VIEW_3D  : constants.VIEW_3D
	
  getIndices : (planeID) ->         # Returns a ordered 3-tuple [x, y, z] which
    switch planeID                  # represents the dimensions from the viewpoint
      when constants.PLANE_XY then [0, 1, 2]  # of each plane. For example, moving along the
      when constants.PLANE_YZ then [2, 1, 0]  # X-Axis of the YZ-Plane is eqivalent to moving
      when constants.PLANE_XZ then [0, 2, 1]  # along the Z axis in the cube -> ind[0]=2

  # Translate Dimension: Helper method to translate arrays with three elements
  transDim : (array, planeID) ->
    ind = @getIndices(planeID)
    return [array[ind[0]], array[ind[1]], array[ind[2]]]