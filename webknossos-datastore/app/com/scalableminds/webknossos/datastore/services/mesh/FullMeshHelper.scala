package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.geometry.{Vec3Float, Vec3Int}
import com.scalableminds.util.time.Instant
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

}
