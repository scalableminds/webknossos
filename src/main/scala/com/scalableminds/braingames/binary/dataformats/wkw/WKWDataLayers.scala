/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.dataformats.wkw

import com.scalableminds.braingames.binary.models.datasource._
import com.scalableminds.util.geometry.BoundingBox
import play.api.libs.json.Json

trait WKWLayer extends DataLayer {

  val dataFormat = DataFormat.wkw

  lazy val bucketProvider = new WKWBucketProvider(this)
}

case class WKWDataLayer(
                         name: String,
                         category: Category.Value,
                         boundingBox: BoundingBox,
                         resolutions: Set[Int],
                         elementClass: ElementClass.Value,
                         lengthOfUnderlyingCubes: Int
                       ) extends WKWLayer

object WKWDataLayer {
  implicit val wkwDataLayerFormat = Json.format[WKWDataLayer]
}

case class WKWSegmentationLayer(
                                 name: String,
                                 boundingBox: BoundingBox,
                                 resolutions: Set[Int],
                                 elementClass: ElementClass.Value,
                                 lengthOfUnderlyingCubes: Int,
                                 mappings: Set[String],
                                 largestSegmentId: Long
                               ) extends SegmentationLayer with WKWLayer

object WKWSegmentationLayer {
  implicit val wkwSegmentationLayerFormat = Json.format[WKWSegmentationLayer]
}
