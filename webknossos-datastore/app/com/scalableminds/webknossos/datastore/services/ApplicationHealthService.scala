package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.time.Instant
import com.scalableminds.webknossos.datastore.slacknotification.DSSlackNotificationService

import javax.inject.Inject
import scala.concurrent.duration.{DurationInt, FiniteDuration}

case class HealthProblem(timestamp: Instant, msg: String)

class ApplicationHealthService @Inject() (slackNotificationService: DSSlackNotificationService) {
  private var encounteredProblems: List[HealthProblem] = List()

  def pushError(e: InternalError): Unit = {
    encounteredProblems = HealthProblem(Instant.now, e.getMessage) :: encounteredProblems
    slackNotificationService.notifyForInternalError(e)
  }

  def getRecentProblem(duration: FiniteDuration = 1 minute): Option[HealthProblem] =
    encounteredProblems.headOption.filter(problem => !(problem.timestamp + duration).isPast)

}
