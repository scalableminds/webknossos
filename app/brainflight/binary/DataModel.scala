package brainflight.binary

import scala.math._
import brainflight.tools.Math._
import java.lang.OutOfMemoryError
import brainflight.tools.geometry.Vector3D._
import brainflight.tools.geometry.{ Vector3D, NGonalFrustum, Polygon }
import scala.collection.parallel.ParSeq
import brainflight.tools.geometry.Point3D
import play.api.Logger
import brainflight.tools.geometry._
import scala.collection.mutable.ArrayBuffer
import play.api.libs.iteratee.Enumerator

/**
 * Scalable Minds - Brainflight
 * User: tmbo
 * Date: 10/10/11
 * Time: 10:47 AM
 */

/**
 * All possible data models the client should be able to request need to be defined here and registered in Boot.scala
 * A binary data model defines which binary data is responded given a viewpoint and an axis
 */

abstract class DataModel {

  protected def rotateAndMove(
    moveVector: (Double, Double, Double),
    axis: (Double, Double, Double),
    coordinates: ArrayBuffer[Vector3D]): ArrayBuffer[Vector3D] = {
    def ff(f: (Double, Double, Double) => Array[Vector3D]): ArrayBuffer[Vector3D] = {
      coordinates.map(c => f(c.x, c.y, c.z)(0))
    }

    rotateAndMove(moveVector, axis)(ff)((x, y, z) => Array(Vector3D(x, y, z)))
  }

  @inline
  protected def rotateAndMove[T](
    moveVector: (Double, Double, Double),
    axis: (Double, Double, Double))(coordinates: ((Double, Double, Double) => Array[T]) => ArrayBuffer[T])(f: (Double, Double, Double) => Array[T]): ArrayBuffer[T] = {

    if (axis._1 == 0 && axis._2 == 0 && axis._3 == 0) {
      simpleMove(moveVector, coordinates)(f)
    } else {
      var t = System.currentTimeMillis()
      // orthogonal vector to (0,1,0) and rotation vector
      val ortho = normalizeVector((axis._3, 0, -axis._1))

      // dot product of (0,1,0) and rotation
      val dotProd = axis._2
      // transformation of dot product for cosA
      val cosA = dotProd / sqrt(square(axis._1) + square(axis._2) + square(axis._3))
      val sinA = sqrt(1 - square(cosA))

      //calculate rotation matrix
      val a11 = cosA + square(ortho._1) * (1 - cosA);
      val a12 = -ortho._3 * sinA;
      val a13 = ortho._1 * ortho._3 * (1 - cosA)

      val a21 = ortho._3 * sinA;
      val a22 = cosA;
      val a23 = -ortho._1 * sinA;

      val a31 = ortho._1 * ortho._3 * (1 - cosA);
      val a32 = ortho._1 * sinA;
      val a33 = cosA + square(ortho._3) * (1 - cosA);

      @inline
      def coordinateTransformer(px: Double, py: Double, pz: Double) = {
          val x = moveVector._1 + (a11 * px + a12 * py + a13 * pz)
          val y = moveVector._2 + (a21 * px + a22 * py + a23 * pz)
          val z = moveVector._3 + (a31 * px + a32 * py + a33 * pz)
          f(x, y, z)
      }
      
      coordinates(coordinateTransformer)
    }
  }
  
  @inline
  protected def simpleMove[T](
    moveVector: (Double, Double, Double),
    coordinates: ((Double, Double, Double) => Array[T]) => ArrayBuffer[T])(f: (Double, Double, Double) => Array[T]): ArrayBuffer[T] = {
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
  def withContainingCoordinates[T](extendArrayBy: Int = 1)(f: (Double, Double, Double) => Array[T]): ArrayBuffer[T]
}

case class Cuboid(
    _width: Int,
    _height: Int,
    _depth: Int,
    resolution: Int,
    topLeftOpt: Option[Vector3D] = None,
    moveVector: (Double, Double, Double) = (0, 0, 0),
    axis: (Double, Double, Double) = (0, 0, 0)) extends DataModel {

  val width = resolution * _width
  val height = resolution * _height
  val depth = resolution * _depth

  private val topLeft = topLeftOpt getOrElse {
    val xh = (width / 2.0).floor
    val yh = (height / 2.0).floor
    val zh = (depth / 2.0).floor
    Vector3D(-xh, -yh, -zh)
  }

  val corners = rotateAndMove(moveVector, axis, ArrayBuffer(
    topLeft,
    topLeft.dx(width-1),
    topLeft.dy(height-1),
    topLeft.dx(width-1).dy(height-1),
    topLeft.dz(depth-1),
    topLeft.dz(depth-1).dx(width-1),
    topLeft.dz(depth-1).dy(height-1),
    topLeft.dz(depth-1).dx(width-1).dy(height-1)))

  val maxCorner = corners.foldLeft((0.0, 0.0, 0.0))((b, e) => (
    math.max(b._1, e.x), math.max(b._2, e.y), math.max(b._3, e.z)))

  val minCorner = corners.foldLeft(maxCorner)((b, e) => (
    math.min(b._1, e.x), math.min(b._2, e.y), math.min(b._3, e.z)))

  @inline
  private def looper[T](extendArrayBy: Int)( f: (Double, Double, Double)  => Array[T]) = {
    val xhMax = topLeft.x + width
      val yhMax = topLeft.y + height
      val zhMax = topLeft.z + depth

      val t = System.currentTimeMillis()
      val array = new ArrayBuffer[T](_width * _height * _depth * extendArrayBy)
      var x = topLeft.x
      var y = topLeft.y
      var z = topLeft.z
      var idx = 0
      while (z < zhMax) {
        y = topLeft.y
        while (y < yhMax) {
          x = topLeft.x
          while (x < xhMax) {
            array ++= f(x, y, z)
            x += resolution
            idx += extendArrayBy
          }
          y += resolution
        }
        z += resolution
      }
      array
  }  
    
  override def withContainingCoordinates[T](extendArrayBy: Int = 1)(f: (Double, Double, Double) => Array[T]): ArrayBuffer[T] = {
    rotateAndMove(moveVector, axis)( looper[T](extendArrayBy))(f)
  }
}