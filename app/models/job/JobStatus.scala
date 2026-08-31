package models.job

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.AutoFormat
import models.job.JobState.JobState

case class JobStatus(
    latestRunId: Option[String],
    state: JobState,
    returnValue: Option[String],
    started: Option[Instant],
    ended: Option[Instant]
) derives AutoFormat
