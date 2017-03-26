/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.formats.knossos

import com.scalableminds.braingames.binary.models.BucketPosition
import com.scalableminds.util.geometry.BoundingBox
import play.api.libs.json.Json

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 09.06.13
 * Time: 17:48
 */

case class KnossosDataLayerSection(
  baseDir: String,
  sectionId: String,
  resolutions: List[Int],
  bboxSmall: BoundingBox,
  bboxBig: BoundingBox) {

  /**
    * Checks if a point is inside the whole data set boundary.
    */
  def doesContainBucket(point: BucketPosition): Boolean = {
    bboxBig.contains(point.topLeft.toHighestRes)
  }
}

object KnossosDataLayerSection{
  implicit val dataLayerSectionFormat = Json.format[KnossosDataLayerSection]
}