package models.mturk

import models.project.AssignmentConfig
import play.api.libs.json._

case class MTurkAssignmentConfig(
  autoApprovalDelayInSeconds: Long,
  assignmentDurationInSeconds: Long,
  rewardInDollar: Double,
  requiredQualification: MTurkAssignmentQualification,
  title: String,
  keywords: String,
  description: String) extends AssignmentConfig {

  def id = MTurkAssignmentConfig.id
}

object MTurkAssignmentConfig {
  val id = "mturk"

  val mturkAssignmentConfigFormat = new OFormat[MTurkAssignmentConfig] {
    override def reads(json: JsValue): JsResult[MTurkAssignmentConfig] =
      Json.reads[MTurkAssignmentConfig].reads(json)

    override def writes(o: MTurkAssignmentConfig): JsObject =
      Json.writes[MTurkAssignmentConfig].writes(o).asInstanceOf[JsObject]
  }
}
