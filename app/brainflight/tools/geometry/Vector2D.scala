package brainflight.tools.geometry

import brainflight.tools.Math._
import scala.math._

/**
 * Vector in 2D space, which is able to handle vector addition and rotation
 */
class Vector2D( val x: Double, val y: Double ) {

  def +( b: Vector2D ) = new Vector2D( x + b.x, y + b.y )

  def rotate( a: Double ) = new Vector2D(
    x * cos( a ) - y * sin( a ),
    x * sin( a ) + y * cos( a ) )

  /**
   * Add another dimension to the vector. value specifies the index
   * where the dimension gets added and position should be one of 0,1 or 2
   * and indicates whether to place the new value on x,y or z coordinate.
   */
  def to3D( value: Double, position: Int ) = position match {
    case 0 => new Vector3D( value, x, y )
    case 1 => new Vector3D( x, value, y )
    case 2 => new Vector3D( x, y, value )
  }

  override def equals( v: Any ): Boolean = v match {
    case v: Vector2D => x == x && v.y == y
    case _           => false
  }

  override def toString = "[%d,%d]".format( x.round, y.round )
}