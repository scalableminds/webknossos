package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.webknossos.datastore.models.datasource.DataLayerLike
import play.api.libs.json.{Json, OFormat}

case class ImageThumbnail(mimeType: String, value: String)

object ImageThumbnail {
  implicit val jsonFormat: OFormat[ImageThumbnail] = Json.format[ImageThumbnail]

  def bestResolutionExponent(dataLayer: DataLayerLike, width: Int, height: Int, zoom: Option[Double]): Int =
    // We're either using the supplied zoom value (higher = zoomed out) or we're using the best resolution
    zoom match {
      case Some(z) => math.max(0, math.min(math.floor(math.log(z) / math.log(2)).toInt, dataLayer.resolutions.size - 1))
      case None    => 0
    }

  def goodThumbnailParameters(dataLayer: DataLayerLike,
                              width: Int,
                              height: Int,
                              centerX: Option[Int] = None,
                              centerY: Option[Int] = None,
                              centerZ: Option[Int] = None,
                              zoomOpt: Option[Double] = None): VoxelPosition = {

    // Parameters that seem to be working good enough
    val center =
      if (centerX.isDefined && centerY.isDefined && centerZ.isDefined)
        Point3D(centerX.get, centerY.get, centerZ.get)
      else dataLayer.boundingBox.center
    val resolutionExponent = bestResolutionExponent(dataLayer, width, height, zoomOpt)
    val resolution = dataLayer.lookUpResolution(resolutionExponent, snapToClosest = true)
    val x = Math.max(0, center.x - width * resolution.x / 2)
    val y = Math.max(0, center.y - height * resolution.y / 2)
    val z = center.z
    new VoxelPosition(x.toInt, y.toInt, z.toInt, resolution)
  }
}
