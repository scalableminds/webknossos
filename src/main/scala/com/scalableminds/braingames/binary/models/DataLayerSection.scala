/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import play.api.libs.json.Json
import com.scalableminds.util.geometry.{BoundingBox, Point3D}

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
  def doesContainBucket(point: BucketPosition): Boolean = {
    bboxBig.contains(point.topLeft.toHighestRes)
  }
}

object DataLayerSection{
  implicit val dataLayerSectionFormat = Json.format[DataLayerSection]
}