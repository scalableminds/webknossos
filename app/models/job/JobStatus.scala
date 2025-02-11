package models.job

import com.scalableminds.util.time.Instant
import models.job.JobState.JobState
import play.api.libs.json.{Json, OFormat}

case class JobStatus(
    latestRunId: Option[String],
    state: JobState,
    returnValue: Option[String],
    started: Option[Instant],
    ended: Option[Instant]
)

object JobStatus {
  implicit val jsonFormat: OFormat[JobStatus] = Json.format[JobStatus]
}
