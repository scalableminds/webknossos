package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.webknossos.datastore.helpers.NativeLibrary

/** The surface area and voxel count of a segment, or of the part of it in one chunk.
  *
  * @param area
  *   the area of the segment's marching cubes surface (the surface of its ad-hoc mesh), in the unit of the voxel size,
  *   squared
  * @param voxelCount
  *   in the mag the surface was measured in
  */
case class SegmentSurface(area: Double, voxelCount: Long) {
  def +(other: SegmentSurface): SegmentSurface = SegmentSurface(area + other.area, voxelCount + other.voxelCount)
}

object SegmentSurface {
  val empty: SegmentSurface = SegmentSurface(0.0, 0L)
}

class NativeSegmentSurface {
  NativeLibrary.ensureLoaded()

  /** Measures the surface and the voxels of one segment in the interior of a chunk
    * (webknossos-native/src/segment_surface.rs). Summing the chunks whose interiors partition a segment gives the
    * segment's surface and voxel count, provided each cuboid contains its interior plus one voxel on each side (where
    * the dataset has one).
    *
    * @param data
    *   the cuboid as little-endian elements, x fastest
    * @param segmentId
    *   compared with the raw bits of each element, so only its low bytesPerElement bytes matter
    * @param interiorStart
    *   the first voxel of the interior, in voxels of the cuboid
    * @param interiorEnd
    *   the voxel after the last one of the interior, in voxels of the cuboid
    * @param scale
    *   the size of a voxel
    * @return
    *   the area and the voxel count (as a double)
    */
  @native def measure(
      data: Array[Byte],
      bytesPerElement: Int,
      dimensions: Array[Int],
      segmentId: Long,
      interiorStart: Array[Int],
      interiorEnd: Array[Int],
      scale: Array[Double]
  ): Array[Double]

  def measureSurface(
      data: Array[Byte],
      bytesPerElement: Int,
      dimensions: Vec3Int,
      segmentId: Long,
      interiorStart: Vec3Int,
      interiorEnd: Vec3Int,
      scale: Vec3Double
  ): SegmentSurface = {
    val result = measure(
      data,
      bytesPerElement,
      dimensions.toArray,
      segmentId,
      interiorStart.toArray,
      interiorEnd.toArray,
      Array(scale.x, scale.y, scale.z)
    )
    SegmentSurface(result(0), result(1).toLong)
  }
}
