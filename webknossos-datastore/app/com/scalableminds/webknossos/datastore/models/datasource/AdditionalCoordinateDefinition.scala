package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.webknossos.datastore.geometry.{AdditionalCoordinateDefinitionProto, Vec2IntProto}
import net.liftweb.common.{Box, Failure, Full}
import play.api.libs.json.{Format, Json}

// bounds: lower bound inclusive, upper bound exclusive
case class AdditionalCoordinateDefinition(name: String, bounds: Array[Int], index: Int) {
  def lowerBound: Int = bounds(0)
  def upperBound: Int = bounds(1)
}

object AdditionalCoordinateDefinition {
  implicit val jsonFormat: Format[AdditionalCoordinateDefinition] = Json.format[AdditionalCoordinateDefinition]

  def toProto(additionalCoordinatesDefinitionsOpt: Option[Seq[AdditionalCoordinateDefinition]])
    : Seq[AdditionalCoordinateDefinitionProto] =
    additionalCoordinatesDefinitionsOpt match {
      case Some(additionalCoordinates) =>
        additionalCoordinates.map(
          additionalCoordinate =>
            AdditionalCoordinateDefinitionProto(
              additionalCoordinate.name,
              additionalCoordinate.index,
              Vec2IntProto(additionalCoordinate.lowerBound, additionalCoordinate.upperBound)))
      case None => Seq()
    }

  def fromProto(additionalCoordinateDefinitionProtos: Seq[AdditionalCoordinateDefinitionProto])
    : Seq[AdditionalCoordinateDefinition] =
    additionalCoordinateDefinitionProtos.map(
      p => AdditionalCoordinateDefinition(p.name, Array(p.bounds.x, p.bounds.y), p.index)
    )

  def merge(additionalCoordinateDefinitions: Seq[Option[Seq[AdditionalCoordinateDefinition]]])
    : Option[Seq[AdditionalCoordinateDefinition]] = {
    val additionalCoordinatesMap = scala.collection.mutable.Map[String, (Int, Int, Int)]()
    additionalCoordinateDefinitions.foreach {
      case Some(additionalCoordinates) =>
        for (additionalCoordinate <- additionalCoordinates) {
          val additionalCoordinateToInsert = additionalCoordinatesMap.get(additionalCoordinate.name) match {
            case Some((existingIndex, existingLowerBound, existingUpperBound)) =>
              /* Index: The index can not be merged as it may describe data on a different server. Currently one index
              is chosen arbitrarily. For annotations this is fine, since the index is only used for sorting there;
              but merging additional coordinates describing data on a remote server with different indices is not
              supported by this.
               */
              (existingIndex,
               math.min(existingLowerBound, additionalCoordinate.lowerBound),
               math.max(existingUpperBound, additionalCoordinate.upperBound))
            case None =>
              (additionalCoordinate.index, additionalCoordinate.lowerBound, additionalCoordinate.upperBound)
          }
          additionalCoordinatesMap(additionalCoordinate.name) = additionalCoordinateToInsert
        }
      case None =>
    }
    val additionalCoordinates = additionalCoordinatesMap.iterator.map {
      case (name, (index, lowerBound, upperBound)) =>
        AdditionalCoordinateDefinition(name, Array(lowerBound, upperBound), index)
    }.toSeq
    if (additionalCoordinates.isEmpty) {
      None
    } else {
      Some(additionalCoordinates)
    }
  }

  def mergeAndAssertSameAdditionalCoordinates(
      additionalCoordinateDefinitions: Seq[Option[Seq[AdditionalCoordinateDefinition]]])
    : Box[Option[Seq[AdditionalCoordinateDefinition]]] = {
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
