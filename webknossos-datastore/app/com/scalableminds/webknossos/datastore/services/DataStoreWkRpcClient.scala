package com.scalableminds.webknossos.datastore.services

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.datasource.inbox.InboxDataSourceLike
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{Json, OFormat}
import play.api.libs.ws.WSResponse

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._

case class DataStoreStatus(ok: Boolean, url: String)

object DataStoreStatus {
  implicit val jsonFormat: OFormat[DataStoreStatus] = Json.format[DataStoreStatus]
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
    with LazyLogging
    with FoxImplicits {

  private val dataStoreKey: String = config.Datastore.key
  private val dataStoreName: String = config.Datastore.name
  private val dataStoreUri: String = config.Http.uri

  private val webKnossosUri: String = config.Datastore.WebKnossos.uri

  protected lazy val tickerInterval: FiniteDuration = config.Datastore.WebKnossos.pingIntervalMinutes

  def tick(): Unit = reportStatus(ok = true)

  def reportStatus(ok: Boolean): Fox[_] =
    rpc(s"$webKnossosUri/api/datastores/$dataStoreName/status")
      .addQueryString("key" -> dataStoreKey)
      .patch(DataStoreStatus(ok, dataStoreUri))

  def reportDataSource(dataSource: InboxDataSourceLike): Fox[_] =
    rpc(s"$webKnossosUri/api/datastores/$dataStoreName/datasource")
      .addQueryString("key" -> dataStoreKey)
      .put(dataSource)

  def reportUpload(dataSourceId: DataSourceId,
                   initialTeams: List[String],
                   dataSetSizeBytes: Long,
                   userTokenOpt: Option[String]): Fox[_] = {
    val sleepDuration = 1000 // sleep for 1 second to give wk time to properly register the dataset
    for {
      userToken <- option2Fox(userTokenOpt) ?~> "initialTeams.noUserToken"
      _ = Thread.sleep(sleepDuration)
      _ <- rpc(s"$webKnossosUri/api/datastores/$dataStoreName/reportDatasetUpload")
        .addQueryString("key" -> dataStoreKey)
        .addQueryString("dataSetName" -> dataSourceId.name)
        .addQueryString("dataSetSizeBytes" -> dataSetSizeBytes.toString)
        .addQueryString("token" -> userToken)
        .post(initialTeams)
    } yield ()
  }

  def reportIsosurfaceRequest(userToken: Option[String]): Fox[WSResponse] =
    rpc(s"$webKnossosUri/api/datastores/$dataStoreName/reportIsosurfaceRequest")
      .addQueryString("key" -> dataStoreKey)
      .addQueryStringOptional("token", userToken)
      .post()

  def reportDataSources(dataSources: List[InboxDataSourceLike]): Fox[_] =
    rpc(s"$webKnossosUri/api/datastores/$dataStoreName/datasources")
      .addQueryString("key" -> dataStoreKey)
      .silent
      .put(dataSources)

  def validateDataSourceUpload(id: DataSourceId): Fox[_] =
    rpc(s"$webKnossosUri/api/datastores/$dataStoreName/verifyUpload").addQueryString("key" -> dataStoreKey).post(id)

  def deleteErroneousDataSource(id: DataSourceId): Fox[_] =
    rpc(s"$webKnossosUri/api/datastores/$dataStoreName/deleteErroneous").addQueryString("key" -> dataStoreKey).post(id)

  override def requestUserAccess(token: Option[String], accessRequest: UserAccessRequest): Fox[UserAccessAnswer] =
    rpc(s"$webKnossosUri/api/datastores/$dataStoreName/validateUserAccess")
      .addQueryString("key" -> dataStoreKey)
      .addQueryStringOptional("token", token)
      .postWithJsonResponse[UserAccessRequest, UserAccessAnswer](accessRequest)
}
