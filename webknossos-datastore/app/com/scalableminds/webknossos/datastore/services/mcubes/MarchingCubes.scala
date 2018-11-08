package com.scalableminds.webknossos.datastore.services.mcubes

import java.nio.IntBuffer

import com.scalableminds.util.geometry.{BoundingBox, Point3D}

import scala.collection.mutable

object MarchingCubes {

  import java.util

  def lerp(vec1: Array[Float], vec2: Array[Float], alpha: Float): Array[Float] = Array[Float](vec1(0) + (vec2(0) - vec1(0)) * alpha, vec1(1) + (vec2(1) - vec1(1)) * alpha, vec1(2) + (vec2(2) - vec1(2)) * alpha)

  def marchingCubes[T](data: Array[T], dimensions: Point3D, boundingBox: BoundingBox, segmentId: Int, offset: Point3D, scale: Point3D): Array[Float] = {
    var vertices = mutable.ArrayBuffer[Float]()
    val voxDim = Point3D(8, 8, 8)
    val vertList = Array.ofDim[Float](12, 3)

    // Volume iteration
    for {
      z <- boundingBox.topLeft.z until boundingBox.bottomRight.z - voxDim.z by voxDim.z
      y <- boundingBox.topLeft.y until boundingBox.bottomRight.y - voxDim.y by voxDim.y
      x <- boundingBox.topLeft.x until boundingBox.bottomRight.x - voxDim.x by voxDim.x
    } {
      // Indices pointing to cube vertices
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
      val p = x + (dimensions.x * y) + (dimensions.x * dimensions.y * z)
      val px = p + voxDim.x
      val py = p + dimensions.x * voxDim.y
      val pxy = py + voxDim.x
      val pz = p + dimensions.x * dimensions.y * voxDim.z
      val pxz = px + dimensions.x * dimensions.y * voxDim.z
      val pyz = py + dimensions.x * dimensions.y * voxDim.z
      val pxyz = pxy + dimensions.x * dimensions.y * voxDim.z

      //							  X              Y                    Z
      val position = Array[Float](x, y, z)

      // Voxel intensities
      val value0 = data(p)
      val value1 = data(px)
      val value2 = data(py)
      val value3 = data(pxy)
      val value4 = data(pz)
      val value5 = data(pxz)
      val value6 = data(pyz)
      val value7 = data(pxyz)

      // Voxel is active if segmentId matches
      var cubeIndex = 0
      if (value0 == segmentId) cubeIndex |= 1
      if (value1 == segmentId) cubeIndex |= 2
      if (value2 == segmentId) cubeIndex |= 8
      if (value3 == segmentId) cubeIndex |= 4
      if (value4 == segmentId) cubeIndex |= 16
      if (value5 == segmentId) cubeIndex |= 32
      if (value6 == segmentId) cubeIndex |= 128
      if (value7 == segmentId) cubeIndex |= 64

      // Fetch the triggered edges
      val bits = MarchingCubesTables.edgeTable(cubeIndex)

      // If no edge is triggered... skip
      // TODO: if (bits == 0) continue

      // Interpolate the positions based on voxel intensities
      val mu = 0.5f
      // bottom of the cube
      if ((bits & 1) != 0) {
        vertList(0) = lerp(position, Array[Float](position(0) + voxDim.x, position(1), position(2)), mu)
      }
      if ((bits & 2) != 0) {
        vertList(1) = lerp(Array[Float](position(0) + voxDim.x, position(1), position(2)), Array[Float](position(0) + voxDim.x, position(1) + voxDim.y, position(2)), mu)
      }
      if ((bits & 4) != 0) {
        vertList(2) = lerp(Array[Float](position(0), position(1) + voxDim.y, position(2)), Array[Float](position(0) + voxDim.x, position(1) + voxDim.y, position(2)), mu)
      }
      if ((bits & 8) != 0) {
        vertList(3) = lerp(position, Array[Float](position(0), position(1) + voxDim.y, position(2)), mu)
      }
      // top of the cube
      if ((bits & 16) != 0) {
        vertList(4) = lerp(Array[Float](position(0), position(1), position(2) + voxDim.z), Array[Float](position(0) + voxDim.x, position(1), position(2) + voxDim.z), mu)
      }
      if ((bits & 32) != 0) {
        vertList(5) = lerp(Array[Float](position(0) + voxDim.x, position(1), position(2) + voxDim.z), Array[Float](position(0) + voxDim.x, position(1) + voxDim.y, position(2) + voxDim.z), mu)
      }
      if ((bits & 64) != 0) {
        vertList(6) = lerp(Array[Float](position(0), position(1) + voxDim.y, position(2) + voxDim.z), Array[Float](position(0) + voxDim.x, position(1) + voxDim.y, position(2) + voxDim.z), mu)
      }
      if ((bits & 128) != 0) {
        vertList(7) = lerp(Array[Float](position(0), position(1), position(2) + voxDim.z), Array[Float](position(0), position(1) + voxDim.y, position(2) + voxDim.z), mu)
      }
      // vertical lines of the cube
      if ((bits & 256) != 0) {
        vertList(8) = lerp(position, Array[Float](position(0), position(1), position(2) + voxDim.z), mu)
      }
      if ((bits & 512) != 0) {
        vertList(9) = lerp(Array[Float](position(0) + voxDim.x, position(1), position(2)), Array[Float](position(0) + voxDim.x, position(1), position(2) + voxDim.z), mu)
      }
      if ((bits & 1024) != 0) {
        vertList(10) = lerp(Array[Float](position(0) + voxDim.x, position(1) + voxDim.y, position(2)), Array[Float](position(0) + voxDim.x, position(1) + voxDim.y, position(2) + voxDim.z), mu)
      }
      if ((bits & 2048) != 0) {
        vertList(11) = lerp(Array[Float](position(0), position(1) + voxDim.y, position(2)), Array[Float](position(0), position(1) + voxDim.y, position(2) + voxDim.z), mu)
      }

      // construct triangles -- get correct vertices from triTable.
      var i = 0
      // "Re-purpose cubeIndex into an offset into triTable."
      cubeIndex <<= 4
      while (MarchingCubesTables.triangleTable(cubeIndex + i) != -1) {
        val index1 = MarchingCubesTables.triangleTable(cubeIndex + i)
        val index2 = MarchingCubesTables.triangleTable(cubeIndex + i + 1)
        val index3 = MarchingCubesTables.triangleTable(cubeIndex + i + 2)
        // Add triangles vertices normalized with the maximal possible value
        vertices += vertList(index3)(0) * scale.x + offset.x
        vertices += vertList(index3)(1) * scale.y + offset.y
        vertices += vertList(index3)(2) * scale.z + offset.z
        vertices += vertList(index2)(0) * scale.x + offset.x
        vertices += vertList(index2)(1) * scale.y + offset.y
        vertices += vertList(index2)(2) * scale.z + offset.z
        vertices += vertList(index1)(0) * scale.x + offset.x
        vertices += vertList(index1)(1) * scale.y + offset.y
        vertices += vertList(index1)(2) * scale.z + offset.z
        i += 3
      }
    }

    vertices.toArray
  }
}
