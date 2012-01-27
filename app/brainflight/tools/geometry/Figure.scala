package brainflight.tools.geometry

import brainflight.tools.Math._

case class Figure( polygons: Seq[Polygon]){
   def isInside( point: Vector3D, p: Polygon): Boolean = {
    for{ polygon <- polygons
    	if polygon != p
    }{
      if( point ° polygon.normalVector - polygon.d > EPSILON){
        val dist = point ° polygon.normalVector - polygon.d
        //println("(%f, %f, %f) failed: distance '%f'".format(point.x,point.y,point.z,dist))
        return false
      }
    } 
    return true
  }
   
  override def toString() = {
    polygons.toString
  }
}