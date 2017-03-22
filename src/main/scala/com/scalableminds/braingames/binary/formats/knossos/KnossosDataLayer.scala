/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.formats.knossos

import java.io.{File, FileInputStream, OutputStream}
import java.nio.file.Paths

import com.scalableminds.braingames.binary.models.{DataLayer, DataLayerMapping, DataLayerSection, FallbackLayer}
import com.scalableminds.braingames.binary.repository.KnossosDataSourceType
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.io.{NamedFileStream, ZipIO}
import org.apache.commons.io.{FileUtils, FilenameUtils}
import org.apache.commons.io.filefilter.{SuffixFileFilter, TrueFileFilter}
import play.api.libs.json.Json

import scala.collection.JavaConversions._
import com.typesafe.scalalogging.LazyLogging

case class KnossosDataLayer(
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
                             sourceType: Option[String] = Some(KnossosDataSourceType.name)
                            ) extends DataLayer with LazyLogging {
  val resolutions = sections.flatMap(_.resolutions).distinct

  lazy val boundingBox = BoundingBox.combine(sections.map(_.bboxBig))

  def writeTo(outputStream: OutputStream): Unit = {
    try {
      val basePath = Paths.get(baseDir)
      val filter = new SuffixFileFilter(KnossosDataLayer.fileExtension)
      val files = FileUtils.listFiles(new File(baseDir), filter, TrueFileFilter.INSTANCE)
      ZipIO.zip(
        files.toList.map {
          file =>
            val name = s"${FilenameUtils.removeExtension(file.getAbsolutePath)}.${KnossosDataLayer.fileExtension}"
            val path = basePath.relativize(Paths.get(name))
            new NamedFileStream(file, path.toString){
              override def stream() = new FileInputStream(file)
            }
        },
        outputStream)
    } catch {
      case e: Exception =>
        logger.error(s"Failed to zip datalayer ${name} for download. Error: " + e)
    }
  }
}

object KnossosDataLayer {
  val sourceType = "knossos"

  val fileExtension = "raw"

  implicit val knossosDataLayerFormat = Json.format[KnossosDataLayer]
}
