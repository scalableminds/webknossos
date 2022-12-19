package com.scalableminds.webknossos.datastore.services

import com.scalableminds.webknossos.datastore.slacknotification.DSSlackNotificationService
import org.joda.time.LocalDateTime

import java.time.Instant
import java.time.temporal.ChronoUnit
import javax.inject.Inject

case class HealthProblem(timestamp: Instant, msg: String)

class ApplicationHealthService @Inject()(slackNotificationService: DSSlackNotificationService) {
    var lastProblem : Option[HealthProblem] = None

    def setNewProblem(msg: String): Unit =
      lastProblem = Some(HealthProblem(Instant.now(), msg))
      slackNotificationService.notifyForSigbusError()

    def problemWasRecent(duration: Integer = 30): Option[HealthProblem] =
      lastProblem match {
        case None => None
        case Some(h) => {
          if(ChronoUnit.SECONDS.between(h.timestamp, Instant.now()) <= 30) {
            Some(h)
          } else {
            None
          }
        }
      }

}
