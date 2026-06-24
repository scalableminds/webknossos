package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.geometry.{Vec3Float, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Box
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.webknossos.datastore.draco.NativeDracoToStlConverter
import com.scalableminds.webknossos.datastore.models.VoxelPosition
import com.typesafe.scalalogging.LazyLogging

import java.nio.{ByteBuffer, ByteOrder}

trait FullMeshHelper extends LazyLogging {
  protected lazy val dracoToStlConverter = new NativeDracoToStlConverter()

  // 128 = 4 × 32 (storage bucket length), so each axis maps to exactly 4 buckets (as typically produced by WK upload/worker)
  protected lazy val adHocChunkSize: Vec3Int = Vec3Int(128, 128, 128)

  protected def generateNextTopLeftsFromNeighbors(
      oldTopLeft: VoxelPosition,
      neighborIds: List[Int],
      chunkSize: Vec3Int,
      visited: collection.mutable.Set[VoxelPosition]
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
    neighborPositions.filterNot(visited.contains)
  }

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
      val v1 = Vec3Float(vertexBuffer(faceIndex), vertexBuffer(faceIndex + 1), vertexBuffer(faceIndex + 2))
      val v2 = Vec3Float(vertexBuffer(faceIndex + 3), vertexBuffer(faceIndex + 4), vertexBuffer(faceIndex + 5))
      val v3 = Vec3Float(vertexBuffer(faceIndex + 6), vertexBuffer(faceIndex + 7), vertexBuffer(faceIndex + 8))
      val norm = Vec3Float.crossProduct(v2 - v1, v3 - v1).normalize
      output.putFloat(norm.x)
      output.putFloat(norm.y)
      output.putFloat(norm.z)
      for (vertexIndex <- 0 until 3)
        for (dimIndex <- 0 until 3)
          output.putFloat(vertexBuffer(9 * faceIndex + 3 * vertexIndex + dimIndex))
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
        s"Mesh is too large to combine into a single STL buffer: $outputNumBytesLong bytes (${numFacesLong} faces). " +
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

  // Computes surface area from the raw per-chunk bytes produced by adHocMeshToStl
  // (50 bytes per face, no 84-byte STL header). Chunks produced by ad-hoc meshing or
  // dracoToStl are non-overlapping (adjacent chunks are spaced chunkSize apart while
  // each chunk samples chunkSize+1 voxels, so their marching-cubes cells share no
  // boundary), meaning the sum of per-chunk areas equals the total surface area.
  def surfaceAreaFromRawChunkStlBytes(chunkBytes: Array[Byte]): Float = {
    val dataBuffer = ByteBuffer.wrap(chunkBytes).order(ByteOrder.LITTLE_ENDIAN)
    val numFaces = chunkBytes.length / 50
    val normalSize = 12 // each face starts with a normal vector: 3 floats × 4 bytes
    var surfaceSum = 0.0f
    val bytesPerFace = 50
    for (faceIndex <- 0 until numFaces) {
      // Skip the normal vector at the start of each face record; read the three vertices directly
      val base = faceIndex * bytesPerFace + normalSize
      val v1x = dataBuffer.getFloat(base)
      val v1y = dataBuffer.getFloat(base + 4)
      val v1z = dataBuffer.getFloat(base + 8)
      val v2x = dataBuffer.getFloat(base + 12)
      val v2y = dataBuffer.getFloat(base + 16)
      val v2z = dataBuffer.getFloat(base + 20)
      val v3x = dataBuffer.getFloat(base + 24)
      val v3y = dataBuffer.getFloat(base + 28)
      val v3z = dataBuffer.getFloat(base + 32)

      // Build two edge vectors from v1
      val e1x = v2x - v1x; val e1y = v2y - v1y; val e1z = v2z - v1z // edge v1→v2
      val e2x = v3x - v1x; val e2y = v3y - v1y; val e2z = v3z - v1z // edge v1→v3

      // Cross product e1 × e2; its magnitude equals twice the triangle area
      val cx = e1y * e2z - e1z * e2y
      val cy = e1z * e2x - e1x * e2z
      val cz = e1x * e2y - e1y * e2x
      surfaceSum += Math.sqrt(cx * cx + cy * cy + cz * cz).toFloat / 2.0f
    }
    surfaceSum
  }

  def surfaceAreaFromStlBytes(stlBytes: Array[Byte]): Box[Float] = tryo {
    val stlHeaderSize = 84
    surfaceAreaFromRawChunkStlBytes(stlBytes.drop(stlHeaderSize))
  }
}
