package com.scalableminds.webknossos.datastore.controllers

import play.api.libs.json.{Json, OFormat}

case class DatasetThumbnailLayerParameters(
    dataLayerName: String,
    // Mag1 coordinates of the top-left corner of the bounding box fetched for this layer, and the mag to fetch it at.
    x: Int,
    y: Int,
    z: Int,
    mag: String,
    // Size of the fetched cuboid in voxels at this layer's mag. The fetched image is resized to
    // the request-level shared output (width, height) before compositing.
    width: Int,
    height: Int,
    mappingName: Option[String],
    intensityMin: Option[Double],
    intensityMax: Option[Double],
    color: Option[String],
    invertColor: Option[Boolean],
    opacity: Double
)

object DatasetThumbnailLayerParameters {
  implicit val jsonFormat: OFormat[DatasetThumbnailLayerParameters] = Json.format[DatasetThumbnailLayerParameters]
}

case class DatasetThumbnailRequest(
    // Shared output canvas size in pixels.
    width: Int,
    height: Int,
    // Paint order: first entry is painted first (bottom), last entry on top
    layers: List[DatasetThumbnailLayerParameters],
    blendMode: String
)

object DatasetThumbnailRequest {
  implicit val jsonFormat: OFormat[DatasetThumbnailRequest] = Json.format[DatasetThumbnailRequest]
}
