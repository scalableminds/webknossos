/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.datastore.tracings.volume

import java.util.Base64

import com.scalableminds.webknossos.datastore.datastore.tracings.UpdateAction.VolumeUpdateAction
import com.scalableminds.util.geometry.{Point3D, Vector3D}
import play.api.libs.json._

case class UpdateBucketVolumeAction(position: Point3D, cubeSize: Int, zoomStep: Int, base64Data: String) extends VolumeUpdateAction {
  lazy val data: Array[Byte] = Base64.getDecoder().decode(base64Data)
}

object UpdateBucketVolumeAction {
  implicit val updateBucketVolumeActionFormat = Json.format[UpdateBucketVolumeAction]
}

case class UpdateTracingVolumeAction(
                                      activeSegmentId: Long,
                                      editPosition: Point3D,
                                      editRotation: Vector3D,
                                      largestSegmentId: Long,
                                      zoomLevel: Double,
                                      userBoundingBox: Option[com.scalableminds.util.geometry.BoundingBox]
                                    ) extends VolumeUpdateAction

object UpdateTracingVolumeAction {
  implicit val updateTracingVolumeActionFormat = Json.format[UpdateTracingVolumeAction]
}

object VolumeUpdateAction {

  implicit object volumeUpdateActionReads extends Reads[VolumeUpdateAction] {
    override def reads(json: JsValue): JsResult[VolumeUpdateAction] = {
      (json \ "name").validate[String].flatMap {
        case "updateBucket" => (json \ "value").validate[UpdateBucketVolumeAction]
        case "updateTracing" => (json \ "value").validate[UpdateTracingVolumeAction]
        case unknownAction: String => JsError(s"Invalid update action s'$unknownAction'")
      }
    }
  }
}
