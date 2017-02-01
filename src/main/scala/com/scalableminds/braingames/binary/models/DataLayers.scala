/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import play.api.libs.json._
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.braingames.binary.requester.handlers.{BlockHandler, KnossosBlockHandler, WebKnossosWrapBlockHandler}
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.braingames.binary.repository.{KnossosDataSourceType, WebKnossosWrapDataSourceType}
import java.lang.Exception

import scala.util.Try

trait DataLayerLike {
  val sections: List[DataLayerSectionLike]
  val elementClass: String
  val category: String

  val elementSize = DataLayer.elementClassToSize(elementClass)
  val bytesPerElement = elementSize / 8

  def isCompatibleWith(other: DataLayerLike) =
    this.bytesPerElement == other.bytesPerElement
}

case class FallbackLayer(dataSourceName: String, layerName: String)

object FallbackLayer{
  implicit val fallbackLayerFormat = Json.format[FallbackLayer]
}

case class DataLayerType(category: String, defaultElementClass: String = "uint8")

case class DataLayer(
                      name: String,
                      category: String,
                      baseDir: String,
                      flags: Option[List[String]],
                      elementClass: String = "uint8",
                      isWritable: Boolean = false,
                      _isCompressed: Option[Boolean] = None,
                      fallback: Option[FallbackLayer] = None,
                      sections: List[DataLayerSection] = Nil,
                      nextSegmentationId: Option[Long] = None,
                      mappings: List[DataLayerMapping] = List(),
                      sourceType: Option[String] = Some(KnossosDataSourceType.name)
  ) extends DataLayerLike {

  def relativeBaseDir(binaryBase: String) = baseDir.replace(binaryBase, "")

  def isUserDataLayer = baseDir.contains("userBinaryData")

  // Should be used instead of the optional property (optional because of parsing compatibility)
  def isCompressed = _isCompressed getOrElse false

  def fileExtension = DataLayer.fileExt(isCompressed)

  def getMapping(name: String) =
    mappings.find(_.name == name)

  val resolutions = sections.flatMap(_.resolutions).distinct

  val maxCoordinates = BoundingBox.hull(sections.map(_.bboxBig))

  lazy val boundingBox = BoundingBox.combine(sections.map(_.bboxBig))
}

object DataLayer extends LazyLogging{

  val KnossosFileExtention = "raw"

  val CompressedFileExtention = "sz"

  val MappingFileExtention = "json"

  val COLOR =
    DataLayerType("color")
  val SEGMENTATION =
    DataLayerType("segmentation", "uint16")
  val CLASSIFICATION =
    DataLayerType("classification", "uint16")

  implicit val dataLayerFormat = Json.format[DataLayer]

  val supportedLayers = List(
    COLOR, SEGMENTATION, CLASSIFICATION
  )

  def supportedFileExt = List(CompressedFileExtention, KnossosFileExtention)

  def fileExt(isCompressed: Boolean) = if(isCompressed) CompressedFileExtention else KnossosFileExtention

  def isValidElementClass(elementClass: String): Boolean = {
    Try(elementClass).isSuccess
  }

  def elementClassToSize(elementClass: String): Int = elementClass match {
    case "uint8" => 8
    case "uint16" => 16
    case "uint24" => 24
    case "uint32" => 32
    case "uint64" => 64
    case _ => throw new IllegalArgumentException(s"illegal element class ($elementClass) for DataLayer")
  }
}

case class UserDataLayer(dataSourceName: String, dataLayer: DataLayer)

object UserDataLayer {
  implicit val userDataLayerFormat = Json.format[UserDataLayer]
}

object DataLayerHelpers{
  def bestResolution(dataLayer: DataLayer, width: Int, height: Int): Int = {
    // We want to make sure that the thumbnail only contains data, as much as possible but no black border
    // To make sure there is no black border we are going to go with the second best resolution (hence the `- 1`)
    val wr = math.floor(math.log(dataLayer.boundingBox.width.toDouble / width) / math.log(2)).toInt - 1
    val hr = math.floor(math.log(dataLayer.boundingBox.height.toDouble / height) / math.log(2)).toInt - 1

    math.max(0, List(wr, hr, (dataLayer.resolutions.size - 1)).min)
  }

  def goodThumbnailParameters(dataLayer: DataLayer, width: Int, height: Int) = {
    // Parameters that seem to be working good enough
    val center = dataLayer.boundingBox.center
    val resolution = bestResolution(dataLayer, width, height)
    val x = center.x - width * math.pow(2, resolution) / 2
    val y = center.y - height * math.pow(2, resolution) / 2
    val z = center.z
    (x.toInt, y.toInt, z.toInt, resolution)
  }
}
