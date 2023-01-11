package com.scalableminds.webknossos.datastore.services

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.util.cache.AlfuFoxCache
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.controllers.JobExportProperties
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationSource
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.datasource.inbox.InboxDataSourceLike
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{Json, OFormat}
import play.api.libs.ws.WSResponse

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._

case class DataStoreStatus(ok: Boolean, url: String, reportUsedStorageEnabled: Option[Boolean] = None)

object DataStoreStatus {
  implicit val jsonFormat: OFormat[DataStoreStatus] = Json.format[DataStoreStatus]
}

trait RemoteWebKnossosClient {
  def requestUserAccess(token: Option[String], accessRequest: UserAccessRequest): Fox[UserAccessAnswer]
}

class DSRemoteWebKnossosClient @Inject()(
    rpc: RPC,
    config: DataStoreConfig,
    val lifecycle: ApplicationLifecycle,
    @Named("webknossos-datastore") val system: ActorSystem
) extends RemoteWebKnossosClient
    with IntervalScheduler
    with LazyLogging
    with FoxImplicits {

  private val dataStoreKey: String = config.Datastore.key
  private val dataStoreName: String = config.Datastore.name
  private val dataStoreUri: String = config.Http.uri
  private val reportUsedStorageEnabled: Boolean = config.Datastore.ReportUsedStorage.enabled

  private val webKnossosUri: String = config.Datastore.WebKnossos.uri

  protected lazy val tickerInterval: FiniteDuration = config.Datastore.WebKnossos.pingInterval

  def tick(): Unit = reportStatus(ok = true)

  def reportStatus(ok: Boolean): Fox[_] =
    rpc(s"$webKnossosUri/api/datastores/$dataStoreName/status")
      .addQueryString("key" -> dataStoreKey)
      .patch(DataStoreStatus(ok, dataStoreUri, Some(reportUsedStorageEnabled)))

  def reportDataSource(dataSource: InboxDataSourceLike): Fox[_] =
    rpc(s"$webKnossosUri/api/datastores/$dataStoreName/datasource")
      .addQueryString("key" -> dataStoreKey)
      .put(dataSource)

  def reportUpload(dataSourceId: DataSourceId, dataSetSizeBytes: Long, userToken: Option[String]): Fox[Unit] =
    for {
      _ <- rpc(s"$webKnossosUri/api/datastores/$dataStoreName/reportDatasetUpload")
        .addQueryString("key" -> dataStoreKey)
        .addQueryString("dataSetName" -> dataSourceId.name)
        .addQueryString("dataSetSizeBytes" -> dataSetSizeBytes.toString)
        .addQueryStringOptional("token", userToken)
        .post()
    } yield ()

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

  def reserveDataSourceUpload(info: ReserveUploadInformation, userTokenOpt: Option[String]): Fox[Unit] =
    for {
      userToken <- option2Fox(userTokenOpt) ?~> "reserveUpload.noUserToken"
      _ <- rpc(s"$webKnossosUri/api/datastores/$dataStoreName/reserveUpload")
        .addQueryString("key" -> dataStoreKey)
        .addQueryString("token" -> userToken)
        .post(info)
    } yield ()

  def deleteDataSource(id: DataSourceId): Fox[_] =
    rpc(s"$webKnossosUri/api/datastores/$dataStoreName/deleteDataset").addQueryString("key" -> dataStoreKey).post(id)

  def reportUsedStorage(organizationName: String,
                        datasetName: Option[String],
                        storageReportEntries: List[DirectoryStorageReport]): Fox[Unit] =
    for {
      _ <- rpc(s"$webKnossosUri/api/datastores/$dataStoreName/reportUsedStorage")
        .addQueryString("key" -> dataStoreKey)
        .addQueryString("organizationName" -> organizationName)
        .addQueryStringOptional("datasetName", datasetName)
        .post(storageReportEntries)
    } yield ()

  def getJobExportProperties(jobId: String): Fox[JobExportProperties] =
    rpc(s"$webKnossosUri/api/datastores/$dataStoreName/jobExportProperties")
      .addQueryString("jobId" -> jobId)
      .addQueryString("key" -> dataStoreKey)
      .getWithJsonResponse[JobExportProperties]

  override def requestUserAccess(userToken: Option[String], accessRequest: UserAccessRequest): Fox[UserAccessAnswer] =
    rpc(s"$webKnossosUri/api/datastores/$dataStoreName/validateUserAccess")
      .addQueryString("key" -> dataStoreKey)
      .addQueryStringOptional("token", userToken)
      .postJsonWithJsonResponse[UserAccessRequest, UserAccessAnswer](accessRequest)

  // The annotation source needed for every chunk request. 5 seconds gets updates to the user fast enough,
  // while still limiting the number of remote lookups during streaming
  private lazy val annotationSourceCache: AlfuFoxCache[(String, Option[String]), AnnotationSource] =
    AlfuFoxCache(timeToLive = 5 seconds, timeToIdle = 5 seconds)

  def getAnnotationSource(accessToken: String, userToken: Option[String]): Fox[AnnotationSource] =
    annotationSourceCache.getOrLoad(
      (accessToken, userToken),
      _ =>
        rpc(s"$webKnossosUri/api/annotations/source/$accessToken")
          .addQueryString("key" -> dataStoreKey)
          .addQueryStringOptional("userToken", userToken)
          .getWithJsonResponse[AnnotationSource]
    )
}
