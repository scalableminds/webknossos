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

  def rotateAndMove(moveVector: Vector3D, axis: Vector3D): Array[Vector3D] = {
    val t = System.currentTimeMillis()
    
    val start = OrientedPosition(moveVector, axis)
    val transformationMatrix = TransformationMatrix.fromOrientedPosition(start)
    val result = containingCoordinates.map(_.transformAffine(transformationMatrix.value.toArray))
    
    Logger.debug("rotateAndMove: %d ms".format(System.currentTimeMillis() - t))
    result
  }
    
  // calculate all coordinates which are in the model boundary
  def containingCoordinates: Array[Vector3D]
}

class CubeModel(xMax: Int, yMax: Int, zMax: Int) extends DataModel {
  val id = "cube"

  val polygons = null

  val containingCoordinates = {
    val t = System.currentTimeMillis()
    val result = (for {z <- 0 until zMax
                y <- 0 until yMax
                x <- 0 until xMax
    } yield Vector3D(x-(xMax/2).toInt, y-(yMax/2).toInt, z)).toArray
    
    Logger.debug("containingCoordinates: %d ms".format(System.currentTimeMillis()-t))
    result
  }
}