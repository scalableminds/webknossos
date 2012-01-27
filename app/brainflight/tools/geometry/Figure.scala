package brainflight.tools.geometry

case class Figure( polygons: Seq[Polygon]){
   def isInside( point: Vector3D): Boolean = {
    for( polygon <- polygons){
      if( point ° polygon.normalVector - polygon.d > 1e-10){ 
        val dot = point ° polygon.normalVector
        return false
      }
    } 
    return true
  }
}