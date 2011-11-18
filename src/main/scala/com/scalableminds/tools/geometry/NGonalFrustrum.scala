package com.scalableminds.tools.geometry

/**
 * Created by IntelliJ IDEA.
 * User: tombocklisch
 * Date: 17.11.11
 * Time: 23:15
 * To change this template use File | Settings | File Templates.
 */

class NGonalFrustrum(n: Int, h:Int, rBase: Int, rTop: Int) {
  val polygons = {
    val baseP = new RegularPolygon(n,rBase)
    val topP = new RegularPolygon(n,rTop)
    var polys = new Polygon(topP.D3(h,1).reverse) :: Nil
    for(i<-0 until n){
      val vertices = baseP.vertex(i).D3(0,1) :: baseP.vertex(i-1).D3(0,1) :: topP.vertex(i-1).D3(h,1) :: topP.vertex(i).D3(h,1) :: Nil
      polys ::= new Polygon(vertices)
    }
    new Polygon(baseP.D3(0,1)) :: polys
  }
  override def toString = polygons.mkString("[",",","]")
}