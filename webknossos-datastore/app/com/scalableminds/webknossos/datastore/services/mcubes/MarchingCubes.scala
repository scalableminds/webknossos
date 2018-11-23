package com.scalableminds.webknossos.datastore.services.mcubes

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}

import scala.collection.mutable

object MarchingCubes {

  def marchingCubes[T](data: Array[T], dataDimensions: Point3D, boundingBox: BoundingBox,
                       segmentId: T, voxelDimensions: Point3D, offset: Vector3D, scale: Vector3D): Array[Float] = {

    def getVoxelData(x: Int, y: Int, z: Int): T =
      data(x + (dataDimensions.x * y) + (dataDimensions.x * dataDimensions.y * z))

    var vertices = mutable.ArrayBuffer[Vector3D]()

    // Volume iteration
    for {
      z <- boundingBox.topLeft.z until boundingBox.bottomRight.z - voxelDimensions.z by voxelDimensions.z
      y <- boundingBox.topLeft.y until boundingBox.bottomRight.y - voxelDimensions.y by voxelDimensions.y
      x <- boundingBox.topLeft.x until boundingBox.bottomRight.x - voxelDimensions.x by voxelDimensions.x
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
      if (getVoxelData(x + voxelDimensions.x, y, z) == segmentId) cubeIndex |= 2
      if (getVoxelData(x, y + voxelDimensions.y, z) == segmentId) cubeIndex |= 8
      if (getVoxelData(x + voxelDimensions.x, y + voxelDimensions.y, z) == segmentId) cubeIndex |= 4
      if (getVoxelData(x, y, z + voxelDimensions.z) == segmentId) cubeIndex |= 16
      if (getVoxelData(x + voxelDimensions.x, y, z + voxelDimensions.z) == segmentId) cubeIndex |= 32
      if (getVoxelData(x, y + voxelDimensions.y, z + voxelDimensions.z) == segmentId) cubeIndex |= 128
      if (getVoxelData(x + voxelDimensions.x, y + voxelDimensions.y, z + voxelDimensions.z) == segmentId) cubeIndex |= 64

      val position = Vector3D(x, y, z)
      MarchingCubesTable.triangleTable(cubeIndex).foreach { edgeDelta =>
        vertices += (position + edgeDelta * Vector3D(voxelDimensions.x, voxelDimensions.y, voxelDimensions.z) + offset) * scale
      }
    }

    vertices.flatMap(_.toList.map(_.toFloat)).toArray
  }
}
