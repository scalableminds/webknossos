package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.geometry.{Vec3Float, Vec3Int}
import com.scalableminds.webknossos.datastore.helpers.NativeLibrary

class NativeAdHocMesher {
  NativeLibrary.ensureLoaded()

  /** Meshes the voxels of one segment in a cuboid with marching cubes (webknossos-native/src/ad_hoc_mesh.rs).
    *
    * @param data
    *   the cuboid as little-endian elements, x fastest
    * @param segmentId
    *   compared with the raw bits of each element, so only its low bytesPerElement bytes matter
    * @param neighborsOut
    *   receives in its only element the faces of the cuboid that contain the segment, as a bit mask (see
    *   [[neighborFaces]])
    * @return
    *   three floats per vertex, three vertices per triangle: (voxel + edge midpoint + offset) * scale
    */
  @native def adHocMesh(
      data: Array[Byte],
      bytesPerElement: Int,
      dimensions: Array[Int],
      segmentId: Long,
      offset: Array[Float],
      scale: Array[Float],
      neighborsOut: Array[Int]
  ): Array[Float]

  /** Like [[adHocMesh]], returning the vertices and the indices of the faces of the cuboid that contain the segment.
    * The faces are numbered front xy (z = 0), front xz (y = 0), front yz (x = 0), back xy, back xz, back yz.
    */
  def mesh(
      data: Array[Byte],
      bytesPerElement: Int,
      dimensions: Vec3Int,
      segmentId: Long,
      offset: Vec3Float,
      scale: Vec3Float
  ): (Array[Float], List[Int]) = {
    val neighborsOut = new Array[Int](1)
    val vertices = adHocMesh(
      data,
      bytesPerElement,
      Array(dimensions.x, dimensions.y, dimensions.z),
      segmentId,
      Array(offset.x, offset.y, offset.z),
      Array(scale.x, scale.y, scale.z),
      neighborsOut
    )
    (vertices, neighborFaces(neighborsOut(0)))
  }

  private def neighborFaces(neighborMask: Int): List[Int] =
    (0 until 6).filter(face => (neighborMask & (1 << face)) != 0).toList
}
