/*
 * Copyright (C) Tom Bocklisch <https://github.com/tmbo>
 */
package models.mturk

import scala.concurrent.duration._

import models.task.AssignmentConfig
import play.api.libs.json._

case class MTurkAssignmentConfig(
  autoApprovalDelayInSeconds: Long = 72.hours.toSeconds,
  assignmentDurationInSeconds: Long = 1.hour.toSeconds,
  rewardInDollar: Double = 0.05,
  title: String = "Neuroscience reconstruction assignment",
  keywords: String = "sample, SDK, survey",
  description: String = "Help neuroscience reconstructing the brain while flying through brain images") extends AssignmentConfig {

  def id = MTurkAssignmentConfig.id
}

object MTurkAssignmentConfig {
  val id = "mturk"

  val mturkAssignmentConfigFormat = new OFormat[MTurkAssignmentConfig]{
    override def reads(json: JsValue): JsResult[MTurkAssignmentConfig] =
      Json.reads[MTurkAssignmentConfig].reads(json)

    override def writes(o: MTurkAssignmentConfig): JsObject =
      Json.writes[MTurkAssignmentConfig].writes(o).asInstanceOf[JsObject]
  }
}
