package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.webknossos.datastore.geometry.{AdditionalAxisProto, Vec2IntProto}
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.util.tools.{Box, Failure, Full}
import play.api.libs.json.{Format, Json}

// bounds: lower bound inclusive, upper bound exclusive
case class AdditionalAxis(name: String, bounds: Array[Int], index: Int) {
  lazy val lowerBound: Int = bounds(0)
  lazy val upperBound: Int = bounds(1)
  lazy val highestValue: Int = upperBound - 1

  // Creates a new AdditionalAxis that encloses the the position given by additional coordinates with width 1.
  // Used to create the additional axes of an nd bounding box that encloses the given additional coordinates.
  // For normal axes x, y, z use the normal bounding box intersection.
  def intersectWithAdditionalCoordinates(additionalCoordinates: Seq[AdditionalCoordinate]): AdditionalAxis = {
    val matchingCoordinate = additionalCoordinates.find(ac => ac.name == name)
    matchingCoordinate match {
      case Some(ac) =>
        AdditionalAxis(name, Array(ac.value, ac.value + 1), index)
      case None =>
        // Use the lower bound as fallback
        AdditionalAxis(name, Array(lowerBound, lowerBound + 1), index)
    }
  }
}

object AdditionalAxis {
  implicit val jsonFormat: Format[AdditionalAxis] = Json.format[AdditionalAxis]

  def toProto(additionalAxesOpt: Option[Seq[AdditionalAxis]]): Seq[AdditionalAxisProto] =
    additionalAxesOpt match {
      case Some(additionalCoordinates) =>
        additionalCoordinates.map(
          additionalCoordinate =>
            AdditionalAxisProto(additionalCoordinate.name,
                                additionalCoordinate.index,
                                Vec2IntProto(additionalCoordinate.lowerBound, additionalCoordinate.upperBound)))
      case None => Seq()
    }

  def fromProtos(additionalAxisProtos: Seq[AdditionalAxisProto]): Seq[AdditionalAxis] =
    additionalAxisProtos.map(
      p => AdditionalAxis(p.name, Array(p.bounds.x, p.bounds.y), p.index)
    )

  def fromProtosAsOpt(additionalAxisProtos: Seq[AdditionalAxisProto]): Option[Seq[AdditionalAxis]] = {
    val axes = fromProtos(additionalAxisProtos)
    if (axes.nonEmpty) {
      Some(axes)
    } else {
      None
    }
  }

  def merge(additionalAxeses: Seq[Option[Seq[AdditionalAxis]]]): Option[Seq[AdditionalAxis]] = {
    val additionalAxesMap = scala.collection.mutable.Map[String, (Int, Int, Int)]()
    additionalAxeses.foreach {
      case Some(additionalAxes) =>
        for (additionalAxis <- additionalAxes) {
          val additionalAxisToInsert = additionalAxesMap.get(additionalAxis.name) match {
            case Some((existingIndex, existingLowerBound, existingUpperBound)) =>
              /* Index: The index can not be merged as it may describe data on a different server. Currently one index
              is chosen arbitrarily. For annotations this is fine, since the index is only used for sorting there;
              but merging additional coordinates describing data on a remote server with different indices is not
              supported by this.
               */
              (existingIndex,
               math.min(existingLowerBound, additionalAxis.lowerBound),
               math.max(existingUpperBound, additionalAxis.upperBound))
            case None =>
              (additionalAxis.index, additionalAxis.lowerBound, additionalAxis.upperBound)
          }
          additionalAxesMap(additionalAxis.name) = additionalAxisToInsert
        }
      case None =>
    }
    val additionalAxes = additionalAxesMap.iterator.map {
      case (name, (index, lowerBound, upperBound)) =>
        AdditionalAxis(name, Array(lowerBound, upperBound), index)
    }.toSeq
    if (additionalAxes.isEmpty) {
      None
    } else {
      Some(additionalAxes)
    }
  }

  def mergeAndAssertSameAdditionalAxes(
      additionalAxeses: Seq[Option[Seq[AdditionalAxis]]]): Box[Option[Seq[AdditionalAxis]]] = {
    val merged = merge(additionalAxeses)
    val mergedCount = merged match {
      case Some(axes) => axes.size
      case None       => 0
    }
    val sameAdditionalAxes = additionalAxeses.forall {
      case Some(axes) => axes.size == mergedCount
      case None       => 0 == mergedCount
    }
    if (sameAdditionalAxes) {
      Full(merged)
    } else {
      Failure("dataset.additionalCoordinates.different")
    }
  }

  // All possible values of the additional coordinates for given axes
  def coordinateSpace(additionalAxes: Option[Seq[AdditionalAxis]]): Seq[Seq[AdditionalCoordinate]] =
    additionalAxes match {
      case Some(axes) =>
        val coordinateSpaces = axes.map { axis =>
          axis.lowerBound until axis.upperBound
        }
        val coordinateSpace = coordinateSpaces.foldLeft(Seq(Seq.empty[Int])) { (acc, space) =>
          for {
            a <- acc
            b <- space
          } yield a :+ b
        }
        coordinateSpace.map { coordinates =>
          coordinates.zipWithIndex.map {
            case (coordinate, index) =>
              AdditionalCoordinate(axes(index).name, coordinate)
          }
        }
      case None => Seq.empty
    }
}
