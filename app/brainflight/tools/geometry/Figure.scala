package brainflight.tools.geometry

import brainflight.tools.Math._
import brainflight.tools.ExtendedTypes._
import scala.math._
import scala.collection.mutable.ArrayBuilder
import scala.collection.mutable.ArrayBuffer

abstract class Figure

case class Cube( topLeft: Point3D, edgeLength: Int) extends Figure{
  def calculateInnerPoints(): Seq[Point3D] = {
    var x = topLeft.x + edgeLength - 1
    val minX = topLeft.x
    var y = 0
    val minY = topLeft.y
    var z = 0
    val minZ = topLeft.z
    var result: List[Point3D] = Nil 
    while( x >= minX ){
      y = topLeft.y + edgeLength - 1
      while( y >= minY ) { 
        z = topLeft.z + edgeLength - 1
        while( z >= minZ ){
          result ::= Point3D(x, y, z)
          z -= 1
        }
        y -= 1
      }
      x -= 1
    }
    result
  }
}

case class ConvexFigure( polygons: Seq[Polygon] ) extends Figure{

  def isInside( point: Tuple3[Double,Double,Double], polygonOfPoint: Polygon = null ) = {
    !polygons.exists( polygon =>
      polygon != polygonOfPoint &&
        polygon.normalVector ° point - polygon.d > EPSILON )
  }

  def calculateInnerPoints(): Seq[Tuple3[Int, Int, Int]] = {
    val vertices = this.polygons.flatMap( _.vertices )
    val maxVector = vertices.foldLeft( vertices( 0 ) )( ( b, e ) => (
      math.max( b.x, e.x ), math.max( b.y, e.y ), math.max( b.z, e.z ) ) )
    var minVector = vertices.foldLeft( vertices( 0 ) )( ( b, e ) => (
      math.min( b.x, e.x ), math.min( b.y, e.y ), math.min( b.z, e.z ) ) )

    val innerPoints = ArrayBuilder.make[Tuple3[Int, Int, Int]]()
    var zRangeBoundaries = ArrayBuffer[Int]()

    val directionalVector = new Vector3D( 0, 0, 1 )
    val polygonsAndDivisors =
      for {
        polygon <- this.polygons
        divisor = directionalVector ° polygon.normalVector
        if !divisor.isNearZero
      } yield ( polygon, divisor )

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
      zRangeBoundaries = ArrayBuffer[Int]()
      val rayPositionVector = new Vector3D( x, y, 0 )
      
      for ( ( polygon, divisor ) <- polygonsAndDivisors ) {  
        val zBoundary =
          ( polygon.d - ( rayPositionVector ° polygon.normalVector ) ) / divisor
        if ( this.isInside( ( x.toDouble, y.toDouble, zBoundary ), polygon ) ) {
          zRangeBoundaries.append( zBoundary.patchAbsoluteValue.toInt )
        }
      }

      if ( !zRangeBoundaries.isEmpty ) {
        var lowerBoundary = zRangeBoundaries.min
        var upperBoundary = zRangeBoundaries.max

        if ( upperBoundary >= 0 ) {
          lowerBoundary = max( lowerBoundary, 0 )

          innerPoints ++=
            ( for ( z <- lowerBoundary to upperBoundary ) yield ( ( x, y, z ) ) )
        }
      }

    }
    innerPoints.result
  }

  override def toString() = {
    polygons.toString
  }
}