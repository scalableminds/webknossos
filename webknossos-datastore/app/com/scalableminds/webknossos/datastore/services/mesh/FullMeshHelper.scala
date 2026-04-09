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

  protected lazy val adHocChunkSize: Vec3Int = Vec3Int(100, 100, 100)

  protected def generateNextTopLeftsFromNeighbors(
      oldTopLeft: VoxelPosition,
      neighborIds: List[Int],
      chunkSize: Vec3Int,
      visited: collection.mutable.Set[VoxelPosition]): List[VoxelPosition] = {
    // front_xy, front_xz, front_yz, back_xy, back_xz, back_yz
    val neighborLookup = Seq(
      Vec3Int(0, 0, -1),
      Vec3Int(0, -1, 0),
      Vec3Int(-1, 0, 0),
      Vec3Int(0, 0, 1),
      Vec3Int(0, 1, 0),
      Vec3Int(1, 0, 0),
    )
    val neighborPositions = neighborIds.map { neighborId =>
      val neighborMultiplier = neighborLookup(neighborId)
      oldTopLeft.move(neighborMultiplier.x * chunkSize.x * oldTopLeft.mag.x,
                      neighborMultiplier.y * chunkSize.y * oldTopLeft.mag.y,
                      neighborMultiplier.z * chunkSize.z * oldTopLeft.mag.z)
    }
    neighborPositions.filterNot(visited.contains)
  }

  protected def adHocMeshToStl(vertices: Array[Float], indices: Array[Int]): Array[Byte] = {
    val numFaces = indices.length / 3
    val outputNumBytesLong = numFaces.toLong * 50L
    if (outputNumBytesLong > Int.MaxValue)
      throw new IllegalStateException(
        s"Single mesh chunk is too large to encode as STL: $outputNumBytesLong bytes ($numFaces faces)")
    val output = ByteBuffer.allocate(outputNumBytesLong.toInt).order(ByteOrder.LITTLE_ENDIAN)
    val unused = Array.fill[Byte](2)(0)
    var i = 0
    while (i < indices.length) {
      val b0 = indices(i) * 3
      val b1 = indices(i + 1) * 3
      val b2 = indices(i + 2) * 3
      val v1 = Vec3Float(vertices(b0), vertices(b0 + 1), vertices(b0 + 2))
      val v2 = Vec3Float(vertices(b1), vertices(b1 + 1), vertices(b1 + 2))
      val v3 = Vec3Float(vertices(b2), vertices(b2 + 1), vertices(b2 + 2))
      val norm = Vec3Float.crossProduct(v2 - v1, v3 - v1).normalize
      output.putFloat(norm.x)
      output.putFloat(norm.y)
      output.putFloat(norm.z)
      output.putFloat(v1.x); output.putFloat(v1.y); output.putFloat(v1.z)
      output.putFloat(v2.x); output.putFloat(v2.y); output.putFloat(v2.z)
      output.putFloat(v3.x); output.putFloat(v3.y); output.putFloat(v3.z)
      output.put(unused)
      i += 3
    }
    output.array()
  }

  def surfaceAreaFromIndexedMesh(vertices: Array[Float], indices: Array[Int]): Float = {
    var surfaceSum = 0.0f
    var i = 0
    while (i < indices.length) {
      val b0 = indices(i) * 3
      val b1 = indices(i + 1) * 3
      val b2 = indices(i + 2) * 3
      val v1x = vertices(b0); val v1y = vertices(b0 + 1); val v1z = vertices(b0 + 2)
      val v2x = vertices(b1); val v2y = vertices(b1 + 1); val v2z = vertices(b1 + 2)
      val v3x = vertices(b2); val v3y = vertices(b2 + 1); val v3z = vertices(b2 + 2)
      // Edge vectors from v1
      val e1x = v2x - v1x; val e1y = v2y - v1y; val e1z = v2z - v1z // v1→v2
      val e2x = v3x - v1x; val e2y = v3y - v1y; val e2z = v3z - v1z // v1→v3
      // |e1 × e2| = twice the triangle area
      val cx = e1y * e2z - e1z * e2y
      val cy = e1z * e2x - e1x * e2z
      val cz = e1x * e2y - e1y * e2x
      surfaceSum += Math.sqrt(cx * cx + cy * cy + cz * cz).toFloat / 2.0f
      i += 3
    }
    surfaceSum
  }

  protected def combineEncodedChunksToStl(stlEncodedChunks: Seq[Array[Byte]]): Array[Byte] = {
    val numFacesLong = stlEncodedChunks.map(_.length.toLong / 50L).sum // our stl implementation writes exactly 50 bytes per face
    val chunkBytesTotal = stlEncodedChunks.map(_.length.toLong).sum
    val outputNumBytesLong = 80L + 4L + chunkBytesTotal
    if (outputNumBytesLong > Int.MaxValue)
      throw new IllegalStateException(
        s"Mesh is too large to combine into a single STL buffer: $outputNumBytesLong bytes (${numFacesLong} faces). " +
          "Use per-chunk surface area computation instead.")
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
    for (faceIndex <- 0 until numFaces) {
      // Skip the normal vector at the start of each face record; read the three vertices directly
      val base = faceIndex * 50 + normalSize
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
    val dataBuffer = ByteBuffer.wrap(stlBytes)
    dataBuffer.order(ByteOrder.LITTLE_ENDIAN)
    val numberOfTriangles = dataBuffer.getInt(80)
    val normalOffset = 12
    var surfaceSumMutable = 0.0f
    val headerOffset = 84
    val bytesPerTriangle = 50
    for (triangleIndex <- 0 until numberOfTriangles) {
      val triangleVerticesOffset =
        (headerOffset.toLong + triangleIndex.toLong * bytesPerTriangle.toLong + normalOffset.toLong).toInt
      val v1x = dataBuffer.getFloat(triangleVerticesOffset + 4 * 0)
      val v1y = dataBuffer.getFloat(triangleVerticesOffset + 4 * 1)
      val v1z = dataBuffer.getFloat(triangleVerticesOffset + 4 * 2)
      val v2x = dataBuffer.getFloat(triangleVerticesOffset + 4 * 3)
      val v2y = dataBuffer.getFloat(triangleVerticesOffset + 4 * 4)
      val v2z = dataBuffer.getFloat(triangleVerticesOffset + 4 * 5)
      val v3x = dataBuffer.getFloat(triangleVerticesOffset + 4 * 6)
      val v3y = dataBuffer.getFloat(triangleVerticesOffset + 4 * 7)
      val v3z = dataBuffer.getFloat(triangleVerticesOffset + 4 * 8)

      val vec1x = v2x - v1x
      val vec1y = v2y - v1y
      val vec1z = v2z - v1z
      val vec2x = v3x - v1x
      val vec2y = v3y - v1y
      val vec2z = v3z - v1z

      val crossx = vec1y * vec2z - vec1z * vec2y
      val crossy = vec1z * vec2x - vec1x * vec2z
      val crossz = vec1x * vec2y - vec1y * vec2x

      val magnitude = Math.sqrt(crossx * crossx + crossy * crossy + crossz * crossz).toFloat

      surfaceSumMutable = surfaceSumMutable + (magnitude / 2.0f)
    }
    surfaceSumMutable
  }
}
