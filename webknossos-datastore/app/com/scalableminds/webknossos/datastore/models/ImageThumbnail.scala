package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.datasource.DataLayerLike
import play.api.libs.json.{Json, OFormat}

case class ImageThumbnail(mimeType: String, value: String)

object ImageThumbnail {
  implicit val jsonFormat: OFormat[ImageThumbnail] = Json.format[ImageThumbnail]

  def magForZoom(dataLayer: DataLayerLike, zoom: Double): Vec3Int =
    dataLayer.resolutions.minBy(r => Math.abs(r.maxDim - zoom))

  def goodThumbnailParameters(dataLayer: DataLayerLike,
                              width: Int,
                              height: Int,
                              centerX: Option[Int] = None,
                              centerY: Option[Int] = None,
                              centerZ: Option[Int] = None,
                              zoomOpt: Option[Double] = None): VoxelPosition = {
    val center =
      if (centerX.isDefined && centerY.isDefined && centerZ.isDefined)
        Vec3Int(centerX.get, centerY.get, centerZ.get)
      else dataLayer.boundingBox.center
    val mag = magForZoom(dataLayer, zoomOpt.getOrElse(1.0))
    val x = Math.max(0, center.x - width * mag.x / 2)
    val y = Math.max(0, center.y - height * mag.y / 2)
    val z = center.z
    new VoxelPosition(x.toInt, y.toInt, z.toInt, mag)
  }
}
