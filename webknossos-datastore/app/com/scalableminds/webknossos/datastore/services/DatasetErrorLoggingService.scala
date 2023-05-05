package com.scalableminds.webknossos.datastore.services

import akka.actor.ActorSystem

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class DatasetErrorLoggingService @Inject()(system: ActorSystem) {
  val durationToLogAfterActivation: FiniteDuration = 5 minutes

  private val recentErrors: scala.collection.mutable.Set[(String, String)] = scala.collection.mutable.Set()

  // TODO: recent errors logic
  def registerLoggedError(organizationName: String, datasetName: String)(implicit ec: ExecutionContext): Unit = {
    recentErrors.add((organizationName, datasetName))
    system.scheduler.scheduleOnce(durationToLogAfterActivation) {
      recentErrors.remove((organizationName, datasetName))
    }
  }

  def shouldLog(organizationName: String, datasetName: String): Boolean =
    true
}
