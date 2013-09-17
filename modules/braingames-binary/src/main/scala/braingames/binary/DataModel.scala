package braingames.binary

import scala.math._
import braingames.util.Math._
import braingames.geometry._
import scala.reflect.ClassTag

/**
 * All possible data models the client should be able to request need to be defined here and registered in Boot.scala
 * A binary data model defines which binary data is responded given a viewpoint and an axis
 */

abstract class DataModel {

  protected def rotateAndMove(
    moveVector: (Double, Double, Double),
    axis: (Double, Double, Double),
    coordinates: Array[Vector3D]): Array[Vector3D] = {
    def ff(f: (Double, Double, Double) => Array[Vector3D]): Array[Vector3D] = {
      coordinates.map(c => f(c.x, c.y, c.z)(0))
    }

    rotateAndMove(moveVector, axis)(ff)((x, y, z) => Array(Vector3D(x, y, z)))
  }

  @inline
  protected def rotateAndMove[T](
    moveVector: (Double, Double, Double),
    axis: (Double, Double, Double))(coordinates: ((Double, Double, Double) => Array[T]) => Array[T])(f: (Double, Double, Double) => Array[T]): Array[T] = {

    if (axis._1 == 0 && axis._2 == 0 && axis._3 == 0) {
      simpleMove(moveVector, coordinates)(f)
    } else {
      // orthogonal vector to (0,1,0) and rotation vector
      val matrix = TransformationMatrix(Vector3D(moveVector), Vector3D(axis)).value

      @inline
      def coordinateTransformer(px: Double, py: Double, pz: Double) = {
        f(matrix(0) * px + matrix(1) * py + matrix(2) * pz + matrix(3),
          matrix(4) * px + matrix(5) * py + matrix(6) * pz + matrix(7),
          matrix(8) * px + matrix(9) * py + matrix(10) * pz + matrix(11))
      }

      coordinates(coordinateTransformer)
    }
  }

  @inline
  protected def simpleMove[T](
    moveVector: (Double, Double, Double),
    coordinates: ((Double, Double, Double) => Array[T]) => Array[T])(f: (Double, Double, Double) => Array[T]): Array[T] = {
    coordinates { (px, py, pz) =>
      val x = moveVector._1 + px
      val y = moveVector._2 + py
      val z = moveVector._3 + pz
      f(x, y, z)
    }
  }

  def normalizeVector(v: Tuple3[Double, Double, Double]): Tuple3[Double, Double, Double] = {
    var l = sqrt(square(v._1) + square(v._2) + square(v._3))
    if (l > 0) (v._1 / l, v._2 / l, v._3 / l) else v
  }

  // calculate all coordinates which are in the model boundary
  def withContainingCoordinates[T](extendArrayBy: Int = 1)(f: (Double, Double, Double) => Array[T])(implicit c: ClassTag[T]): Array[T]
}

case class Cuboid(
    _width: Int,
    _height: Int,
    _depth: Int,
    resolution: Int = 1,
    topLeftOpt: Option[Vector3D] = None,
    moveVector: (Double, Double, Double) = (0, 0, 0),
    axis: (Double, Double, Double) = (0, 0, 0)) extends DataModel {

  val width = resolution * _width
  val height = resolution * _height
  val depth = resolution * _depth

  val topLeft = topLeftOpt getOrElse {
    val xh = (width / 2.0).floor
    val yh = (height / 2.0).floor
    val zh = (depth / 2.0).floor
    Vector3D(-xh, -yh, -zh)
  }

  val corners = rotateAndMove(moveVector, axis, Array(
    topLeft,
    topLeft.dx(width - 1),
    topLeft.dy(height - 1),
    topLeft.dx(width - 1).dy(height - 1),
    topLeft.dz(depth - 1),
    topLeft.dz(depth - 1).dx(width - 1),
    topLeft.dz(depth - 1).dy(height - 1),
    topLeft.dz(depth - 1).dx(width - 1).dy(height - 1)))
  
  val maxCorner = corners.foldLeft((0.0, 0.0, 0.0))((b, e) => (
    math.max(b._1, e.x), math.max(b._2, e.y), math.max(b._3, e.z)))

  val minCorner = corners.foldLeft(maxCorner)((b, e) => (
    math.min(b._1, e.x), math.min(b._2, e.y), math.min(b._3, e.z)))

  def isUnrotated =
    axis == (0,0,0)

  @inline
  private def looper[T](extendArrayBy: Int, c: ClassTag[T])(f: (Double, Double, Double) => Array[T]) = {
    implicit val tag = c
    val xhMax = topLeft.x + width
    val yhMax = topLeft.y + height
    val zhMax = topLeft.z + depth

    val array = new Array[T](_width * _height * _depth * extendArrayBy)
    var x = topLeft.x
    var y = topLeft.y
    var z = topLeft.z
    var idx = 0
    while (z < zhMax) {
      y = topLeft.y
      while (y < yhMax) {
        x = topLeft.x
        while (x < xhMax) {
          f(x, y, z).copyToArray(array, idx, extendArrayBy)
          x += resolution
          idx += extendArrayBy
        }
        y += resolution
      }
      z += resolution
    }
    array
  }

  override def withContainingCoordinates[T](extendArrayBy: Int = 1)(f: (Double, Double, Double) => Array[T])(implicit c: ClassTag[T]): Array[T] = {
    rotateAndMove(moveVector, axis)(looper[T](extendArrayBy, c))(f)
  }
}