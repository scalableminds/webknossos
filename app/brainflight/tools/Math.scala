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
  def square( x: Int ) = x * x
  def square( x: Double ) = x * x
  def normalizeVector( v: Tuple3[Double, Double, Double] ): Tuple3[Double, Double, Double] = {
    var l = sqrt( square( v._1 ) + square( v._2 ) + square( v._3 ) )
    if ( l > 0 ) ( v._1 / l, v._2 / l, v._3 / l ) else v
  }

  def pointsInFigure( figure: Figure ): Seq[Tuple3[Int, Int, Int]] = {
    val vertices = figure.polygons.flatMap(_.vertices)
    val (max_x,max_y,max_z) = Vector3DToIntTuple(vertices.foldLeft( vertices( 0 ) )( ( b, e ) => (
      math.max( b.x, e.x ), math.max( b.y, e.y ), math.max( b.z, e.z ) ) ))
    val (min_x,min_y,min_z) = Vector3DToIntTuple(vertices.foldLeft( vertices( 0 ) )( ( b, e ) => (
      math.min( b.x, e.x ), math.min( b.y, e.y ), math.min( b.z, e.z ) ) ))
      
    val coordinates = scala.collection.mutable.ListBuffer[Tuple3[Int, Int, Int]]()

    val v001 = new Vector3D(0, 0, 1)  
    for {
      x <- min_x to max_x
      y <- min_y to max_y
      if x >= 0 && y >= 0
    } {
      val list = scala.collection.mutable.ListBuffer[Int]()
      for( polygon <- figure.polygons){
        val v = new Vector3D(x,y,0)
        val divisor = v001 ° polygon.normalVector
        if(divisor != 0){
	    	val z = ((polygon.d - (v ° polygon.normalVector)) / divisor).toInt
	    	
	    	if(z >= min_z && z <= max_z && figure.isInside(new Vector3D(x,y,z)))
	    		  list.append(z)
        }
      }
      if(!list.isEmpty){
        assert(list.distinct.size<=2, "BÄHBÄHM")
        for(z <- list.min to list.max){
        	coordinates.append((x, y, z))
        }
      }
    }
    coordinates
  }
}