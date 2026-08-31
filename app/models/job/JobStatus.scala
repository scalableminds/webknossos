package models.job

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.AutoJsonFormat
import models.job.JobState.JobState

case class JobStatus(
    latestRunId: Option[String],
    state: JobState,
    returnValue: Option[String],
    started: Option[Instant],
    ended: Option[Instant]
) derives AutoJsonFormat
