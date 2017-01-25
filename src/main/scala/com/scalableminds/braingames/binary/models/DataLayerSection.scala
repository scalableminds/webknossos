/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import play.api.libs.json.Json
import com.scalableminds.util.geometry.{Point3D, BoundingBox}

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 09.06.13
 * Time: 17:48
 */

case class DataLayerSection(
  baseDir: String,
  sectionId: String,
  resolutions: List[Int],
  bboxSmall: BoundingBox,
  bboxBig: BoundingBox) extends DataLayerSectionLike

trait DataLayerSectionLike {
  val bboxBig: BoundingBox
  val bboxSmall: BoundingBox
  val baseDir: String
  val sectionId: String

  /**
   * Checks if a point is inside the whole data set boundary.
   */
  def doesContainBlock(point: Point3D, blockLength: Int, resolution: Int) = {
    val topLeft = point.scale((v, _) => v * blockLength)
    bboxBig.scale(1.0f / resolution).intersects(BoundingBox(topLeft, blockLength, blockLength, blockLength))
  }
}

object DataLayerSection{
  implicit val dataLayerSectionFormat = Json.format[DataLayerSection]
}