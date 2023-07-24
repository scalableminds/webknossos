package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.webknossos.datastore.geometry.AdditionalCoordinateDefinitionProto
import play.api.libs.json.{Format, Json}

case class AdditionalCoordinate(name: String, bounds: Array[Int], index: Int) {
  def lowerBound: Int = bounds(0)
  def upperBound: Int = bounds(1)
}

object AdditionalCoordinate {
  implicit val jsonFormat: Format[AdditionalCoordinate] = Json.format[AdditionalCoordinate]

  def toProto(additionalCoordinatesOpt: Option[Seq[AdditionalCoordinate]]): Seq[AdditionalCoordinateDefinitionProto] =
    additionalCoordinatesOpt match {
      case Some(additionalCoordinates) =>
        additionalCoordinates.map(
          additionalCoordinate =>
            AdditionalCoordinateDefinitionProto(additionalCoordinate.name,
                                                additionalCoordinate.index,
                                                additionalCoordinate.lowerBound,
                                                additionalCoordinate.upperBound))
      case None => Seq()
    }
}
