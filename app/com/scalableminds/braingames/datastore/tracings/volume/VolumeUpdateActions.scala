/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.volume

import java.util.Base64

import com.scalableminds.braingames.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.braingames.datastore.tracings.{TracingService, UpdateAction, UpdateActionGroup}
import com.scalableminds.util.geometry.{Point3D, Vector3D}
import com.scalableminds.util.tools.Fox
import play.api.libs.json._

import scala.concurrent.ExecutionContext.Implicits.global

case class UpdateBucketVolumeAction(position: Point3D, cubeSize: Int, zoomStep: Int, base64Data: String) extends VolumeUpdateAction {

  lazy val data: Array[Byte] = Base64.getDecoder().decode(base64Data)

  def applyTo(tracing: VolumeTracing, service: TracingService[VolumeTracing]): Fox[VolumeTracing] = {
    Fox.successful(tracing)
  }
}

object UpdateBucketVolumeAction {
  implicit val updateBucketVolumeActionFormat = Json.format[UpdateBucketVolumeAction]
}

case class UpdateTracingVolumeAction(
                                      activeSegmentId: Long,
                                      editPosition: Point3D,
                                      editRotation: Vector3D,
                                      largestSegmentId: Long,
                                      zoomLevel: Double
                                    ) extends VolumeUpdateAction {

  def applyTo(tracing: VolumeTracing, service: TracingService[VolumeTracing]): Fox[VolumeTracing] = {
    Fox.successful(tracing)
  }
}

object UpdateTracingVolumeAction {
  implicit val updateTracingVolumeActionFormat = Json.format[UpdateTracingVolumeAction]
}

trait VolumeUpdateAction extends UpdateAction[VolumeTracing]

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

case class VolumeUpdateActionGroup(version: Long, timestamp: Long, actions: List[VolumeUpdateAction], stats: Option[JsObject]) extends UpdateActionGroup[VolumeTracing]

object VolumeUpdateActionGroup {
  implicit val volumeUpdateActionGroupReads = Json.reads[VolumeUpdateActionGroup]
}
