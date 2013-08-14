package braingames.geometry

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
class NGonalFrustum( numberOfVertices: Int, height: Int, radiusBase: Int, radiusTop: Int ) {
  val polygons = {
    // create the polygon which represents the base of the frustrum
    val basePolygon = new RegularPolygon( numberOfVertices, radiusBase )
    // top of the frustum
    val topPolygon = new RegularPolygon( numberOfVertices, radiusTop )
    // list of all polygons the frustum contains, top polygon will be the last in the list
    // extend all vectors with a 3rd dimension
    var polygons = new Polygon( topPolygon.to3D( height, 2 ).reverse ) :: Nil // top gets reveresed to make it counter clockwise
    for ( i <- 0 until numberOfVertices ) {
      // create the cladding faces of the frustum
      // because the vertex vectors of the base and top polygon are in 2D they need to be extended to a 3D vector
      val vertices =
        basePolygon.vertex( i ).to3D( 0, 2 ) ::
          basePolygon.vertex( i - 1 ).to3D( 0, 2 ) ::
          topPolygon.vertex( i - 1 ).to3D( height, 2 ) ::
          topPolygon.vertex( i ).to3D( height, 2 ) ::
          Nil
      polygons ::= new Polygon( vertices )
    }
    // return the list of polygons, but first prepend the base polygon
    new Polygon( basePolygon.to3D( 0, 2 ) ) :: polygons
  }

  override def toString = polygons.mkString( "[", ",", "]" )
}