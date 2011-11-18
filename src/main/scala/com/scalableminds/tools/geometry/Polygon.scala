package com.scalableminds.tools.geometry

import scala.math._
/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 17.11.11
 * Time: 20:52
 */

/**
 * Representation of a regular poylygon in a 2 dimensional space
 * n - is the number of vertices and a is the apothem
 * http://en.wikipedia.org/wiki/Regular_polygon
 */
class RegularPolygon(n: Int, a: Int) {
  val vertices = {
    var vert = List[Vector2D]();
    val alpha = 2*Pi/n
    var pointVect = new Vector2D(-tan(alpha/2)*a,a)
    vert ::= pointVect
    val s=2*tan(alpha/2)*a
    var v = new Vector2D(-s, 0)
    for(i <- 1 until n){
      v = v.rotate(alpha)
      pointVect = pointVect + v
      vert = vert ::: pointVect :: Nil
    }
    vert
  }
  def vertex(index: Int) = {
    val i = (index%vertices.size)
    if(i<0) vertices(vertices.size+i) else vertices(i)
  }
  def D3(value: Int, position: Int) = vertices.map(v => v.D3(value,position))
}

class Polygon(vertices: List[Vector3D]){
  override def toString = vertices.mkString("[",",","]")
}
