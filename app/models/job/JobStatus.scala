package models.job

import com.scalableminds.util.time.Instant
import models.job.JobState.JobState
import play.api.libs.json.{JsObject, Json, OFormat}

case class JobStatus(
    latestRunId: Option[String],
    state: JobState,
    returnValue: Option[String],
    started: Option[Instant],
    ended: Option[Instant],
    errorDetails: Option[JsObject]
)

object JobStatus {
  implicit val jsonFormat: OFormat[JobStatus] = Json.format[JobStatus]
}
