/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.services

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.braingames.binary.helpers.{IntervalScheduler, RPC}
import com.scalableminds.braingames.binary.models.datasource.DataSourceId
import com.scalableminds.braingames.binary.models.datasource.inbox.InboxDataSourceLike
import com.scalableminds.braingames.datastore.tracings.volume.VolumeTracing
import com.scalableminds.util.tools.Fox
import play.api.Configuration
import play.api.i18n.MessagesApi
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.Json

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
                                ) extends IntervalScheduler {

  private val dataStoreKey: String = config.getString("datastore.key").getOrElse("something-secure")
  private val dataStoreName: String = config.getString("datastore.name").getOrElse("local-datastore")
  private val dataStoreUrl: String = config.getString("http.uri").getOrElse("http://localhost:9000")

  private val webKnossosUrl = {
    val url = config.getString("datastore.oxalis.uri").getOrElse("localhost:9000")
    config.getBoolean("datastore.oxalis.secured") match {
      case Some(true) => s"https://$url"
      case _ => s"http://$url"
    }
  }

  protected lazy val tickerInterval: FiniteDuration = config.getInt("datastore.oxalis.pingIntervalMinutes").getOrElse(10).minutes

  def tick: Unit = reportStatus(ok = true)

  def reportStatus(ok: Boolean): Fox[_] = {
    RPC(s"$webKnossosUrl/api/datastores/$dataStoreName/status")
      .withQueryString("key" -> dataStoreKey)
      .post(DataStoreStatus(ok, dataStoreUrl))
  }

  def reportDataSource(dataSource: InboxDataSourceLike): Fox[_] = {
    RPC(s"$webKnossosUrl/api/datastores/$dataStoreName/datasource")
      .withQueryString("key" -> dataStoreKey)
      .post(dataSource)
  }

  def reportDataSources(dataSources: List[InboxDataSourceLike]): Fox[_] = {
    RPC(s"$webKnossosUrl/api/datastores/$dataStoreName/datasources")
      .withQueryString("key" -> dataStoreKey)
      .post(dataSources)
  }

  def validateDataSourceUpload(token: String, id: DataSourceId): Fox[_] = {
    RPC(s"$webKnossosUrl/api/datastores/$dataStoreName/datasource")
      .withQueryString("key" -> dataStoreKey)
      .get
  }
}
