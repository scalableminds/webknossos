package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.webknossos.datastore.geometry.{AdditionalAxisProto, Vec2IntProto}
import net.liftweb.common.{Box, Failure, Full}
import play.api.libs.json.{Format, Json}

// bounds: lower bound inclusive, upper bound exclusive
case class AdditionalAxis(name: String, bounds: Array[Int], index: Int) {
  def lowerBound: Int = bounds(0)
  def upperBound: Int = bounds(1)
}

object AdditionalAxis {
  implicit val jsonFormat: Format[AdditionalAxis] = Json.format[AdditionalAxis]

  def toProto(additionalCoordinatesDefinitionsOpt: Option[Seq[AdditionalAxis]]): Seq[AdditionalAxisProto] =
    additionalCoordinatesDefinitionsOpt match {
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
    val additionalCoordinatesMap = scala.collection.mutable.Map[String, (Int, Int, Int)]()
    additionalAxeses.foreach {
      case Some(additionalAxes) =>
        for (additionalAxis <- additionalAxes) {
          val additionalCoordinateToInsert = additionalCoordinatesMap.get(additionalAxis.name) match {
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
          additionalCoordinatesMap(additionalAxis.name) = additionalCoordinateToInsert
        }
      case None =>
    }
    val additionalCoordinates = additionalCoordinatesMap.iterator.map {
      case (name, (index, lowerBound, upperBound)) =>
        AdditionalAxis(name, Array(lowerBound, upperBound), index)
    }.toSeq
    if (additionalCoordinates.isEmpty) {
      None
    } else {
      Some(additionalCoordinates)
    }
  }

  def mergeAndAssertSameAdditionalAxes(
      additionalCoordinateDefinitions: Seq[Option[Seq[AdditionalAxis]]]): Box[Option[Seq[AdditionalAxis]]] = {
    val merged = merge(additionalCoordinateDefinitions)
    val mergedCount = merged match {
      case Some(definitions) => definitions.size
      case None              => 0
    }
    val sameAdditionalCoordinates = additionalCoordinateDefinitions.forall {
      case Some(definitions) => definitions.size == mergedCount
      case None              => 0 == mergedCount
    }
    if (sameAdditionalCoordinates) {
      Full(merged)
    } else {
      Failure("dataSet.additionalCoordinates.different")
    }
  }
}
