package com.scalableminds.tools.geometry

import scala.math._
import com.scalableminds.tools.Math._

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 17.11.11
 * Time: 21:49
 */

/**
 * Vector in 2D space, which is able to handle vector addition and rotation
 */
class Vector2D(val x:Double, val y:Double){

  def +(b: Vector2D) = new Vector2D(x+b.x,y+b.y)

  def rotate(a: Double) = new Vector2D(
      x*cos(a)-y*sin(a), 
      x*sin(a)+y*cos(a)
  )
  /**
   * Add another dimension to the vector. value specifies the index
   * where the dimension gets added and position should be one of 0,1 or 2
   * and indicates whether to place the new value on x,y or z coordinate.
   */
  def to3D(value: Double,position: Int) = position match{
    case 0 => new Vector3D(value, x, y)
    case 1 => new Vector3D(x, value, y)
    case 2 => new Vector3D(x, y, value)
  }

  override def toString = "[%d,%d]".format(x.round,y.round)
}

/**
 * Vector in 3D space
 */
class Vector3D(val x:Double, val y:Double,val z:Double){
  override def toString = "[%d,%d,%d]".format(x.round,y.round,z.round)

  def normalize = {
    val sq = sqrt(square(x)+square(y)+square(z))
    new Vector3D(x/sq, y/sq, z/sq)
  }
  
  def x(o: Vector3D):Vector3D = {
    new Vector3D(
      y * o.z - z * o.y,
      z * o.x - x * o.z,
      x * o.y - y * o.x
    )
  }
  def °(o:Vector3D) = x * o.x + y * o.y + z * o.z

  def toTuple = (x,y,z)
}

object Vector3D {
  implicit def Vector3DToTuple(v:Vector3D) = (v.x,v.y,v.z)
  implicit def Vector3DToIntTuple(v:Vector3D) = (v.x.toInt,v.y.toInt,v.z.toInt)
  implicit def TupletoVector3D(v:Tuple3[Double, Double, Double]) = new Vector3D(v._1,v._2,v._3)
}
