package com.scalableminds.webknossos.datastore.services.mcubes

import com.scalableminds.util.geometry.{BoundingBox, Vector3D, Vector3I}

import scala.collection.mutable

object MarchingCubes {

  def marchingCubes[T](data: Array[T],
                       dataDimensions: Vector3I,
                       boundingBox: BoundingBox,
                       segmentId: T,
                       voxelDimensions: Vector3D,
                       offset: Vector3D,
                       scale: Vector3D,
                       vertexBuffer: mutable.ArrayBuffer[Vector3D]) {

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

      val position = Vector3D(x, y, z)
      MarchingCubesTable.triangleTable(cubeIndex).foreach { edgeDelta =>
        vertexBuffer += ((position + edgeDelta) * voxelDimensions + offset) * scale
      }
    }
  }
}
