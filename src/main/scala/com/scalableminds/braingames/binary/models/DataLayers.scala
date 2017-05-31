/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import java.io.OutputStream

import com.scalableminds.braingames.binary.formats.knossos.KnossosDataLayer
import com.scalableminds.braingames.binary.formats.kvstore.KVStoreDataLayer
import com.scalableminds.braingames.binary.formats.wkw.WKWDataLayer
import com.scalableminds.braingames.binary.requester.DataCubeCache
import com.scalableminds.braingames.binary.requester.handlers.BucketHandler
import com.scalableminds.util.geometry.BoundingBox
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json._

import scala.util.Try

case class FallbackLayer(dataSourceName: String, layerName: String)

object FallbackLayer{
  implicit val fallbackLayerFormat = Json.format[FallbackLayer]
}

case class DataLayerType(category: String, defaultElementClass: String = "uint8")

trait DataLayer {
  def name: String

  def category: String

  def baseDir: String

  def relativeBaseDir(binaryBase: String) = baseDir.replace(binaryBase, "")

  def elementClass: String

  def elementSize = DataLayer.elementClassToSize(elementClass)

  def bytesPerElement = elementSize / 8

  def isCompatibleWith(other: DataLayer): Boolean =
    this.bytesPerElement == other.bytesPerElement

  def resolutions: List[Int]

  def boundingBox: BoundingBox

  def mappings: List[DataLayerMapping]

  def getMapping(name: String) =
    mappings.find(_.name == name)

  def nextSegmentationId: Option[Long]

  def bucketHandler(cache: DataCubeCache): BucketHandler

  def writeTo(outputStream: OutputStream)

  /**
    * Checks if a point is inside the whole data set boundary.
    */
  def doesContainBucket(point: BucketPosition): Boolean = {
    boundingBox.contains(point.topLeft.toHighestRes)
  }

  /**
    * Number of voxels per dimension in the storage format
    */
  def cubeLength: Int // TODO: Should not (need to) be exposed.

  /**
    * Defines the size of the buckets loaded from files. This is the minimal size that can be loaded from a file.
    */
  def lengthOfLoadedBuckets: Int

  // TODO: remove after UserDataLayers are stored in DB
  def fallback: Option[FallbackLayer]
  def isWritable: Boolean
  def isUserDataLayer = baseDir.contains("userBinaryData")
}

object DataLayer extends LazyLogging{
  val COLOR = DataLayerType("color")
  val SEGMENTATION = DataLayerType("segmentation", "uint16")
  val CLASSIFICATION = DataLayerType("classification", "uint16")

  val dataLayerReads = new Reads[DataLayer] {
    val layerTypeReads: Reads[String] = (JsPath \ "layerType").read[String]

    def reads(json: JsValue): JsResult[DataLayer] = {
      json.validate(layerTypeReads).flatMap {
        case KnossosDataLayer.layerType =>
          json.validate[KnossosDataLayer]
        case WKWDataLayer.layerType =>
          json.validate[WKWDataLayer]
        case KVStoreDataLayer.layerType =>
          json.validate[KVStoreDataLayer]
        case unknownType =>
          JsError(s"Unexpected data layer type: ${unknownType}")
      }
    }
  }

  val dataLayerWrites = new Writes[DataLayer] {
    def writes(dl: DataLayer): JsValue = {
      dl match {
        case layer: KnossosDataLayer =>
          Json.toJson(layer)
        case layer: WKWDataLayer =>
          Json.toJson(layer)
        case layer: KVStoreDataLayer =>
          Json.toJson(layer)
        case _ =>
          Json.obj()
      }
    }
  }

  implicit val dataLayerFormat = Format(dataLayerReads, dataLayerWrites)

  val supportedLayers = List(
    COLOR, SEGMENTATION, CLASSIFICATION
  )

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
