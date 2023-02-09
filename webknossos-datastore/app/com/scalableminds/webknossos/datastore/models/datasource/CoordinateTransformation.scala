package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.webknossos.datastore.models.datasource.CoordinateTransformationType.CoordinateTransformationType
import play.api.libs.json.{Json, OFormat}

case class CoordinateTransformation(`type`: CoordinateTransformationType, matrix: Option[List[List[Double]]])

object CoordinateTransformation {
  implicit val jsonFormat: OFormat[CoordinateTransformation] = Json.format[CoordinateTransformation]
}
