package brainflight.tools.geometry

case class Figure( polygons: Seq[Polygon]){
   def isInside( point: Vector3D): Boolean = {
    for( polygon <- polygons){
      if( point ° polygon.normalVector - polygon.d > 0.01) 
        return false
    } 
    return true
  }
}