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
import play.api.libs.json.{JsArray, JsObject, JsString}

import java.io.File
import java.net.{HttpURLConnection, URL}
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
  private val version = "21.0.6"

  def checkForUpdate(): Fox[Boolean] =
    for {
      jsArray <- rpc("https://api.github.com/repos/scalableminds/webknossos/releases")
        .addHeader("Accept" -> "application/vnd.github.v3+json")
        .addQueryString("per_page" -> "1")
        .getWithJsonResponse[JsArray]
      jsObject <- jsArray.value.headOption.flatMap(_.validate[JsObject].asOpt)
      tag_name <- jsObject.value.get("tag_name").map(_.asInstanceOf[JsString])
      _ = logger.info(tag_name.value)
    } yield version != tag_name.value

  def downloadUpdate(existsNewUpdate: Boolean): Fox[Unit] = {
    if (existsNewUpdate) {
      try {
        var connection =
          new URL("https://api.github.com/repos/youri-k/ComparingUnrelatedTypesExample/releases/assets/39547733")
            .openConnection()
            .asInstanceOf[HttpURLConnection]
        connection.setRequestProperty("Accept", "application/octet-stream")
        if (connection.getResponseCode == HttpURLConnection.HTTP_MOVED_TEMP) {
          connection = new URL(connection.getHeaderField("Location")).openConnection().asInstanceOf[HttpURLConnection]
          connection.setRequestProperty("Accept", "application/octet-stream")
        }
        connection.setReadTimeout(30000)
        connection.setConnectTimeout(30000)
        FileUtils.copyInputStreamToFile(connection.getInputStream, new File("update.jar"))
      } catch {
        case e: java.io.IOException => logger.error(e.getMessage); Fox.failure(e.getMessage)
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
