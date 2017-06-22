/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.services

import java.util.concurrent.atomic.AtomicInteger

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.braingames.binary.models.datasource.inbox.InboxDataSourceLike
import com.scalableminds.braingames.binary.helpers.IntervalScheduler
import com.scalableminds.braingames.binary.models.datasource.DataSourceId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import play.api.Configuration
import play.api.Play.current
import play.api.http.HeaderNames
import play.api.i18n.MessagesApi
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{Json, Writes}
import play.api.libs.ws.{WS, WSResponse}
import play.api.test.Helpers._

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future
import scala.concurrent.duration._

case class DataStoreStatus(ok: Boolean, url: String)

object DataStoreStatus {
  implicit val dataStoreStatusFormat = Json.format[DataStoreStatus]
}

class WebKnossosServer @Inject()(
                                  config: Configuration,
                                  val lifecycle: ApplicationLifecycle,
                                  @Named("braingames-binary") val system: ActorSystem,
                                  val messagesApi: MessagesApi
                                ) extends IntervalScheduler with FoxImplicits with LazyLogging {

  protected lazy val tickerInterval: FiniteDuration = config.getInt("datastore.oxalis.pingIntervalMinutes").getOrElse(10).minutes

  private val url = config.getString("datastore.oxalis.uri").getOrElse("localhost:9000")
  private val secured = config.getBoolean("datastore.oxalis.secured").getOrElse(false)
  private val webKnossosUrl = s"${if (secured) "https://" else "http://"}$url"
  private val dataStoreKey = config.getString("datastore.key").getOrElse("something-secure")
  private val dataStoreName = config.getString("datastore.name").getOrElse("local-datastore")
  private val dataStoreUrl = config.getString("http.uri").getOrElse("http://localhost:9000")

  private val requestCounter: AtomicInteger = new AtomicInteger()

  def reportStatus(ok: Boolean): Future[Any] = {
    webKnossos(s"/api/datastores/$dataStoreName/status", DataStoreStatus(ok, dataStoreUrl))
  }

  def reportDataSources(dataSources: List[InboxDataSourceLike]): Future[Any] = {
    webKnossos(s"/api/datastores/$dataStoreName/datasources", dataSources)
  }

  def reportDataSouce(dataSource: InboxDataSourceLike): Future[Any] = {
    webKnossos(s"/api/datastores/$dataStoreName/datasource", dataSource)
  }

  def validateDataSourceUpload(token: String, id: DataSourceId): Fox[Any] = {
    // TODO
    Future.successful()
  }

  def tick: Unit = reportStatus(ok = true)

  private def webKnossos[T](path: String, body: T)(implicit wrt: Writes[T]): Future[WSResponse] = {
    val jsonBody = Json.toJson(body)
    val requestId = requestCounter.getAndIncrement()

    logger.debug(s"Sending WS request to webKnossos (ID: $requestId). " +
      s"Path '$path'. Body: '${jsonBody.toString.take(100)}'")

    val request = WS
      .url(s"$webKnossosUrl$path")
      .withQueryString("key" -> dataStoreKey)
      .withHeaders(HeaderNames.CONTENT_TYPE -> "application/json")
      .post(jsonBody)
      .map { response =>
        if (response.status == OK) {
          logger.debug(s"Successful request (ID: $requestId). " +
            s"Body: '${response.body.take(100)}'")
        } else {
          logger.warn(s"Failed to send WS request to webKnossos (ID: $requestId). " +
            s"Path: '$path'. RequestBody: '${jsonBody.toString.take(100)}'. " +
            s"Status ${response.status}. ResponseBody: '${response.body.take(100)}'")
        }
        response
      }
    request.recover { case er =>
      logger.error(s"Error sending WS request to webknossos (ID: $requestId): " +
        s"${er.getMessage}\n${er.getStackTrace.mkString("\n    ")}")
    }
    request
  }
}
