package braingames.binary.models

import braingames.util.Interpolator
import braingames.geometry.Point3D
import braingames.geometry.Vector3D

trait Interpolation {
  def interpolate(
    resolution: Int,
    blockMap: Map[Point3D, Array[Byte]],
    bytesPerElement: Int,
    byteLoader: (Point3D, Int, Int, Map[Point3D, Array[Byte]]) => Array[Byte])(point: Vector3D): Array[Byte]
}

object TrilerpInterpolation extends Interpolation {

  def getColor(
    byteLoader: (Point3D, Int, Int, Map[Point3D, Array[Byte]]) => Array[Byte],
    resolution: Int,
    blockMap: Map[Point3D, Array[Byte]])(point: Point3D): Double = {

    val color = byteLoader(point, 1, resolution, blockMap)(0)
    (0xff & color.asInstanceOf[Int])
  }

  def interpolate(
    resolution: Int,
    blockMap: Map[Point3D, Array[Byte]],
    bytesPerElement: Int,
    byteLoader: (Point3D, Int, Int, Map[Point3D, Array[Byte]]) => Array[Byte])(point: Vector3D): Array[Byte] = {

    val colorF = getColor(byteLoader, resolution, blockMap) _
    val x = point.x.toInt
    val y = point.y.toInt
    val z = point.z.toInt

    if (point.x == x && point.y == y & point.z == z) {
      Array(colorF(Point3D(x, y, z)).toByte)
    } else {
      val floored = Vector3D(x, y, z)
      val q = Array(
        colorF(Point3D(x, y, z)),
        colorF(Point3D(x, y, z + 1)),
        colorF(Point3D(x, y + 1, z)),
        colorF(Point3D(x, y + 1, z + 1)),
        colorF(Point3D(x + 1, y, z)),
        colorF(Point3D(x + 1, y, z + 1)),
        colorF(Point3D(x + 1, y + 1, z)),
        colorF(Point3D(x + 1, y + 1, z + 1)))

      Array(Interpolator.triLerp(point - floored, q).round.toByte)
    }
  }
}

object NearestNeighborInterpolation extends Interpolation {

  def interpolate(
    resolution: Int,
    blockMap: Map[Point3D, Array[Byte]],
    bytesPerElement: Int,
    byteLoader: (Point3D, Int, Int, Map[Point3D, Array[Byte]]) => Array[Byte])(point: Vector3D): Array[Byte] = {

    val byte = point.x % bytesPerElement
    val x = (point.x - byte + (if (bytesPerElement - 2 * byte >= 0) 0 else bytesPerElement)).toInt
    byteLoader(Point3D(x, point.y.round.toInt, point.z.round.toInt), bytesPerElement, resolution, blockMap)
  }
}