package models.mturk

import models.project.AssignmentConfig
import play.api.libs.json._

/**
  * Configuration for a HIT on Amazon Turk
  *
  * @param autoApprovalDelayInSeconds  describes the duration after a submitted assignment for a HIT gets automatically
  *                                    accepted by mturk. Until that time, we can decide to accept or reject any
  *                                    assignment made. MAX: 30 days (2.592.000 seconds)
  * @param assignmentDurationInSeconds the maximum time a worker has to complete an assignment before it will get
  *                                    closed automatically
  * @param rewardInDollar              amount of money the worker can earn by completing the task
  * @param requiredQualification       Identifier for one of the predefined webknossos qualifications.
  *                                    Allows to restrict mturk workers to specific group (e.g. mturk masters, workers
  *                                    with high acceptance rate)
  * @param title                       Title to be displayed on mturk
  * @param keywords                    keywords (used for search on mturk)
  * @param description                 first few sentences the user will read while looking for HITs
  */
case class MTurkAssignmentConfig(
  autoApprovalDelayInSeconds: Long,
  assignmentDurationInSeconds: Long,
  rewardInDollar: Double,
  requiredQualification: MTurkAssignmentQualification,
  title: String,
  keywords: String,
  template: Option[String],
  description: String) extends AssignmentConfig {

  def id = MTurkAssignmentConfig.id

  def supportsChangeOfNumInstances = false
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
