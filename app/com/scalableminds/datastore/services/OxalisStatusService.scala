package com.scalableminds.datastore.services

import akka.actor.{ActorSystem, Cancellable}
import com.typesafe.scalalogging.LazyLogging

import scala.concurrent.duration._
import play.api.libs.concurrent.Execution.Implicits._

/**
  * Created by tmbo on 29.11.16.
  */
class OxalisStatusService(confService: ConfigurationService,
                          oxalisServer: OxalisServer)(implicit val system: ActorSystem)
  extends LazyLogging {

  private var scheduled: Cancellable = _

  def start(): Unit = {
    logger.trace("started oxalis status reporter")
    scheduled = system.scheduler.schedule(10.seconds, confService.oxalis.pingInterval)(reportStatusToOxalis())
  }

  private def reportStatusToOxalis() = {
    oxalisServer.reportStatus(ok = true, url = confService.serverUrl)
  }

  def stop(): Unit = {
    if (scheduled != null) {
      scheduled.cancel()
      scheduled = null
    }
  }
}
