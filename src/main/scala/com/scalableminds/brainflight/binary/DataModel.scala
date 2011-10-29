package com.scalableminds.brainflight.binary

import scala.math._
import com.scalableminds.tools.Math._
import java.lang.OutOfMemoryError

/**
 * Scalable Minds - Brainflight
 * User: tom
 * Date: 10/10/11
 * Time: 10:47 AM
 */

/**
 * All possible data models the client should be able to request need to be defined here and registered in Boot.scala
 * A binary data model defines which binary data is responded given a viewpoint and an axis
 */
abstract class DataModel {
  val containingCoordinates : IndexedSeq[Tuple3[Int, Int, Int]]
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

  def rotateAndMove(moveVector:Tuple3[Int,Int, Int],axis:Tuple3[Int,Int, Int]):IndexedSeq[Tuple3[Int, Int, Int]]={
    // orthogonal vector to (0,1,0) and rotation vector
    val ortho = normalizeVector((axis._3,0,-axis._1))

    // dot product of (0,1,0) and rotation
    val dotProd = axis._2
    // transformation of dot product for cosA
    val cosA = dotProd / sqrt(square(axis._1)+square(axis._2)+square(axis._3))
    val sinA = sqrt(1-square(cosA))

    //calculate rotation matrix
    val a11 = cosA+square(ortho._1)*(1-cosA);  val a12 = -ortho._3*sinA;   val a13 = ortho._1*ortho._3*(1-cosA)
    val a21 = ortho._3*sinA;                  val a22 = cosA;             val a23 = -ortho._1*sinA;
    val a31 = ortho._1*ortho._3*(1-cosA);     val a32 = ortho._1*sinA;    val a33 = cosA+square(ortho._3)*(1-cosA);


    containingCoordinates.map(point=>{
      val (px,py,pz) = point
      // see rotation matrix and helmert-transformation for more details
      val x = moveVector._1+(a11*px + a12*py + a13*pz)
      val y = moveVector._2+(a21*px + a22*py + a23*pz)
      val z = moveVector._3+(a31*px + a32*py + a33*pz)
      (x.round.toInt,y.round.toInt,z.round.toInt)
    })
  }


}

object CubeModel extends DataModel{
  val id = "cube"
  val yLength = 50
  // calculate all coordinates which are in the Cube boundary
  val containingCoordinates =
  for{
    y <- 0 to yLength
    x <- -yLength/2 to yLength/2
    z <- -yLength/2 to yLength/2
  }yield{
    (x,y,z)
  }
}

object FrustrumModel extends DataModel{
  val id= "frustrum"

  val yLength = 50
  // linear equation for the generator of the frustrum
  def generatorEquation(y:Int) = 10+y // -> z = a + b*y
  // calculate all coordinates which are in the frustrum boundary
  val containingCoordinates = {
    val generatorMax = generatorEquation(yLength)
    for{
      y <- 0 to yLength
      x <- -generatorMax to generatorMax
      z <- -generatorMax to generatorMax

      rad = generatorEquation(y)

      if sqrt(square(x)+square(z)) <= rad
    }yield{
      (x,y,z)
    }
  }
}