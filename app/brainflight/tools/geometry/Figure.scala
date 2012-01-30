package brainflight.tools.geometry

import brainflight.tools.Math._

case class Figure( polygons: Seq[Polygon] ) {
  def isInside( point: Vector3D, p: Polygon ): Boolean = {
    val t1 = System.currentTimeMillis
    for ( polygon <- polygons ) {
      if ( polygon != p && point ° polygon.normalVector - polygon.d > EPSILON ) {
        return false
      }
    }
    return true
  }

  override def toString() = {
    polygons.toString
  }
}