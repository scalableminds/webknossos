package com.scalableminds.webknossos.datastore.services

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.io.FileUtils
import play.api.inject.ApplicationLifecycle

import java.io.File
import java.net.URL
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._
import scala.sys.exit

class AutoUpdateService @Inject()(
    config: DataStoreConfig,
    val lifecycle: ApplicationLifecycle,
    val system: ActorSystem,
    rpc: RPC
) extends IntervalScheduler
    with LazyLogging
    with FoxImplicits {

  override protected lazy val enabled: Boolean = config.Datastore.AutoUpdate.enabled
  protected lazy val tickerInterval: FiniteDuration = 24 hours
  private val version = 5

  def checkForUpdate(): Fox[Boolean] =
    rpc("http://localhost:9090/version").getWithJsonResponse[String].map(v => v.toInt > version)

  def downloadUpdate(existsNewUpdate: Boolean): Fox[Unit] = {
    if (existsNewUpdate) {
      try {
        FileUtils.copyURLToFile(new URL("http://localhost:9090/wk.jar"), new File("update.jar"), 30000, 30000)
      } catch {
        case e: java.io.IOException => logger.error(e.getMessage)
      }
    }
    Fox.successful(())
  }

  def tick(): Unit =
    for {
      existsNewUpdate <- checkForUpdate()
      _ <- downloadUpdate(existsNewUpdate)
    } yield if (existsNewUpdate) exit(250) else ()
}
