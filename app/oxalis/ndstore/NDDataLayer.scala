/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package oxalis.ndstore

import com.scalableminds.braingames.binary.dataformats.CubeLoader
import com.scalableminds.braingames.binary.models.datasource.{Category, DataFormat, DataLayer, ElementClass}
import com.scalableminds.util.geometry.BoundingBox
import play.api.libs.json.Json

case class NDDataLayer(
                       name: String,
                       category: Category.Value,
                       elementClass: ElementClass.Value,
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

  // TODO jfrohnhofen should not be necessary
  val lengthOfUnderlyingCubes: Int = 0
  val layerFormat = DataFormat.wkw
  def cubeLoader: CubeLoader = throw new Exception("To supported for NDStore data sources.")
}

object NDDataLayer {
  val layerType = "NDStore"

  implicit val ndDataLayerFormat = Json.format[NDDataLayer]
}
