/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.models

import com.scalableminds.util.geometry.Point3D
import play.api.libs.json._


case class BinaryDataBucket(position: Point3D, zoomStep: Int, fourBit: Option[Boolean])

object BinaryDataBucket {
  implicit val binaryDataBucketFormat = Json.format[BinaryDataBucket]
}

case class BinaryDataRequest(cubeSize: Int, buckets: List[BinaryDataBucket])

object BinaryDataRequest {
  implicit val binaryDataRequestFormat = Json.format[BinaryDataRequest]
}
