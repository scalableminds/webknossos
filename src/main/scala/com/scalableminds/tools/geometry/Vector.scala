package com.scalableminds.tools.geometry

import scala.math._

/**
 * Created by IntelliJ IDEA.
 * User: tombocklisch
 * Date: 17.11.11
 * Time: 21:49
 * To change this template use File | Settings | File Templates.
 */

class Vector2D(val x:Double, val y:Double){

  def +(b: Vector2D) = new Vector2D(x+b.x,y+b.y)

  def rotate(a: Double) = new Vector2D(
      x*cos(a)-y*sin(a), 
      x*sin(a)+y*cos(a)
  )
  def D3(value: Double,position: Int) = position match{
    case 0 => new Vector3D(value, x, y)
    case 1 => new Vector3D(x, value, y)
    case 2 => new Vector3D(x, y, value)
  }
}
class Vector3D(val x:Double, val y:Double,val z:Double){
  override def toString = "[%d,%d,%d]".format(x.round,y.round,z.round)
}
