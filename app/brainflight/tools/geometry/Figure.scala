package brainflight.tools.geometry

import brainflight.tools.Math._
import brainflight.tools.ExtendedTypes._
import scala.math._
import scala.collection.mutable.ArrayBuilder
import scala.collection.mutable.ArrayBuffer

abstract class Figure

case class Cube( topLeft: Point3D, edgeLength: Int) extends Figure{
  def calculateInnerPoints(): Seq[Point3D] = {
    for{
      x <- topLeft.x until topLeft.x + edgeLength
      y <- topLeft.y until topLeft.y + edgeLength
      z <- topLeft.z until topLeft.z + edgeLength
    } yield {
      Point3D(x,y,z)
    }
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
    val maxVector = vertices.foldLeft( vertices( 0 ) )( ( b, e ) => Vector3D(
      math.max( b.x, e.x ), math.max( b.y, e.y ), math.max( b.z, e.z ) ) )
    var minVector = vertices.foldLeft( vertices( 0 ) )( ( b, e ) => Vector3D(
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