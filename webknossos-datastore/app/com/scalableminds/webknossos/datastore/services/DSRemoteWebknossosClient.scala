package com.scalableminds.webknossos.datastore.services

import org.apache.pekko.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.controllers.JobExportProperties
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationSource
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.datasource.inbox.InboxDataSourceLike
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.uploading.ReserveUploadInformation
import com.scalableminds.webknossos.datastore.storage.DataVaultCredential
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{Json, OFormat}

import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

case class DataStoreStatus(ok: Boolean, url: String, reportUsedStorageEnabled: Option[Boolean] = None)
object DataStoreStatus {
  implicit val jsonFormat: OFormat[DataStoreStatus] = Json.format[DataStoreStatus]
}

case class TracingStoreInfo(name: String, url: String)
object TracingStoreInfo {
  implicit val jsonFormat: OFormat[TracingStoreInfo] = Json.format[TracingStoreInfo]
}

trait RemoteWebknossosClient {
  def requestUserAccess(token: Option[String], accessRequest: UserAccessRequest): Fox[UserAccessAnswer]
}

class DSRemoteWebknossosClient @Inject()(
    rpc: RPC,
    config: DataStoreConfig,
    val lifecycle: ApplicationLifecycle,
    @Named("webknossos-datastore") val system: ActorSystem
)(implicit val ec: ExecutionContext)
    extends RemoteWebknossosClient
    with IntervalScheduler
    with LazyLogging
    with FoxImplicits {

  private val dataStoreKey: String = config.Datastore.key
  private val dataStoreName: String = config.Datastore.name
  private val dataStoreUri: String = config.Http.uri
  private val reportUsedStorageEnabled: Boolean = config.Datastore.ReportUsedStorage.enabled

  private val webknossosUri: String = config.Datastore.WebKnossos.uri

  protected lazy val tickerInterval: FiniteDuration = config.Datastore.WebKnossos.pingInterval

  def tick(): Unit = reportStatus()

  private def reportStatus(): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/status")
      .addQueryString("key" -> dataStoreKey)
      .patch(DataStoreStatus(ok = true, dataStoreUri, Some(reportUsedStorageEnabled)))

  def reportDataSource(dataSource: InboxDataSourceLike): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasource")
      .addQueryString("key" -> dataStoreKey)
      .put(dataSource)

  def reportUpload(dataSourceId: DataSourceId,
                   datasetSizeBytes: Long,
                   needsConversion: Boolean,
                   viaAddRoute: Boolean,
                   userToken: Option[String]): Fox[Unit] =
    for {
      _ <- rpc(s"$webknossosUri/api/datastores/$dataStoreName/reportDatasetUpload")
        .addQueryString("key" -> dataStoreKey)
        .addQueryString("datasetName" -> dataSourceId.name)
        .addQueryString("needsConversion" -> needsConversion.toString)
        .addQueryString("viaAddRoute" -> viaAddRoute.toString)
        .addQueryString("datasetSizeBytes" -> datasetSizeBytes.toString)
        .addQueryStringOptional("token", userToken)
        .post()
    } yield ()

  def reportDataSources(dataSources: List[InboxDataSourceLike]): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasources")
      .addQueryString("key" -> dataStoreKey)
      .silent
      .put(dataSources)

  def reserveDataSourceUpload(info: ReserveUploadInformation, userTokenOpt: Option[String]): Fox[Unit] =
    for {
      userToken <- option2Fox(userTokenOpt) ?~> "reserveUpload.noUserToken"
      _ <- rpc(s"$webknossosUri/api/datastores/$dataStoreName/reserveUpload")
        .addQueryString("key" -> dataStoreKey)
        .addQueryString("token" -> userToken)
        .post(info)
    } yield ()

  def deleteDataSource(id: DataSourceId): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/deleteDataset").addQueryString("key" -> dataStoreKey).post(id)

  def getJobExportProperties(jobId: String): Fox[JobExportProperties] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/jobExportProperties")
      .addQueryString("jobId" -> jobId)
      .addQueryString("key" -> dataStoreKey)
      .getWithJsonResponse[JobExportProperties]

  override def requestUserAccess(userToken: Option[String], accessRequest: UserAccessRequest): Fox[UserAccessAnswer] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/validateUserAccess")
      .addQueryString("key" -> dataStoreKey)
      .addQueryStringOptional("token", userToken)
      .postJsonWithJsonResponse[UserAccessRequest, UserAccessAnswer](accessRequest)

  private lazy val tracingstoreUriCache: AlfuCache[String, String] = AlfuCache()
  def getTracingstoreUri: Fox[String] =
    tracingstoreUriCache.getOrLoad(
      "tracingStore",
      _ =>
        for {
          tracingStoreInfo <- rpc(s"$webknossosUri/api/tracingstore")
            .addQueryString("key" -> dataStoreKey)
            .getWithJsonResponse[TracingStoreInfo]
        } yield tracingStoreInfo.url
    )

  // The annotation source needed for every chunk request. 5 seconds gets updates to the user fast enough,
  // while still limiting the number of remote lookups during streaming
  private lazy val annotationSourceCache: AlfuCache[(String, Option[String]), AnnotationSource] =
    AlfuCache(timeToLive = 5 seconds, timeToIdle = 5 seconds)

  def getAnnotationSource(accessToken: String, userToken: Option[String]): Fox[AnnotationSource] =
    annotationSourceCache.getOrLoad(
      (accessToken, userToken),
      _ =>
        rpc(s"$webknossosUri/api/annotations/source/$accessToken")
          .addQueryString("key" -> dataStoreKey)
          .addQueryStringOptional("userToken", userToken)
          .getWithJsonResponse[AnnotationSource]
    )

  private lazy val credentialCache: AlfuCache[String, DataVaultCredential] =
    AlfuCache(timeToLive = 5 seconds, timeToIdle = 5 seconds)

  def getCredential(credentialId: String): Fox[DataVaultCredential] =
    credentialCache.getOrLoad(
      credentialId,
      _ =>
        rpc(s"$webknossosUri/api/datastores/$dataStoreName/findCredential")
          .addQueryString("credentialId" -> credentialId)
          .addQueryString("key" -> dataStoreKey)
          .silent
          .getWithJsonResponse[DataVaultCredential]
    )
}
