/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.formats.knossos

import java.io.{File, FileInputStream, OutputStream}
import java.nio.file.Paths

import com.scalableminds.braingames.binary.models.{DataLayer, DataLayerMapping, DataLayerSection, FallbackLayer}
import com.scalableminds.braingames.binary.requester.DataCubeCache
import com.scalableminds.braingames.binary.requester.handlers.{KnossosBucketHandler, WebKnossosWrapBucketHandler}
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.io.{NamedFileStream, ZipIO}
import org.apache.commons.io.{FileUtils, FilenameUtils}
import org.apache.commons.io.filefilter.{SuffixFileFilter, TrueFileFilter}
import play.api.libs.json.Json

import scala.collection.JavaConversions._
import com.typesafe.scalalogging.LazyLogging

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
                             mappings: List[DataLayerMapping] = List()
                            ) extends DataLayer with LazyLogging {
  val sourceType = WKWDataLayer.sourceType

  val resolutions = sections.flatMap(_.resolutions).distinct

  lazy val boundingBox = BoundingBox.combine(sections.map(_.bboxBig))

  def bucketHandler(cache: DataCubeCache) = new WebKnossosWrapBucketHandler(cache)

  def writeTo(outputStream: OutputStream): Unit = {
    throw new Exception("Download not yet supported for WKW data sources.");
  }
}

object WKWDataLayer {
  val sourceType = "webKnossosWrap"

  val fileExtension = "wkw"

  implicit val wkwDataLayerFormat = Json.format[WKWDataLayer]
}
