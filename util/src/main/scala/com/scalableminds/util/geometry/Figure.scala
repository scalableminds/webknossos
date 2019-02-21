package com.scalableminds.util.geometry

import com.scalableminds.util.tools.ExtendedTypes._
import com.scalableminds.util.tools.Math._

import scala.collection.mutable.{ArrayBuffer, ArrayBuilder}
import scala.math._

abstract class Figure

case class ConvexFigure(polygons: Seq[Polygon]) extends Figure {

  def isInside(point: (Double, Double, Double), polygonOfPoint: Polygon = null) =
    !polygons.exists(
      polygon =>
        polygon != polygonOfPoint &&
          polygon.normalVector ° point - polygon.d > EPSILON)

  def calculateInnerPoints(): Seq[Tuple3[Int, Int, Int]] = {
    val vertices = this.polygons.flatMap(_.vertices)

    val maxVector =
      vertices.foldLeft(vertices(0))((b, e) => Vector3D(math.max(b.x, e.x), math.max(b.y, e.y), math.max(b.z, e.z)))

    val minVector =
      vertices.foldLeft(vertices(0))((b, e) => Vector3D(math.min(b.x, e.x), math.min(b.y, e.y), math.min(b.z, e.z)))

    val innerPoints = ArrayBuilder.make[(Int, Int, Int)]()
    var zRangeBoundaries = ArrayBuffer[Int]()

    val directionalVector = new Vector3D(0, 0, 1)
    val polygonsAndDivisors =
      for {
        polygon <- this.polygons
        divisor = directionalVector ° polygon.normalVector
        if !divisor.isNearZero
      } yield (polygon, divisor)

    val max_x = maxVector.x.patchAbsoluteValue.toInt
    val max_y = maxVector.y.patchAbsoluteValue.toInt

    val min_x = max(minVector.x.patchAbsoluteValue.toInt, 0)
    val min_y = max(minVector.y.patchAbsoluteValue.toInt, 0)

    for {
      x <- min_x to max_x
      y <- min_y to max_y
    } {
      zRangeBoundaries = ArrayBuffer[Int]()
      val rayPositionVector = new Vector3D(x, y, 0)

      for ((polygon, divisor) <- polygonsAndDivisors) {
        val zBoundary =
          (polygon.d - (rayPositionVector ° polygon.normalVector)) / divisor
        if (this.isInside((x.toDouble, y.toDouble, zBoundary), polygon)) {
          zRangeBoundaries.append(zBoundary.patchAbsoluteValue.toInt)
        }
      }

      if (!zRangeBoundaries.isEmpty) {
        var lowerBoundary = zRangeBoundaries.min
        val upperBoundary = zRangeBoundaries.max

        if (upperBoundary >= 0) {
          lowerBoundary = max(lowerBoundary, 0)

          innerPoints ++=
            (for (z <- lowerBoundary to upperBoundary) yield ((x, y, z)))
        }
      }

    }
    innerPoints.result
  }

  override def toString() =
    polygons.toString
}
