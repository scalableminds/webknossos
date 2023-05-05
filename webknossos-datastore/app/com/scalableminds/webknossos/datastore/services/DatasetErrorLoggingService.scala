package com.scalableminds.webknossos.datastore.services

import akka.actor.ActorSystem

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class DatasetErrorLoggingService @Inject()(system: ActorSystem) {
  val durationToLogAfterActivation: FiniteDuration = 5 minutes

  private val mutableSet: scala.collection.mutable.Set[(String, String)] = scala.collection.mutable.Set()

  def addDataset(organizationName: String, datasetName: String)(implicit ec: ExecutionContext): Unit = {
    mutableSet.add((organizationName, datasetName))
    system.scheduler.scheduleOnce(durationToLogAfterActivation) {
      mutableSet.remove((organizationName, datasetName))
    }
  }

  def shouldLog(organizationName: String, datasetName: String): Boolean =
    mutableSet.contains((organizationName, datasetName))
}
