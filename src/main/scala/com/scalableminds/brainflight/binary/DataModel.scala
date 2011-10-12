package com.scalableminds.brainflight.binary

import scala.math._
import com.scalableminds.tools.Math._

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

  def rotateAndMove(moveVector:Tuple3[Int,Int, Int],axis:Tuple3[Int,Int, Int]):IndexedSeq[Tuple3[Int, Int, Int]]={
    // orthogonal vector to (0,1,0) and rotation vector
    val ortho = (axis._3,0,-axis._1)
    // dot product of (0,1,0) and rotation
    val dotProd = axis._2
    // transformation of dot product for cosA
    val cosA = dotProd / sqrt(square(axis._1)+square(axis._2)+square(axis._3))
    val sinA = sqrt(1-square(cosA))

    containingCoordinates.map(point=>{
      val (px,py,pz) = point
      // see rotation matrix and helmert-transformation for more details
      val x = moveVector._1+((cosA+square(ortho._1)*(1-cosA))*px - ortho._3*sinA*py+ ortho._1*ortho._3*(1-cosA)*pz)
      val y = moveVector._2+(ortho._3*sinA*px + cosA * py - ortho._1*sinA*pz)
      val z = moveVector._3+(ortho._1*ortho._3*(1-cosA)*px + ortho._1*sinA*py + (cosA+square(ortho._3)*(1-cosA))*pz)
      (x.round.asInstanceOf[Int],y.round.asInstanceOf[Int],z.round.asInstanceOf[Int])
    })
  }
}

object CubeModel extends DataModel{
  val id = "cube"
  // calculate all coordinates which are in the Cube boundary
  lazy val containingCoordinates : IndexedSeq[Tuple3[Int, Int, Int]] =
  for{x <- -25 to 25
      y <- 0 to 50
      z <- -25 to 25 }yield{
    (x,y,z)
  }
}