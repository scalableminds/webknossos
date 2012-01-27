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
 * All possible data models the client should be able to request need to be defined here and registered in Boot.scala
 * A binary data model defines which binary data is responded given a viewpoint and an axis
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

  // calculate all coordinates which are in the model boundary
  /*lazy val containingCoordinates:Seq[Tuple3[Int, Int, Int]] = {
    val normals = polygons.map(_.normalVector)
    surroundingCube.filter(p => {
      for(n <- normals)
        if((n ° p) > 0) false
      true
    }).map( Vector3DToIntTuple _).distinct
  }*/
  
  // contains all containing coordinates as a byte array
  /*lazy val modelInformation = {
      if(!containingCoordinates.find(p =>{ val (x,y,z) = p; x>127 || x< -128 || y>127 || y< -128 || z>127 || z< -128}).isEmpty)
        throw new NumberFormatException("Can't convert int to byte (out of range).")
      containingCoordinates.flatMap(point => List(point._1.toByte,point._2.toByte,point._3.toByte)).toArray
  }*/
}

object CubeModel extends DataModel{
  val id = "cube"
  val yLength = 64

  val polygons = new NGonalFrustum(4,yLength,32,32).polygons
}

object FrustumModel extends DataModel{
  val id= "frustum"

  val yLength = 50
  // TODO: implement polygons for frustrum -> evaluate number of vertices
  val polygons = new NGonalFrustum(8,yLength,10,60).polygons
}