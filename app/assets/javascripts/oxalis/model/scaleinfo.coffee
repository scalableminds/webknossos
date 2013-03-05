### define ###
# This class encapsulates any conversions between the nm and voxel
# coordinate system.

class ScaleInfo
  
  constructor : (scale) ->

    @nmPerVoxel = scale

    @voxelPerNM = [0, 0, 0]
    for i in [0..(@nmPerVoxel.length - 1)]
      @voxelPerNM[i] = 1 / @nmPerVoxel[i]

    # base voxel should be a cube with highest resolution
    @baseVoxel = Math.min.apply(null, @nmPerVoxel)

    # scale factor to calculate the voxels in a certain
    # dimension from baseVoxels
    @baseVoxelFactors = [@baseVoxel / @nmPerVoxel[0],
                          @baseVoxel / @nmPerVoxel[1],
                          @baseVoxel / @nmPerVoxel[2]]

  getNmPerVoxelVector : ->
    return new THREE.Vector3(@nmPerVoxel...)

  getVoxelPerNMVector : ->
    return new THREE.Vector3(@voxelPerNM...)

  voxelToNm : (posArray) ->
    nmPos = posArray.slice()
    for i in [0..2]
      nmPos[i] *= @nmPerVoxel[i]

  baseVoxelToVoxel : (baseVoxel) ->
    res = @baseVoxelFactors.slice();
    for i in [0..2]
    	res *= baseVoxel
    return res