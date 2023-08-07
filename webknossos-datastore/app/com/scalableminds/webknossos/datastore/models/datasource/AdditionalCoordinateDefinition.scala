package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.webknossos.datastore.geometry.{AdditionalCoordinateDefinitionProto, Vec2IntProto}
import play.api.libs.json.{Format, Json}

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

  // TODO: Merge method? (Used in Datasource.scala and VolumeTracingService?)
}
