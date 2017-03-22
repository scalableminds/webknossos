/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package oxalis.ndstore

import java.io.OutputStream

import com.scalableminds.braingames.binary.models.{DataLayer, DataLayerMapping, DataLayerSection, FallbackLayer}
import com.scalableminds.braingames.binary.requester.DataCubeCache
import com.scalableminds.util.geometry.BoundingBox
import play.api.libs.json.Json

case class NDDataLayer(
                       name: String,
                       category: String,
                       baseDir: String,
                       flags: Option[List[String]],
                       elementClass: String = "uint8",
                       isWritable: Boolean = false,
                       fallback: Option[FallbackLayer] = None,
                       sections: List[DataLayerSection] = Nil,
                       nextSegmentationId: Option[Long] = None,
                       mappings: List[DataLayerMapping] = List()
                      ) extends DataLayer {
  val layerType = NDDataLayer.layerType

  val resolutions = sections.flatMap(_.resolutions).distinct

  lazy val boundingBox = BoundingBox.combine(sections.map(_.bboxBig))

  def bucketHandler(cache: DataCubeCache) =
    throw new Exception("To supported for NDStore data sources.")

  def writeTo(outputStream: OutputStream): Unit =
    throw new Exception("Download not supported for NDStore data sources.")
}

object NDDataLayer {
  val layerType = "NDStore"

  implicit val ndDataLayerFormat = Json.format[NDDataLayer]
}
