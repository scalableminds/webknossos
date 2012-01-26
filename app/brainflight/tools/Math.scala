package brainflight.tools

import scala.math._
import util.DynamicVariable
import brainflight.tools.geometry.Vector3D

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

  def surroundingCube( vertices: Seq[Vector3D] ): Seq[Tuple3[Long, Long, Long]] = {
    val top = vertices.foldLeft( vertices( 0 ) )( ( b, e ) => (
      math.max( b.x, e.x ), math.max( b.y, e.y ), math.max( b.z, e.z ) ) )
    val bottom = vertices.foldLeft( vertices( 0 ) )( ( b, e ) => (
      math.min( b.x, e.x ), math.min( b.y, e.y ), math.min( b.z, e.z ) ) )

    for {
      x <- bottom.x.round to top.x.round
      y <- bottom.y.round to top.y.round
      z <- bottom.z.round to top.z.round
    } yield ( x, y, z )
  }
}