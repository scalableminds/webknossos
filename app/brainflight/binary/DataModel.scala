package brainflight.binary

import scala.math._
import brainflight.tools.Math._
import java.lang.OutOfMemoryError
import brainflight.tools.geometry.Vector3D._
import brainflight.tools.geometry.{Vector3D, NGonalFrustum, Polygon}
import scala.collection.parallel.ParSeq

/**
 * Scalable Minds - Brainflight
 * User: tmbo
 * Date: 10/10/11
 * Time: 10:47 AM
 */

/**
 * All possible data models the client should be able to request need to be 
 * defined here and registered in Global.scala. A binary data model defines 
 * which binary data is responded given a client request containing the 
 * rotation matrix
 */
abstract class DataModel {
  // every model needs a unique id, it is used to request the model via get http request
  val id : String
  // defines the axis length of the field
  val yLength : Int

  // specifies the polygons the model consists of
  val polygons : List[Polygon]
  
  // calculate all vertices
  lazy val vertices = polygons.flatMap(_.vertices).distinct
  lazy val normals = polygons.map(_.normalVector)
}

/**
 * Simple cube model
 */
object CubeModel extends DataModel{
  val id = "cube"
  val yLength = 50

  val polygons = new NGonalFrustum(4,yLength,38,38).polygons
}

/**
 * n-gonal Frustrum model with 
 */
object FrustumModel extends DataModel{
  val id= "frustum"
  val yLength = 50
  
  val polygons = new NGonalFrustum(8,yLength,10,60).polygons
}