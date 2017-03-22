/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.formats.knossos

import com.scalableminds.braingames.binary.models.{DataLayer, DataLayerMapping, DataLayerSection, FallbackLayer}
import com.scalableminds.braingames.binary.requester.DataCubeCache
import com.scalableminds.braingames.binary.requester.handlers.WebKnossosWrapBucketHandler
import com.scalableminds.util.geometry.BoundingBox
import java.io.OutputStream
import play.api.libs.json.Json

case class WKWDataLayer(
                             name: String,
                             category: String,
                             baseDir: String,
                             flags: Option[List[String]],
                             elementClass: String = "uint8",
                             isWritable: Boolean = false,
                             fallback: Option[FallbackLayer] = None,
                             sections: List[DataLayerSection] = Nil,
                             nextSegmentationId: Option[Long] = None,
                             mappings: List[DataLayerMapping] = List(),
                             layerType: String = WKWDataLayer.layerType
                            ) extends DataLayer {
  val resolutions = sections.flatMap(_.resolutions).distinct

  lazy val boundingBox = BoundingBox.combine(sections.map(_.bboxBig))

  val cubeLength = 128

  val lengthOfLoadedBuckets = 32

  def bucketHandler(cache: DataCubeCache) = new WebKnossosWrapBucketHandler(cache)

  def writeTo(outputStream: OutputStream): Unit = {
    throw new Exception("Download not yet supported for WKW data sources.")
  }
}

object WKWDataLayer {
  val layerType = "webKnossosWrap"

  val fileExtension = "wkw"

  implicit val wkwDataLayerFormat = Json.format[WKWDataLayer]
}
