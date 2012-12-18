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
  // every model needs a unique id, it is used to request the model via get http request
  val id: String

  // specifies the polygons the model consists of
  val polygons: List[Polygon]

  def rotateAndMove(moveVector: Tuple3[Double, Double, Double], axis: Tuple3[Double, Double, Double]): Array[Vector3D] = {
    var t = System.currentTimeMillis()
    // orthogonal vector to (0,1,0) and rotation vector
    val ortho = normalizeVector((axis._3, 0, -axis._1))

    // dot product of (0,1,0) and rotation
    val dotProd = axis._2
    // transformation of dot product for cosA
    val cosA = dotProd / sqrt(square(axis._1) + square(axis._2) + square(axis._3))
    val sinA = sqrt(1 - square(cosA))

    //calculate rotation matrix
    val a11 = cosA + square(ortho._1) * (1 - cosA); val a12 = -ortho._3 * sinA; val a13 = ortho._1 * ortho._3 * (1 - cosA)
    val a21 = ortho._3 * sinA; val a22 = cosA; val a23 = -ortho._1 * sinA;
    val a31 = ortho._1 * ortho._3 * (1 - cosA); val a32 = ortho._1 * sinA; val a33 = cosA + square(ortho._3) * (1 - cosA);

    val size = containingCoordinates.size
    var result = new Array[Vector3D](size)
    var idx = 0
    val iter = containingCoordinates.iterator

    while (iter.hasNext) {
      val (px, py, pz) = iter.next
      // see rotation matrix and helmert-transformation for more details
      val x = moveVector._1 + (a11 * px + a12 * py + a13 * pz)
      val y = moveVector._2 + (a21 * px + a22 * py + a23 * pz)
      val z = moveVector._3 + (a31 * px + a32 * py + a33 * pz)
      result(idx) = Vector3D(x, y, z)
      idx += 1
    }
    Logger.debug("rotateAndMove: %d ms".format(System.currentTimeMillis() - t))
    result
  }

  def normalizeVector(v: Tuple3[Double, Double, Double]): Tuple3[Double, Double, Double] = {
    var l = sqrt(square(v._1) + square(v._2) + square(v._3))
    if (l > 0) (v._1 / l, v._2 / l, v._3 / l) else v
  }

  // calculate all coordinates which are in the model boundary
  def containingCoordinates: Array[Tuple3[Int, Int, Int]]
}

class CubeModel(xMax: Int, yMax: Int, zMax: Int) extends DataModel {
  val id = "cube"

  val polygons = null

  override val containingCoordinates = {
    val xhMax = xMax / 2.0
    val yhMax = yMax / 2.0
    val zhMax = zMax / 2.0
    
    val fxhMax = xhMax.floor.toInt
    val fyhMax = yhMax.floor.toInt
    val fzhMax = zhMax.floor.toInt

    val t = System.currentTimeMillis()
    val array = new Array[Tuple3[Int, Int, Int]](zMax * yMax * xMax)
    var z = - fzhMax
    var y = 0
    var x = 0
    var idx = 0
    while (z < zhMax) {
      y = - fyhMax
      while (y < yhMax) {
        x = - fxhMax
        while (x < xhMax) {
          array(idx) = (x, y, z)
          x += 1
          idx += 1
        }
        y += 1
      }
      z += 1
    }
    Logger.debug("containingCoordinates: %d ms".format(System.currentTimeMillis() - t))
    array
  }
}