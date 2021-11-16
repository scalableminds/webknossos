package models.job

import models.job.JobState.JobState
import play.api.libs.json.{Json, OFormat}

case class JobStatus(
    latest_run_id: String, // TODO: make camel case again, but cannot use auto-generated json format then (custom format needed either here or in worker)
    state: JobState,
    return_value: Option[String],
    started: Option[Long],
    ended: Option[Long],
)

object JobStatus {
  implicit val jsonFormat: OFormat[JobStatus] = Json.format[JobStatus]
}
