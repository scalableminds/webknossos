package models.job

import models.job.JobState.JobState
import play.api.libs.json.{Json, OFormat}

import scala.concurrent.duration._

case class JobStatus(
    latestRunId: String,
    state: JobState,
    returnValue: Option[String],
    started: Option[Long],
    ended: Option[Long],
) {

  def duration: Option[FiniteDuration] =
    for {
      e <- ended
      s <- started
    } yield (e - s).millis

}

object JobStatus {
  implicit val jsonFormat: OFormat[JobStatus] = Json.format[JobStatus]
}
