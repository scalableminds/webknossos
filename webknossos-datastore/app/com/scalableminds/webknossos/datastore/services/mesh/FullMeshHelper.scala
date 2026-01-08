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

  protected def adHocMeshToStl(vertexBuffer: Array[Float]): Array[Byte] = {
    val numFaces = vertexBuffer.length / (3 * 3) // a face has three vertices, a vertex has three floats.
    val outputNumBytes = numFaces * 50
    val output = ByteBuffer.allocate(outputNumBytes).order(ByteOrder.LITTLE_ENDIAN)
    val unused = Array.fill[Byte](2)(0)
    for (faceIndex <- 0 until numFaces) {
      val v1 = Vec3Float(vertexBuffer(faceIndex), vertexBuffer(faceIndex + 1), vertexBuffer(faceIndex + 2))
      val v2 = Vec3Float(vertexBuffer(faceIndex + 3), vertexBuffer(faceIndex + 4), vertexBuffer(faceIndex + 5))
      val v3 = Vec3Float(vertexBuffer(faceIndex + 6), vertexBuffer(faceIndex + 7), vertexBuffer(faceIndex + 8))
      val norm = Vec3Float.crossProduct(v2 - v1, v3 - v1).normalize
      output.putFloat(norm.x)
      output.putFloat(norm.y)
      output.putFloat(norm.z)
      for (vertexIndex <- 0 until 3) {
        for (dimIndex <- 0 until 3) {
          output.putFloat(vertexBuffer(9 * faceIndex + 3 * vertexIndex + dimIndex))
        }
      }
      output.put(unused)
    }
    output.array()
  }

  protected def combineEncodedChunksToStl(stlEncodedChunks: Seq[Array[Byte]]): Array[Byte] = {
    val numFaces = stlEncodedChunks.map(_.length / 50).sum // our stl implementation writes exactly 50 bytes per face
    val constantStlHeader = Array.fill[Byte](80)(0)
    val outputNumBytes = 80 + 4 + stlEncodedChunks.map(_.length).sum
    val output = ByteBuffer.allocate(outputNumBytes).order(ByteOrder.LITTLE_ENDIAN)
    output.put(constantStlHeader)
    output.putInt(numFaces)
    stlEncodedChunks.foreach(output.put)
    output.array()
  }

  protected def logMeshingDuration(before: Instant, label: String, lengthBytes: Int): Unit =
    Instant.logSince(before, s"Served $lengthBytes-byte STL mesh via $label,", logger)

  def surfaceAreaFromStlBytes(stlBytes: Array[Byte]): Box[Double] = tryo {
    val dataBuffer = ByteBuffer.wrap(stlBytes)
    dataBuffer.order(ByteOrder.LITTLE_ENDIAN)
    val numberOfTriangles = java.lang.Integer.toUnsignedLong(dataBuffer.getInt(80))
    val normalOffset = 12
    var surfaceSumMutable = 0.0
    val headerOffset = 84L
    val bytesPerTriangle = 50L
    for (triangleIndex <- 0L until numberOfTriangles) {
      val triangleVerticesOffset = (headerOffset + triangleIndex * bytesPerTriangle + normalOffset).toInt
      val v1x = dataBuffer.getFloat(triangleVerticesOffset + 4 * 0)
      val v1y = dataBuffer.getFloat(triangleVerticesOffset + 4 * 1)
      val v1z = dataBuffer.getFloat(triangleVerticesOffset + 4 * 2)
      val v2x = dataBuffer.getFloat(triangleVerticesOffset + 4 * 3)
      val v2y = dataBuffer.getFloat(triangleVerticesOffset + 4 * 4)
      val v2z = dataBuffer.getFloat(triangleVerticesOffset + 4 * 5)
      val v3x = dataBuffer.getFloat(triangleVerticesOffset + 4 * 6)
      val v3y = dataBuffer.getFloat(triangleVerticesOffset + 4 * 7)
      val v3z = dataBuffer.getFloat(triangleVerticesOffset + 4 * 8)

      val vec1x = (v2x - v1x).toDouble
      val vec1y = (v2y - v1y).toDouble
      val vec1z = (v2z - v1z).toDouble
      val vec2x = (v3x - v1x).toDouble
      val vec2y = (v3y - v1y).toDouble
      val vec2z = (v3z - v1z).toDouble

      val crossx = vec1y * vec2z - vec1z * vec2y
      val crossy = vec1z * vec2x - vec1x * vec2z
      val crossz = vec1x * vec2y - vec1y * vec2x

      val magnitude = Math.sqrt(crossx * crossx + crossy * crossy + crossz * crossz)

      surfaceSumMutable = surfaceSumMutable + (magnitude / 2.0)
    }
    surfaceSumMutable
  }
}
