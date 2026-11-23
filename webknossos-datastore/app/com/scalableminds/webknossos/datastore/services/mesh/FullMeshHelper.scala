package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.geometry.{BoundingBox, Vec3Float, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.webknossos.datastore.draco.NativeDracoToStlConverter
import com.scalableminds.webknossos.datastore.models.VoxelPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.typesafe.scalalogging.LazyLogging

import java.nio.{ByteBuffer, ByteOrder}

/** A chunk to measure the surface of a segment in, see [[NativeSegmentSurface]]: the cuboid at topLeft (in voxels of
  * the mag) of the given size, of which the voxels from interiorStart (inclusive) to interiorEnd (exclusive) are the
  * interior.
  */
case class SurfaceChunk(topLeft: Vec3Int, size: Vec3Int, interiorStart: Vec3Int, interiorEnd: Vec3Int)

object SurfaceChunk {

  // Buckets per axis of a group of buckets that may be measured as one chunk, see forSegmentBuckets.
  private val groupLength = 2

  // A group is measured as one chunk if it has at least this many buckets of the segment, see forSegmentBuckets.
  private val minSegmentBucketsPerGroup = 4

  /** The chunks to measure a segment in, given the buckets (in buckets of the mag) that contain it (from the segment
    * index). A chunk loads every bucket its cuboid touches, including the neighbors for its one-voxel border: 27 for
    * the chunk of one bucket, 64 for the chunk of a group of 2×2×2 buckets. A group with at least
    * minSegmentBucketsPerGroup buckets of the segment (at most 16 loads per bucket, for 1.8 times the voxels to scan)
    * is one chunk, which saves loads in the bulky parts of a segment. Every other bucket of the segment is its own
    * chunk, so that thin parts like axons and spines, which fill few buckets of a group, cost the same as with one
    * chunk per bucket. The interiors of the chunks never overlap, and every voxel of the segment lies in one, as
    * NativeSegmentSurface requires.
    */
  def forSegmentBuckets(segmentBuckets: Seq[Vec3Int]): Seq[SurfaceChunk] =
    segmentBuckets.groupBy(_ / Vec3Int.full(groupLength)).toSeq.flatMap { case (group, buckets) =>
      if (buckets.length >= minSegmentBucketsPerGroup) Seq(forBuckets(group * groupLength, groupLength))
      else buckets.map(forBucket)
    }

  /** The chunk whose interior is the bucket at bucketPosition (in buckets of the mag). */
  def forBucket(bucketPosition: Vec3Int): SurfaceChunk = forBuckets(bucketPosition, 1)

  /** The chunk whose interior is the cube of bucketsPerAxis³ buckets starting at firstBucket (in buckets of the mag).
    * Its cuboid extends the interior by one voxel on each side, except below 0, where the dataset has no voxels.
    */
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

trait FullMeshHelper extends LazyLogging {
  protected lazy val dracoToStlConverter = new NativeDracoToStlConverter()

  // 128 = 4 × 32 (storage bucket length), so each axis maps to exactly 4 buckets (as typically produced by WK upload/worker)
  protected lazy val adHocChunkSize: Vec3Int = Vec3Int(128, 128, 128)

  // Upper bound for ad-hoc meshing requests per full mesh, so that huge segments cannot occupy the meshing workers indefinitely
  protected lazy val maxAdHocFullMeshChunks: Int = 25000

  // Upper bound for the buckets to mesh a segment in (see bucketsToMesh), given at most maxAdHocFullMeshChunks buckets
  // of the segment. Compact segments add few buckets, sparse ones up to seven per bucket, which this bounds.
  protected lazy val maxAdHocFullMeshChunksWithNeighbors: Int = 2 * maxAdHocFullMeshChunks

  /** The buckets (in buckets of the mag) to mesh a segment in, given the buckets that contain it (from the segment
    * index): those and the buckets below them in x, y and z, also diagonally. A bucket's cuboid spans the bucket plus
    * one voxel at its high end, so it meshes the cubes whose origin lies in the bucket. A cube touching a voxel of the
    * segment may have its origin in a bucket below, which need not contain the segment itself; without those buckets,
    * the mesh has holes where the segment touches a bucket's lower faces. Buckets below 0 are left out, as the dataset
    * has no voxels there.
    */
  protected def bucketsToMesh(segmentBuckets: Seq[Vec3Int]): Seq[Vec3Int] = {
    val offsets = for {
      dx <- 0 to 1
      dy <- 0 to 1
      dz <- 0 to 1
    } yield Vec3Int(dx, dy, dz)
    segmentBuckets.flatMap(bucket => offsets.map(bucket - _)).filter(p => p.x >= 0 && p.y >= 0 && p.z >= 0).distinct
  }

  protected def generateNextTopLeftsFromNeighbors(
      oldTopLeft: VoxelPosition,
      neighborIds: List[Int],
      chunkSize: Vec3Int,
      visited: collection.mutable.Set[VoxelPosition],
      layerBoundingBox: BoundingBox
  ): List[VoxelPosition] = {
    // front_xy, front_xz, front_yz, back_xy, back_xz, back_yz
    val neighborLookup = Seq(
      Vec3Int(0, 0, -1),
      Vec3Int(0, -1, 0),
      Vec3Int(-1, 0, 0),
      Vec3Int(0, 0, 1),
      Vec3Int(0, 1, 0),
      Vec3Int(1, 0, 0)
    )
    val neighborPositions = neighborIds.map { neighborId =>
      val neighborMultiplier = neighborLookup(neighborId)
      oldTopLeft.move(
        neighborMultiplier.x * chunkSize.x * oldTopLeft.mag.x,
        neighborMultiplier.y * chunkSize.y * oldTopLeft.mag.y,
        neighborMultiplier.z * chunkSize.z * oldTopLeft.mag.z
      )
    }
    neighborPositions.filter(p => !visited.contains(p) && chunkIntersects(p, chunkSize, layerBoundingBox))
  }

  private def chunkIntersects(topLeft: VoxelPosition, chunkSize: Vec3Int, layerBoundingBox: BoundingBox): Boolean =
    BoundingBox(
      Vec3Int(topLeft.mag1X, topLeft.mag1Y, topLeft.mag1Z),
      chunkSize.x * topLeft.mag.x,
      chunkSize.y * topLeft.mag.y,
      chunkSize.z * topLeft.mag.z
    ).intersects(layerBoundingBox)

  protected def adHocMeshToStl(vertexBuffer: Array[Float]): Array[Byte] = {
    val numFaces = vertexBuffer.length / (3 * 3) // a face has three vertices, a vertex has three floats.
    val outputNumBytesLong = numFaces.toLong * 50L
    if (outputNumBytesLong > Int.MaxValue)
      throw new IllegalStateException(
        s"Single mesh chunk is too large to encode as STL: $outputNumBytesLong bytes ($numFaces faces)"
      )
    val output = ByteBuffer.allocate(outputNumBytesLong.toInt).order(ByteOrder.LITTLE_ENDIAN)
    val unused = Array.fill[Byte](2)(0)
    for (faceIndex <- 0 until numFaces) {
      val base = 9 * faceIndex
      val v1 = Vec3Float(vertexBuffer(base), vertexBuffer(base + 1), vertexBuffer(base + 2))
      val v2 = Vec3Float(vertexBuffer(base + 3), vertexBuffer(base + 4), vertexBuffer(base + 5))
      val v3 = Vec3Float(vertexBuffer(base + 6), vertexBuffer(base + 7), vertexBuffer(base + 8))
      val norm = Vec3Float.crossProduct(v2 - v1, v3 - v1).normalize
      output.putFloat(norm.x)
      output.putFloat(norm.y)
      output.putFloat(norm.z)
      for (vertexIndex <- 0 until 3)
        for (dimIndex <- 0 until 3)
          output.putFloat(vertexBuffer(base + 3 * vertexIndex + dimIndex))
      output.put(unused)
    }
    output.array()
  }

  protected def combineEncodedChunksToStl(stlEncodedChunks: Seq[Array[Byte]]): Array[Byte] = {
    val numFacesLong =
      stlEncodedChunks.map(_.length.toLong / 50L).sum // our stl implementation writes exactly 50 bytes per face
    val chunkBytesTotal = stlEncodedChunks.map(_.length.toLong).sum
    val outputNumBytesLong = 80L + 4L + chunkBytesTotal
    if (outputNumBytesLong > Int.MaxValue)
      throw new IllegalStateException(
        s"Mesh is too large to combine into a single STL buffer: $outputNumBytesLong bytes ($numFacesLong faces). " +
          "Use per-chunk surface area computation instead."
      )
    val constantStlHeader = Array.fill[Byte](80)(0)
    val output = ByteBuffer.allocate(outputNumBytesLong.toInt).order(ByteOrder.LITTLE_ENDIAN)
    output.put(constantStlHeader)
    output.putInt(numFacesLong.toInt)
    stlEncodedChunks.foreach(output.put)
    output.array()
  }

  protected def logMeshingDuration(before: Instant, label: String, lengthBytes: Int): Unit =
    Instant.logSince(before, s"Served $lengthBytes-byte STL mesh via $label,", logger)
}
