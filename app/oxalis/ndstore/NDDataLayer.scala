/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package oxalis.ndstore

import java.io.OutputStream

import com.scalableminds.braingames.binary.models.DataLayer
import com.scalableminds.braingames.binary.requester.DataCubeCache
import com.scalableminds.util.geometry.BoundingBox
import play.api.libs.json.Json

case class NDDataLayer(
                       name: String,
                       category: String,
                       elementClass: String,
                       resolutions: List[Int],
                       boundingBox: BoundingBox
                      ) extends DataLayer {
  val layerType = NDDataLayer.layerType

  val baseDir = ""
  val cubeLength = -1
  val fallback = None
  val isWritable = false
  val lengthOfLoadedBuckets = 32
  val mappings = Nil
  val nextSegmentationId = None

  def bucketHandler(cache: DataCubeCache) =
    throw new Exception("To supported for NDStore data sources.")

  def writeTo(outputStream: OutputStream): Unit =
    throw new Exception("Download not supported for NDStore data sources.")
}

object NDDataLayer {
  val layerType = "NDStore"

  implicit val ndDataLayerFormat = Json.format[NDDataLayer]
}
