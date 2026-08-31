package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.geometry.Vec3Double
import com.scalableminds.util.tools.AutoJsonFormat
import com.scalableminds.webknossos.datastore.models.datasource.CoordinateTransformationType.CoordinateTransformationType

case class ThinPlateSplineCorrespondences(
    source: List[Vec3Double],
    target: List[Vec3Double]
) derives AutoJsonFormat

case class CoordinateTransformation(
    `type`: CoordinateTransformationType,
    matrix: Option[List[List[Double]]],
    correspondences: Option[ThinPlateSplineCorrespondences] = None
) derives AutoJsonFormat
