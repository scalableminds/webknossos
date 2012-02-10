package brainflight.tools.geometry

import scala.math._
import brainflight.tools.Math._
import play.api.libs.json.JsArray._
import play.api.libs.json._
import play.api.libs.json.Json._
import play.Logger

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 17.11.11
 * Time: 21:49
 */

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

/**
 * Vector in 3D space
 */
case class Vector3D( val x: Double = 0, val y: Double = 0, val z: Double = 0 ) {
  def normalize = {
    val length = sqrt( square( x ) + square( y ) + square( z ) )
    new Vector3D( x / length, y / length, z / length )
  }

  def -( o: Vector3D ): Vector3D = {
    new Vector3D( x - o.x, y - o.y, z - o.z )
  }
  def x( o: Vector3D ): Vector3D = {
    new Vector3D(
      y * o.z - z * o.y,
      z * o.x - x * o.z,
      x * o.y - y * o.x )
  }

  def transformAffine( matrix: Array[Float] ): Vector3D = {
    // see rotation matrix and helmert-transformation for more details
    val nx = matrix( 0 ) * x + matrix( 4 ) * y + matrix( 8 ) * z + matrix( 12 )
    val ny = matrix( 1 ) * x + matrix( 5 ) * y + matrix( 9 ) * z + matrix( 13 )
    val nz = matrix( 2 ) * x + matrix( 6 ) * y + matrix( 10 ) * z + matrix( 14 )
    Vector3D( nx, ny, nz )
  }
  
  def rotate( matrix: List[Float] ): Vector3D = {
    // see rotation matrix and helmert-transformation for more details
    val nx = matrix( 0 ) * x + matrix( 4 ) * y + matrix( 8 ) * z
    val ny = matrix( 1 ) * x + matrix( 5 ) * y + matrix( 9 ) * z
    val nz = matrix( 2 ) * x + matrix( 6 ) * y + matrix( 10 ) * z
    Vector3D( nx, ny, nz )
  }

  def °( o: Vector3D ) = x * o.x + y * o.y + z * o.z
  
  def °( o: Tuple3[Double,Double,Double] ) = x * o._1 + y * o._2 + z * o._3
  
  def toTuple = ( x, y, z )
  
  override def toString = "(%f, %f, %f)".format(x,y,z)
}

object Vector3D {
  implicit def Vector3DToTuple( v: Vector3D ) = ( v.x, v.y, v.z )

  implicit def Vector3DToIntTuple( v: Vector3D ) = ( v.x.toInt, v.y.toInt, v.z.toInt )

  implicit def TupletoVector3D[T <% Double]( v: Tuple3[T, T, T] ) = new Vector3D( v._1, v._2, v._3 )

  // json converter
  implicit object Vector3DWrites extends Writes[Vector3D] {
    def writes( v: Vector3D ) = {
      val l = List( v.x.round, v.y.round, v.z.round )
      JsArray( l.map( toJson( _ ) ) )
    }
  }
  implicit object Vector3DReads extends Reads[Vector3D] {
    def reads( json: JsValue ) = json match {
      case JsArray( ts ) if ts.size == 3 =>
        val c = ts.map( fromJson[Int]( _ ) )
        Vector3D( c( 0 ), c( 1 ), c( 2 ) )
      case _ => throw new RuntimeException( "List expected" )
    }
  }
}
