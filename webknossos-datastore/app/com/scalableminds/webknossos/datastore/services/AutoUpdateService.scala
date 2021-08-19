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
import webknossosDatastore.BuildInfo

import java.io.File
import java.net.{HttpURLConnection, URL}
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._
import scala.sys.exit

trait GithubReleaseChecker {
  def rpc: RPC

  def checkForUpdate(): Fox[(Boolean, List[JsObject])] =
    for {
      jsObject <- rpc("https://api.github.com/repos/youri-k/ComparingUnrelatedTypesExample/releases/latest")
        .addHeader("Accept" -> "application/vnd.github.v3+json")
        .getWithJsonResponse[JsObject]
      tag_name <- jsObject.value.get("tag_name").flatMap(_.validate[JsString].asOpt)
      assets <- jsObject.value.get("assets").flatMap(_.validate[JsArray].asOpt)
      assetObjects = assets.value.flatMap(_.validate[JsObject].asOpt).toList
    } yield (BuildInfo.ciTag != tag_name.value, assetObjects)

  def getUrlForFileEnding(assets: List[JsObject], fileEnding: String): String = {
    for {
      asset <- assets
      name = asset.value.get("name").flatMap(_.validate[JsString].asOpt).map(_.value)
      url = asset.value.get("url").flatMap(_.validate[JsString].asOpt).map(_.value)
    } yield {
      if (name.getOrElse("").endsWith(fileEnding) && url.getOrElse("") != "") {
        return url.getOrElse("")
      }
    }
    ""
  }
}

class AutoUpdateService @Inject()(
    config: DataStoreConfig,
    val lifecycle: ApplicationLifecycle,
    val system: ActorSystem,
    val rpc: RPC
) extends IntervalScheduler
    with LazyLogging
    with FoxImplicits
    with GithubReleaseChecker {

  override protected lazy val enabled: Boolean = config.Datastore.AutoUpdate.enabled
  protected lazy val tickerInterval: FiniteDuration = 24 hours

  def downloadUpdate(existsNewUpdate: Boolean, assets: List[JsObject]): Fox[Boolean] = {
    def downloadGithubFile(url: String, fileNameOnDisk: String): Fox[Boolean] = {
      if (url == "") return Fox.successful(false)
      try {
        var connection =
          new URL(url).openConnection().asInstanceOf[HttpURLConnection]
        connection.setRequestProperty("Accept", "application/octet-stream")
        if (connection.getResponseCode == HttpURLConnection.HTTP_MOVED_TEMP) {
          connection = new URL(connection.getHeaderField("Location")).openConnection().asInstanceOf[HttpURLConnection]
          connection.setRequestProperty("Accept", "application/octet-stream")
        }
        connection.setReadTimeout(30000)
        connection.setConnectTimeout(30000)
        FileUtils.copyInputStreamToFile(connection.getInputStream, new File(fileNameOnDisk))
      } catch {
        case e: java.io.IOException =>
          logger.error(e.getMessage)
          return Fox.failure(e.getMessage)
      }
      Fox.successful(true)
    }

    if (existsNewUpdate) {
      for {
        jarUpdate <- downloadGithubFile(getUrlForFileEnding(assets, ".jar"), "update.jar")
        bashUpdate <- downloadGithubFile(getUrlForFileEnding(assets, ".sh"), "update.sh")
      } yield jarUpdate || bashUpdate
    } else {
      Fox.successful(false)
    }
  }

  def tick(): Unit =
    for {
      (existsNewUpdate, assets) <- checkForUpdate()
      needsRestart <- downloadUpdate(existsNewUpdate, assets)
    } yield if (needsRestart) exit(250) else ()
}
