package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.webknossos.datastore.models.datasource.CoordinateTransformationType.CoordinateTransformationType
import play.api.libs.json.{Json, OFormat}

case class ThinPlateSplineCorrespondences(
    source: List[Double],
    target: List[Double]
)

object ThinPlateSplineCorrespondences {
  implicit val jsonFormat: OFormat[ThinPlateSplineCorrespondences] = Json.format[ThinPlateSplineCorrespondences]
}

case class CoordinateTransformation(`type`: CoordinateTransformationType,
                                    matrix: Option[List[List[Double]]],
                                    correspondences: Option[ThinPlateSplineCorrespondences])

object CoordinateTransformation {
  implicit val jsonFormat: OFormat[CoordinateTransformation] = Json.format[CoordinateTransformation]
}
