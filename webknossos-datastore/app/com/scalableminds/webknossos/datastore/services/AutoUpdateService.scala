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
import play.api.libs.json.{JsArray, JsObject, JsString, JsValue}
import webknossosDatastore.BuildInfo

import java.io
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

  def checkForUpdate(): Fox[(Boolean, List[JsObject])] =
    for {
      jsArray <- rpc("https://api.github.com/repos/scalableminds/webknossos/releases")
        .addHeader("Accept" -> "application/vnd.github.v3+json")
        .addQueryString("per_page" -> "1")
        .getWithJsonResponse[JsArray]
      jsObject <- jsArray.value.headOption.flatMap(_.validate[JsObject].asOpt)
      tag_name <- jsObject.value.get("tag_name").flatMap(_.validate[JsString].asOpt)
      assets <- jsObject.value.get("assets").flatMap(_.validate[JsArray].asOpt)
      assetObjects = assets.value.flatMap(_.validate[JsObject].asOpt).toList
    } yield (BuildInfo.ciTag != tag_name.value, assetObjects)

  def downloadUpdate(existsNewUpdate: Boolean, assets: List[JsObject]): Fox[Unit] = {
    def jarUrl(): String = {
      for {
        asset <- assets
        name = asset.value.get("name").flatMap(_.validate[JsString].asOpt).map(_.value)
      } yield {
        if (name.getOrElse("").endsWith(".jar")) {
          return name.getOrElse("")
        }
      }
      ""
    }

    val jarURL = jarUrl()
    if (existsNewUpdate && jarURL != "") {
      try {
        var connection =
          new URL(jarURL).openConnection().asInstanceOf[HttpURLConnection]
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
      (existsNewUpdate, assets) <- checkForUpdate()
      _ <- downloadUpdate(existsNewUpdate, assets)
    } yield if (existsNewUpdate) exit(250) else ()
}
