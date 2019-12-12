package com.scalableminds.webknossos.datastore.services

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.datasource.inbox.InboxDataSourceLike
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.typesafe.scalalogging.LazyLogging
import play.api.i18n.MessagesApi
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsObject, Json}

import scala.concurrent.duration._

case class DataStoreStatus(ok: Boolean, url: String)

object DataStoreStatus {
  implicit val dataStoreStatusFormat = Json.format[DataStoreStatus]
}

trait WkRpcClient {
  def requestUserAccess(token: Option[String], accessRequest: UserAccessRequest): Fox[UserAccessAnswer]
}

class DataStoreWkRpcClient @Inject()(
    rpc: RPC,
    config: DataStoreConfig,
    val lifecycle: ApplicationLifecycle,
    @Named("webknossos-datastore") val system: ActorSystem
) extends WkRpcClient
    with IntervalScheduler
    with LazyLogging {

  private val dataStoreKey: String = config.Datastore.key
  private val dataStoreName: String = config.Datastore.name
  private val dataStoreUrl: String = config.Http.uri

  private val webKnossosUrl: String = config.Datastore.WebKnossos.uri

  protected lazy val tickerInterval: FiniteDuration = config.Datastore.WebKnossos.pingIntervalMinutes

  def tick: Unit = reportStatus(ok = true)

  def reportStatus(ok: Boolean): Fox[_] =
    rpc(s"$webKnossosUrl/api/datastores/$dataStoreName/status")
      .addQueryString("key" -> dataStoreKey)
      .patch(DataStoreStatus(ok, dataStoreUrl))

  def reportDataSource(dataSource: InboxDataSourceLike): Fox[_] =
    rpc(s"$webKnossosUrl/api/datastores/$dataStoreName/datasource")
      .addQueryString("key" -> dataStoreKey)
      .put(dataSource)

  def reportDataSources(dataSources: List[InboxDataSourceLike]): Fox[_] =
    rpc(s"$webKnossosUrl/api/datastores/$dataStoreName/datasources")
      .addQueryString("key" -> dataStoreKey)
      .put(dataSources)

  def validateDataSourceUpload(id: DataSourceId): Fox[_] =
    rpc(s"$webKnossosUrl/api/datastores/$dataStoreName/verifyUpload").addQueryString("key" -> dataStoreKey).post(id)

  override def requestUserAccess(token: Option[String], accessRequest: UserAccessRequest): Fox[UserAccessAnswer] =
    rpc(s"$webKnossosUrl/api/datastores/$dataStoreName/validateUserAccess")
      .addQueryString("key" -> dataStoreKey)
      .addQueryStringOptional("token", token)
      .postWithJsonResponse[UserAccessRequest, UserAccessAnswer](accessRequest)
}
