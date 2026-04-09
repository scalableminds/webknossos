package com.scalableminds.webknossos.datastore.services.mcubes

import com.scalableminds.util.geometry.{BoundingBox, Vec3Float, Vec3Int}

import scala.collection.mutable

object MarchingCubes {

  // vertexIndex maps doubled integer grid coordinates → vertex index in vertexBuffer.
  // All edge-delta components are exactly 0, 0.5 or 1, so multiplying by 2 always yields
  // an exact integer in IEEE 754. This lets us deduplicate with integer keys and no
  // floating-point comparison. Passing vertexIndex in from outside lets a single actor
  // request share vertices across multiple sub-chunk calls.
  def marchingCubes[T](data: Array[T],
                       dataDimensions: Vec3Int,
                       boundingBox: BoundingBox,
                       segmentId: T,
                       offset: Vec3Float,
                       scale: Vec3Float,
                       vertexBuffer: mutable.ArrayBuffer[Float],
                       indexBuffer: mutable.ArrayBuffer[Int],
                       vertexIndex: mutable.HashMap[(Int, Int, Int), Int]): Unit = {

    def getVoxelData(x: Int, y: Int, z: Int): T =
      data(x + (dataDimensions.x * y) + (dataDimensions.x * dataDimensions.y * z))

    // Volume iteration
    for {
      z <- boundingBox.topLeft.z until boundingBox.bottomRight.z - 1
      y <- boundingBox.topLeft.y until boundingBox.bottomRight.y - 1
      x <- boundingBox.topLeft.x until boundingBox.bottomRight.x - 1
    } {
      // Cube vertices
      //              pyz  ___________________  pxyz
      //                  /|                 /|
      //                 / |                / |
      //                /  |               /  |
      //          pz   /___|______________/pxz|
      //              |    |              |   |
      //              |    |              |   |
      //              | py |______________|___| pxy
      //              |   /               |   /
      //              |  /                |  /
      //              | /                 | /
      //              |/__________________|/
      //             p                     px

      // Compute the index into the triangle table
      var cubeIndex = 0
      if (getVoxelData(x, y, z) == segmentId) cubeIndex |= 1
      if (getVoxelData(x + 1, y, z) == segmentId) cubeIndex |= 2
      if (getVoxelData(x, y + 1, z) == segmentId) cubeIndex |= 8
      if (getVoxelData(x + 1, y + 1, z) == segmentId) cubeIndex |= 4
      if (getVoxelData(x, y, z + 1) == segmentId) cubeIndex |= 16
      if (getVoxelData(x + 1, y, z + 1) == segmentId) cubeIndex |= 32
      if (getVoxelData(x, y + 1, z + 1) == segmentId) cubeIndex |= 128
      if (getVoxelData(x + 1, y + 1, z + 1) == segmentId) cubeIndex |= 64

      val edgeDeltas = MarchingCubesTable.triangleTable(cubeIndex)
      var i = 0
      while (i < edgeDeltas.length) {
        // One triangle: look up or register each of its 3 vertices
        var j = 0
        while (j < 3) {
          val ed = edgeDeltas(i + j)
          // Key uses doubled integer coordinates — exact because ed components are 0, 0.5 or 1
          val key = (x * 2 + (ed.x * 2f).toInt, y * 2 + (ed.y * 2f).toInt, z * 2 + (ed.z * 2f).toInt)
          val vertIdx = vertexIndex.getOrElseUpdate(key, {
            val newIdx = vertexBuffer.length / 3
            vertexBuffer += (x + ed.x + offset.x) * scale.x
            vertexBuffer += (y + ed.y + offset.y) * scale.y
            vertexBuffer += (z + ed.z + offset.z) * scale.z
            newIdx
          })
          indexBuffer += vertIdx
          j += 1
        }
        i += 3
      }
    }
  }
}
