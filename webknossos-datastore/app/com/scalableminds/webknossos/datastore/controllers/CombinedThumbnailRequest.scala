package com.scalableminds.webknossos.datastore.controllers

import play.api.libs.json.{Json, OFormat}

case class CombinedThumbnailLayerParameters(
    dataLayerName: String,
    // Mag1 coordinates of the top-left corner of the bounding box fetched for this layer, and the
    // mag to fetch it at (mirrors the parameters of the single-layer thumbnail.jpg route). Layers may
    // pick different native mags for the same physical area, so these are computed and sent per layer.
    x: Int,
    y: Int,
    z: Int,
    mag: String,
    // Size of the fetched cuboid in voxels at this layer's own mag. The fetched image is resized to
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

object CombinedThumbnailLayerParameters {
  implicit val jsonFormat: OFormat[CombinedThumbnailLayerParameters] = Json.format[CombinedThumbnailLayerParameters]
}

case class CombinedThumbnailRequest(
    // Shared output canvas size in pixels. Every layer's fetched image is resized to this size
    // before compositing.
    width: Int,
    height: Int,
    // Paint order: first entry is painted first (bottom), last entry on top
    layers: List[CombinedThumbnailLayerParameters]
)

object CombinedThumbnailRequest {
  implicit val jsonFormat: OFormat[CombinedThumbnailRequest] = Json.format[CombinedThumbnailRequest]
}
