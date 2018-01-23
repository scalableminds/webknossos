/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.dataformats.knossos

import com.scalableminds.webknossos.datastore.models.CubePosition
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import play.api.libs.json.Json

case class KnossosSection(name: String, resolutions: List[Int], boundingBox: BoundingBox) {

  def doesContainCube(cube: CubePosition): Boolean = {
    boundingBox.intersects(cube.toHighestResBoundingBox)
  }
}

object KnossosSection {
  implicit val knossosSectionFormat = Json.format[KnossosSection]
}

trait KnossosLayer extends DataLayer {

  val dataFormat = DataFormat.knossos

  def sections: List[KnossosSection]

  lazy val boundingBox = BoundingBox.combine(sections.map(_.boundingBox))

  lazy val resolutions: List[DataResolution] = sections.map(_.resolutions).reduce(_ union _).map(DataResolution.fromResolution)

  def lengthOfUnderlyingCubes(resolution: Int) = KnossosDataFormat.cubeLength

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
                                   ) extends SegmentationLayer with KnossosLayer

object KnossosSegmentationLayer {
  implicit val knossosSegmentationLayerFormat = Json.format[KnossosSegmentationLayer]
}
