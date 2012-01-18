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

  // contains all containing coordinates as a byte array
  lazy val modelInformation = {
      if(!containingCoordinates.find(p =>{ val (x,y,z) = p; x>127 || x< -128 || y>127 || y< -128 || z>127 || z< -128}).isEmpty)
        throw new NumberFormatException("Can't convert int to byte (out of range).")
      containingCoordinates.flatMap(point => List(point._1.toByte,point._2.toByte,point._3.toByte)).toArray
  }
  // specifies the polygons the model consists of
  val polygons : List[Polygon]

  def rotateAndMove(moveVector:Tuple3[Double,Double, Double],axis:Tuple3[Double,Double,Double]):ParSeq[Tuple3[Int, Int, Int]]={
    // orthogonal vector to (0,1,0) and rotation vector
    val ortho = normalizeVector((axis._3,0,-axis._1))

    // dot product of (0,1,0) and rotation
    val dotProd = axis._2
    // transformation of dot product for cosA
    val cosA = dotProd / sqrt(square(axis._1)+square(axis._2)+square(axis._3))
    val sinA = sqrt(1-square(cosA))

    //calculate rotation matrix
    val a11 = cosA+square(ortho._1)*(1-cosA);  val a12 = -ortho._3*sinA;   val a13 = ortho._1*ortho._3*(1-cosA)
    val a21 = ortho._3*sinA;                   val a22 = cosA;             val a23 = -ortho._1*sinA;
    val a31 = ortho._1*ortho._3*(1-cosA);      val a32 = ortho._1*sinA;    val a33 = cosA+square(ortho._3)*(1-cosA);


    containingCoordinates.par.map(point=>{
      val (px,py,pz) = point
      // see rotation matrix and helmert-transformation for more details
      val x = moveVector._1+(a11*px + a12*py + a13*pz)
      val y = moveVector._2+(a21*px + a22*py + a23*pz)
      val z = moveVector._3+(a31*px + a32*py + a33*pz)
      (x.round.toInt,y.round.toInt,z.round.toInt)
    })
  }
  // calculate all coordinates which are in the model boundary
  lazy val containingCoordinates:Seq[Tuple3[Int, Int, Int]] = {
    val normals = polygons.map(_.normalVector)
    surroundingCube.filter(p => {
      for(n <- normals)
        if((n ° p) > 0) false
      true
    }).map( Vector3DToIntTuple _).distinct
  }

  private def surroundingCube : Seq[Vector3D] = {
    val vertices = polygons.flatMap(_.vertices)

    val t = vertices.foldLeft(vertices(0))((b,e) => (math.max(b.x,e.x),math.max(b.y,e.y),math.max(b.z,e.z)))
    val b = vertices.foldLeft(vertices(0))((b,e) => (math.min(b.x,e.x),math.min(b.y,e.y),math.min(b.z,e.z)))

    for{
      y <- b.y.round to t.y.round
      x <- b.x.round to t.x.round
      z <- b.z.round to t.z.round
    } yield new Vector3D(x,y,z)
  }
}

object CubeModel extends DataModel{
  val id = "cube"
  val yLength = 50

  val polygons = new NGonalFrustum(4,yLength,50,50).polygons
}

object FrustumModel extends DataModel{
  val id= "frustum"

  val yLength = 50
  // TODO: implement polygons for frustrum -> evaluate number of vertices
  val polygons = new NGonalFrustum(8,yLength,10,60).polygons
}