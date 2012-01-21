package brainflight.tools.geometry

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 17.11.11
 * Time: 23:15
 */

/**
 * Represents a regular n-gonal frustum.
 * @param n: number of vertices
 * @param h: height of the frustum
 * @param rBase: of the site-to-center line segment
 *
 */
class NGonalFrustum(n: Int, h:Int, rBase: Int, rTop: Int) {
  val polygons = {
    // create the polygon which represents the base of the frustrum
    val baseP = new RegularPolygon(n,rBase)
    // top of the frustum
    val topP = new RegularPolygon(n,rTop)
    // list of all polygons the frustum contains, top polygon will be the last in the list
    // extend all vectors with a 3rd dimension
    var polys = new Polygon(topP.to3D(h,2).reverse) :: Nil  // top gets reveresed to make it counter clockwise
    for(i<-0 until n){
      // create the cladding faces of the frustum
      // because the vertex vectors of the base and top polygon are in 2D they need to be extended to a 3D vector
      val vertices = baseP.vertex(i).to3D(0,2) :: baseP.vertex(i-1).to3D(0,2) :: topP.vertex(i-1).to3D(h,2) :: topP.vertex(i).to3D(h,2) :: Nil
      polys ::= new Polygon(vertices)
    }
    // return the list of polygons, but first prepend the base polygon
    new Polygon(baseP.to3D(0,2)) :: polys
  }
  // used to convert polygon to json representation
  override def toString = polygons.mkString("[",",","]")
}