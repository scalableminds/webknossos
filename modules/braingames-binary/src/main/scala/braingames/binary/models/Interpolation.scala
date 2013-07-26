package braingames.binary.models

import braingames.util.Interpolator
import braingames.geometry.Point3D
import braingames.geometry.Vector3D
import braingames.util.ExtendedTypes.ExtendedDouble

trait Interpolation {
  def interpolate(
    bytesPerElement: Int,
    byteLoader: (Point3D) => Array[Byte])(point: Vector3D): Array[Byte]
}

object TrilerpInterpolation extends Interpolation {

  def getColor(byteLoader: (Point3D) => Array[Byte])(point: Point3D): Array[Double] = {
    byteLoader(point).map(b => (0xff & b.asInstanceOf[Int]).asInstanceOf[Double])
  }

  def interpolate(
    bytesPerElement: Int,
    byteLoader: (Point3D) => Array[Byte])(point: Vector3D): Array[Byte] = {

    val x = point.x.castToInt
    val y = point.y.castToInt
    val z = point.z.castToInt

    if (point.x == x && point.y == y & point.z == z) {
      byteLoader(Point3D(x,y,z))
    } else {
      val colorF = getColor(byteLoader) _
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

      Interpolator.triLerp(point - floored, q, bytesPerElement).map(_.round.toByte)
    }
  }
}

object NearestNeighborInterpolation extends Interpolation {

  def interpolate(
    bytesPerElement: Int,
    byteLoader: (Point3D) => Array[Byte])(point: Vector3D): Array[Byte] = {

    byteLoader(Point3D(point.x.round.toInt, point.y.round.toInt, point.z.round.toInt))
  }
}