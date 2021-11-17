package models.job

import models.job.JobState.JobState
import play.api.libs.json.{Json, OFormat}

case class JobStatus(
    latestRunId: String,
    state: JobState,
    returnValue: Option[String],
    started: Option[Long],
    ended: Option[Long],
)

object JobStatus {
  implicit val jsonFormat: OFormat[JobStatus] = Json.format[JobStatus]
}
