package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.webknossos.datastore.helpers.NativeLibrary
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer

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

/** A chunk to measure a segment in: the cuboid at topLeft (in voxels of the mag) of the given size. Only the voxels
  * from interiorStart (inclusive) to interiorEnd (exclusive) belong to the chunk, see [[NativeSegmentSurface]].
  */
case class SurfaceChunk(topLeft: Vec3Int, size: Vec3Int, interiorStart: Vec3Int, interiorEnd: Vec3Int)

object SurfaceChunk {

  // Buckets per axis of a group of buckets that may be measured as one chunk.
  private val groupLength = 2

  // A group with at least this many buckets of the segment is measured as one chunk.
  private val minSegmentBucketsPerGroup = 4

  /** The chunks to measure a segment in, given its buckets from the segment index (in buckets of the mag). A chunk
    * loads all buckets its cuboid touches: 27 for one bucket, 64 for a 2×2×2 group. So a group with at least
    * minSegmentBucketsPerGroup buckets of the segment becomes one chunk, which saves loads in bulky parts. All other
    * buckets stay single chunks, so thin parts like axons cost the same as before. The interiors never overlap and
    * cover every voxel of the segment.
    */
  def forSegmentBuckets(segmentBuckets: Seq[Vec3Int]): Seq[SurfaceChunk] =
    segmentBuckets.groupBy(_ / Vec3Int.full(groupLength)).toSeq.flatMap { case (group, buckets) =>
      if (buckets.length >= minSegmentBucketsPerGroup) Seq(forBuckets(group * groupLength, groupLength))
      else buckets.map(forBucket)
    }

  def forBucket(bucketPosition: Vec3Int): SurfaceChunk = forBuckets(bucketPosition, 1)

  // The chunk whose interior is the cube of bucketsPerAxis³ buckets at firstBucket. Its cuboid adds one voxel on each
  // side, except below 0, where the dataset has no voxels.
  private def forBuckets(firstBucket: Vec3Int, bucketsPerAxis: Int): SurfaceChunk = {
    val interiorTopLeft = firstBucket * DataLayer.bucketLength
    val topLeft = Vec3Int(
      Math.max(interiorTopLeft.x - 1, 0),
      Math.max(interiorTopLeft.y - 1, 0),
      Math.max(interiorTopLeft.z - 1, 0)
    )
    val interiorStart = interiorTopLeft - topLeft
    val interiorEnd = interiorStart + Vec3Int.full(DataLayer.bucketLength * bucketsPerAxis)
    SurfaceChunk(topLeft, interiorEnd + Vec3Int.ones, interiorStart, interiorEnd)
  }
}

class NativeSegmentSurface {
  NativeLibrary.ensureLoaded()

  /** Measures one segment in the interior of a chunk (webknossos-native/src/segment_surface.rs). The chunks of
    * [[SurfaceChunk.forSegmentBuckets]] sum to the segment's surface and voxel count.
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
