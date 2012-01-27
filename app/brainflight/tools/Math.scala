package brainflight.tools

import scala.math._
import util.DynamicVariable
import brainflight.tools.geometry.Vector3D
import brainflight.tools.geometry.Polygon
import brainflight.tools.geometry.Figure
import brainflight.tools.geometry.Vector3D._

/**
 * Scalable Minds - Brainflight
 * User: tom
 * Date: 10/11/11
 * Time: 8:53 AM
 */

object Math {
  val EPSILON = 1e-10
  def square( x: Int ) = x * x
  def square( x: Double ) = x * x
  def normalizeVector( v: Tuple3[Double, Double, Double] ): Tuple3[Double, Double, Double] = {
    var l = sqrt( square( v._1 ) + square( v._2 ) + square( v._3 ) )
    if ( l > 0 ) ( v._1 / l, v._2 / l, v._3 / l ) else v
  }

  def pointsInFigure( figure: Figure, client: List[Int] ): Seq[Tuple3[Int, Int, Int]] = {
    val vertices = figure.polygons.flatMap( _.vertices )
    val ( max_x, max_y, max_z ) = Vector3DToIntTuple( vertices.foldLeft( vertices( 0 ) )( ( b, e ) => (
      math.max( b.x, e.x ), math.max( b.y, e.y ), math.max( b.z, e.z ) ) ) )
    var ( min_x, min_y, min_z ) = Vector3DToIntTuple( vertices.foldLeft( vertices( 0 ) )( ( b, e ) => (
      math.min( b.x, e.x ), math.min( b.y, e.y ), math.min( b.z, e.z ) ) ) )

    val coordinates = scala.collection.mutable.ListBuffer[Tuple3[Int, Int, Int]]()
    var list = scala.collection.mutable.ListBuffer[Int]()
    var zDEBUG = 0.0
    val v001 = new Vector3D( 0, 0, 1 )
    min_x = max( min_x, 0 )
    min_y = max( min_y, 0 )
    min_z = max( min_z, 0 )

    for {
      x <- min_x to max_x
      y <- min_y to max_y
      if x >= 0 && y >= 0
    } {
      list = scala.collection.mutable.ListBuffer[Int]()

      for ( polygon <- figure.polygons ) {
        val v = new Vector3D( x, y, 0 )
        val divisor = v001 ° polygon.normalVector
        if ( divisor > EPSILON || divisor < -EPSILON ) {
          var zDEBUG = ( ( polygon.d - ( v ° polygon.normalVector ) ) / divisor )
          if ( zDEBUG > 0 )
            zDEBUG += EPSILON
          else
            zDEBUG -= EPSILON
          val z = zDEBUG.toInt
          if ( figure.isInside( new Vector3D( x, y, z ), polygon ) ) {
            list.append( z )
          }
        }
      }
      if ( !list.isEmpty ) {
        var start = list.min
        var end = list.max
        //assert(list.distinct.size<=2, "BÄHBÄHM "+ list)
        if ( end >= 0 ) {
          start = max( start, 0 )
          end = max( end, 0 )
          for ( z <- list.min to list.max ) {
            /*val clientX = client( coordinates.size * 3 )
            val clientY = client( coordinates.size * 3 + 1 )
            val clientZ = client( coordinates.size * 3 + 2 )
            if ( client.size > coordinates.size * 3 + 2 && (
              clientX != x ||
              clientY != y ||
              clientZ != z ) )
              println( "NOOOOOOOOO" )*/
            coordinates.append( ( x, y, z ) )
          }
        }
      }
    }
    coordinates
  }
}