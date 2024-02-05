package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.webknossos.datastore.geometry.{AdditionalAxisProto, Vec2IntProto}
import net.liftweb.common.{Box, Failure, Full}
import play.api.libs.json.{Format, Json}

// bounds: lower bound inclusive, upper bound exclusive
case class AdditionalAxis(name: String, bounds: Array[Int], index: Int) {
  lazy val lowerBound: Int = bounds(0)
  lazy val upperBound: Int = bounds(1)
  lazy val highestValue: Int = upperBound - 1
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

  def fromProto(additionalAxisProtos: Seq[AdditionalAxisProto]): Seq[AdditionalAxis] =
    additionalAxisProtos.map(
      p => AdditionalAxis(p.name, Array(p.bounds.x, p.bounds.y), p.index)
    )

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
}
