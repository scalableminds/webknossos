package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.Msg
import com.scalableminds.util.geometry.{BoundingBox, Vec3Float, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.draco.NativeDracoToStlConverter
import com.scalableminds.webknossos.datastore.models.VoxelPosition
import com.typesafe.scalalogging.LazyLogging

import java.nio.{ByteBuffer, ByteOrder}
import scala.concurrent.ExecutionContext

trait FullMeshHelper extends LazyLogging {
  protected lazy val dracoToStlConverter = new NativeDracoToStlConverter()

  // 128 = 4 × 32 (storage bucket length), so each axis maps to exactly 4 buckets (as typically produced by WK upload/worker)
  protected lazy val adHocChunkSize: Vec3Int = Vec3Int(128, 128, 128)

  // Upper bound for ad-hoc meshing requests per full mesh, so that huge segments cannot occupy the meshing workers indefinitely
  protected lazy val maxAdHocFullMeshChunks: Int = 25000

  // Upper bound for the buckets to mesh a segment in (see bucketsToMesh), given at most maxAdHocFullMeshChunks buckets
  // of the segment. Compact segments add few buckets, sparse ones up to seven per bucket, which this bounds.
  protected lazy val maxAdHocFullMeshChunksWithNeighbors: Int = 2 * maxAdHocFullMeshChunks

  /** The buckets (in buckets of the mag) to mesh a segment in: the segment's buckets and the ones below them in x, y
    * and z, also diagonally. A bucket meshes the cubes whose origin lies in it, and a cube touching the segment can
    * have its origin in a lower bucket without the segment. Without those, the mesh has holes at the lower bucket
    * faces.
    */
  protected def bucketsToMesh(segmentBuckets: Seq[Vec3Int]): Seq[Vec3Int] = {
    val offsets = for {
      dx <- 0 to 1
      dy <- 0 to 1
      dz <- 0 to 1
    } yield Vec3Int(dx, dy, dz)
    segmentBuckets.flatMap(bucket => offsets.map(bucket - _)).filter(p => p.x >= 0 && p.y >= 0 && p.z >= 0).distinct
  }

  // The mag of an ad-hoc meshing or surface request, which must not be for segment 0.
  protected def adHocMag(fullMeshRequest: FullMeshRequest)(using ec: ExecutionContext): Fox[Vec3Int] =
    for {
      mag <- fullMeshRequest.mag.toFox ?~> Msg.Mesh.magNeededForAdHoc
      _ <- Fox.fromBool(fullMeshRequest.segmentId.toLong != 0L) ?~> Msg.Mesh.segmentIdZeroForAdHoc
    } yield mag

  /** Measures a segment in the chunks of [[SurfaceChunk.forSegmentBuckets]] and sums them, keeping up to parallelism
    * chunks in flight, as each one waits for its buckets to load.
    */
  protected def measureSurfaceInChunks(segmentBuckets: Seq[Vec3Int], parallelism: Int)(
      measureChunk: SurfaceChunk => Fox[SegmentSurface]
  )(using ec: ExecutionContext): Fox[SegmentSurface] =
    for {
      surfaces <- Fox.batchCombined(SurfaceChunk.forSegmentBuckets(segmentBuckets), parallelism)(measureChunk)
    } yield surfaces.foldLeft(SegmentSurface.empty)(_ + _)

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
