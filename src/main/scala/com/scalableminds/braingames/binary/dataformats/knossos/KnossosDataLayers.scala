/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.dataformats.knossos

import com.scalableminds.braingames.binary.models.CubePosition
import com.scalableminds.braingames.binary.models.datasource._
import com.scalableminds.util.geometry.BoundingBox
import play.api.libs.json.Json

case class KnossosSection(name: String, resolutions: Set[Int], boundingBox: BoundingBox) {

  def doesContainCube(cube: CubePosition): Boolean = {
    boundingBox.contains(cube.topLeft.toHighestRes)
  }
}

object KnossosSection {
  implicit val knossosSectionFormat = Json.format[KnossosSection]
}

trait KnossosLayer extends DataLayer {

  val dataFormat = DataFormat.knossos

  def sections: List[KnossosSection]

  lazy val boundingBox = BoundingBox.combine(sections.map(_.boundingBox))

  lazy val resolutions: Set[Int] = sections.map(_.resolutions).reduce(_ union _)

  val lengthOfUnderlyingCubes = KnossosDataFormat.cubeLength

  lazy val bucketProvider = new KnossosBucketProvider(this)
}

case class KnossosDataLayer(
                              name: String,
                              category: Category.Value,
                              sections: List[KnossosSection],
                              elementClass: ElementClass.Value
                            ) extends KnossosLayer

object KnossosDataLayer {
  implicit val knossosDataLayerFormat = Json.format[KnossosDataLayer]
}

case class KnossosSegmentationLayer(
                                     name: String,
                                     sections: List[KnossosSection],
                                     elementClass: ElementClass.Value,
                                     mappings: Set[String],
                                     largestSegmentId: Long
                                   ) extends SegmentationLayer with KnossosLayer {

  lazy val mappingLoader = 123
}

object KnossosSegmentationLayer {
  implicit val knossosSegmentationDataLayerFormat = Json.format[KnossosSegmentationLayer]
}
