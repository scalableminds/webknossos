package brainflight.tools

import scala.math._
import util.DynamicVariable
import brainflight.tools.geometry.Vector3D
import brainflight.tools.geometry.Polygon
import brainflight.tools.geometry.Figure
import brainflight.tools.geometry.Vector3D._
import brainflight.tools.ExtendedDataTypes._

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

  def pointsInFigure( figure: Figure ): Seq[Tuple3[Int, Int, Int]] = {
    val vertices = figure.polygons.flatMap( _.vertices )
    val maxVector = vertices.foldLeft( vertices( 0 ) )( ( b, e ) => (
      math.max( b.x, e.x ), math.max( b.y, e.y ), math.max( b.z, e.z ) ) ) 
    var minVector = vertices.foldLeft( vertices( 0 ) )( ( b, e ) => (
      math.min( b.x, e.x ), math.min( b.y, e.y ), math.min( b.z, e.z ) ) ) 

    val coordinates = scala.collection.mutable.ArrayBuilder.make[Tuple3[Int, Int, Int]]()
    var list = scala.collection.mutable.ArrayBuffer[Int]()
    
    val v001 = new Vector3D( 0, 0, 1 )
   
    val max_x = maxVector.x.patchAbsoluteValue.toInt 
    val max_y = maxVector.y.patchAbsoluteValue.toInt 
    val max_z = maxVector.z.patchAbsoluteValue.toInt 
    
    val min_x = max( minVector.x.patchAbsoluteValue.toInt, 0 )
    val min_y = max( minVector.y.patchAbsoluteValue.toInt, 0 )
    val min_z = max( minVector.z.patchAbsoluteValue.toInt, 0 )

    for {
      x <- min_x to max_x
      y <- min_y to max_y
    } {
      list = scala.collection.mutable.ArrayBuffer[Int]()
      
      for ( polygon <- figure.polygons ) {
        val v = new Vector3D( x, y, 0 )
        val divisor = v001 ° polygon.normalVector
        if ( ! divisor.nearZero ) {
          val z = ( ( polygon.d - ( v ° polygon.normalVector ) ) / divisor )
          if ( figure.isInside( ( x.toDouble, y.toDouble, z ), polygon ) ) {
            list.append( z.patchAbsoluteValue.toInt )
          }
        }
      }
      
      if ( !list.isEmpty ) {
        var start = list.min
        var end = list.max
        
        if ( end >= 0 ) {
          start = max( start, 0 )
         
          for ( z <- start to end ) {           
            coordinates += ( ( x, y, z ) )
          }
        }
      }
      
    }
    coordinates.result
  }
}