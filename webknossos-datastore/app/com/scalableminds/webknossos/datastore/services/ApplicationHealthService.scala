package com.scalableminds.webknossos.datastore.services

import com.scalableminds.webknossos.datastore.slacknotification.DSSlackNotificationService

import java.time.Instant
import java.time.temporal.ChronoUnit
import javax.inject.Inject

case class HealthProblem(timestamp: Instant, msg: String)

class ApplicationHealthService @Inject()(slackNotificationService: DSSlackNotificationService) {
  private var encounteredProblems: List[HealthProblem] = List()

  def pushError(e: InternalError): Unit = {
    encounteredProblems = encounteredProblems :+ HealthProblem(Instant.now(), e.getMessage)
    slackNotificationService.notifyForInternalError(e)
  }

  def getRecentProblem(duration: Integer = 30): Option[HealthProblem] = {
    if (encounteredProblems.isEmpty) return None
    if (ChronoUnit.SECONDS.between(encounteredProblems.last.timestamp, Instant.now()) <= duration) {
      Some(encounteredProblems.last)
    } else {
      None
    }
  }

}
