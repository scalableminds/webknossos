package models.job

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.JsonAutoFormat
import models.job.JobState.JobState
import play.api.libs.json.JsObject

case class JobStatus(
    latestRunId: Option[String],
    state: JobState,
    returnValue: Option[String],
    started: Option[Instant],
    ended: Option[Instant],
    errorDetails: Option[JsObject]
) derives JsonAutoFormat
