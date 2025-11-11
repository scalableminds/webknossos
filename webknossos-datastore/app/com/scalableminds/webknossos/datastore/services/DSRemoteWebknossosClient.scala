package com.scalableminds.webknossos.datastore.services

import org.apache.pekko.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.controllers.JobExportProperties
import com.scalableminds.webknossos.datastore.helpers.{IntervalScheduler, UPath}
import com.scalableminds.webknossos.datastore.models.UnfinishedUpload
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationSource
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, DataSourceId}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.uploading.{
  ReportDatasetUploadParameters,
  ReserveAdditionalInformation,
  ReserveUploadInformation
}
import com.scalableminds.webknossos.datastore.storage.DataVaultCredential
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{Json, OFormat}

import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

case class DataStoreStatus(ok: Boolean, url: String)
object DataStoreStatus {
  implicit val jsonFormat: OFormat[DataStoreStatus] = Json.format[DataStoreStatus]
}

case class TracingStoreInfo(name: String, url: String)
object TracingStoreInfo {
  implicit val jsonFormat: OFormat[TracingStoreInfo] = Json.format[TracingStoreInfo]
}

case class DataSourcePathInfo(dataSourceId: DataSourceId,
                              magPathInfos: Seq[RealPathInfo],
                              attachmentPathInfos: Seq[RealPathInfo]) {
  def nonEmpty: Boolean = magPathInfos.nonEmpty || attachmentPathInfos.nonEmpty
}

object DataSourcePathInfo {
  implicit val jsonFormat: OFormat[DataSourcePathInfo] = Json.format[DataSourcePathInfo]
}

case class RealPathInfo(path: UPath, realPath: UPath, hasLocalData: Boolean)

object RealPathInfo {
  implicit val jsonFormat: OFormat[RealPathInfo] = Json.format[RealPathInfo]
}

trait RemoteWebknossosClient {
  def requestUserAccess(accessRequest: UserAccessRequest)(implicit tc: TokenContext): Fox[UserAccessAnswer]
}

class DSRemoteWebknossosClient @Inject()(
    rpc: RPC,
    config: DataStoreConfig,
    val lifecycle: ApplicationLifecycle,
    @Named("webknossos-datastore") val actorSystem: ActorSystem
)(implicit val ec: ExecutionContext)
    extends RemoteWebknossosClient
    with IntervalScheduler
    with LazyLogging
    with FoxImplicits {

  private val dataStoreKey: String = config.Datastore.key
  private val dataStoreName: String = config.Datastore.name
  private val dataStoreUri: String = config.Http.uri

  private val webknossosUri: String = config.Datastore.WebKnossos.uri

  protected lazy val tickerInterval: FiniteDuration = config.Datastore.WebKnossos.pingInterval

  def tick(): Fox[Unit] = reportStatus().map(_ => ())

  private def reportStatus(): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/status")
      .addQueryParam("key", dataStoreKey)
      .patchJson(DataStoreStatus(ok = true, dataStoreUri))

  def reportDataSource(dataSource: DataSource): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasource")
      .addQueryParam("key", dataStoreKey)
      .putJson(dataSource)

  def getUnfinishedUploadsForUser(organizationName: String)(implicit tc: TokenContext): Fox[List[UnfinishedUpload]] =
    for {
      unfinishedUploads <- rpc(s"$webknossosUri/api/datastores/$dataStoreName/getUnfinishedUploadsForUser")
        .addQueryParam("key", dataStoreKey)
        .addQueryParam("organizationName", organizationName)
        .withTokenFromContext
        .getWithJsonResponse[List[UnfinishedUpload]]
    } yield unfinishedUploads

  def reportUpload(datasetId: ObjectId, parameters: ReportDatasetUploadParameters)(implicit tc: TokenContext): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/reportDatasetUpload")
      .addQueryParam("key", dataStoreKey)
      .addQueryParam("datasetId", datasetId)
      .withTokenFromContext
      .postJson[ReportDatasetUploadParameters](parameters)

  def reportDataSources(dataSources: List[DataSource], organizationId: Option[String]): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasources")
      .addQueryParam("key", dataStoreKey)
      .addQueryParam("organizationId", organizationId)
      .silent
      .putJson(dataSources)

  def reportRealPaths(dataSourcePaths: Seq[DataSourcePathInfo]): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasources/realpaths")
      .addQueryParam("key", dataStoreKey)
      .silent
      .putJson(dataSourcePaths)

  def reserveDataSourceUpload(info: ReserveUploadInformation)(
      implicit tc: TokenContext): Fox[ReserveAdditionalInformation] =
    for {
      reserveUploadInfo <- rpc(s"$webknossosUri/api/datastores/$dataStoreName/reserveUpload")
        .addQueryParam("key", dataStoreKey)
        .withTokenFromContext
        .postJsonWithJsonResponse[ReserveUploadInformation, ReserveAdditionalInformation](info)
    } yield reserveUploadInfo

  def updateDataSource(dataSource: DataSource, datasetId: ObjectId)(implicit tc: TokenContext): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasources/${datasetId.toString}")
      .addQueryParam("key", dataStoreKey)
      .withTokenFromContext
      .putJson(dataSource)

  def deleteDataset(datasetId: ObjectId): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/deleteDataset")
      .addQueryParam("key", dataStoreKey)
      .postJson(datasetId)

  def getJobExportProperties(jobId: String): Fox[JobExportProperties] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/jobExportProperties")
      .addQueryParam("jobId", jobId)
      .addQueryParam("key", dataStoreKey)
      .getWithJsonResponse[JobExportProperties]

  override def requestUserAccess(accessRequest: UserAccessRequest)(implicit tc: TokenContext): Fox[UserAccessAnswer] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/validateUserAccess")
      .addQueryParam("key", dataStoreKey)
      .withTokenFromContext
      .postJsonWithJsonResponse[UserAccessRequest, UserAccessAnswer](accessRequest)

  private lazy val tracingstoreUriCache: AlfuCache[String, String] = AlfuCache()
  def getTracingstoreUri: Fox[String] =
    tracingstoreUriCache.getOrLoad(
      "tracingStore",
      _ =>
        for {
          tracingStoreInfo <- rpc(s"$webknossosUri/api/tracingstore")
            .addQueryParam("key", dataStoreKey)
            .getWithJsonResponse[TracingStoreInfo]
        } yield tracingStoreInfo.url
    )

  // The annotation source needed for every chunk request. 5 seconds gets updates to the user fast enough,
  // while still limiting the number of remote lookups during streaming
  private lazy val annotationSourceCache: AlfuCache[(String, Option[String]), AnnotationSource] =
    AlfuCache(timeToLive = 5 seconds, timeToIdle = 5 seconds)

  def getAnnotationSource(accessToken: String)(implicit tc: TokenContext): Fox[AnnotationSource] =
    annotationSourceCache.getOrLoad(
      (accessToken, tc.userTokenOpt),
      _ =>
        rpc(s"$webknossosUri/api/annotations/source/$accessToken")
          .addQueryParam("key", dataStoreKey)
          .addQueryParam("userToken", tc.userTokenOpt)
          .getWithJsonResponse[AnnotationSource]
    )

  private lazy val credentialCache: AlfuCache[String, DataVaultCredential] =
    AlfuCache(timeToLive = 5 seconds, timeToIdle = 5 seconds)

  def getCredential(credentialId: String): Fox[DataVaultCredential] =
    credentialCache.getOrLoad(
      credentialId,
      _ =>
        rpc(s"$webknossosUri/api/datastores/$dataStoreName/findCredential")
          .addQueryParam("credentialId", credentialId)
          .addQueryParam("key", dataStoreKey)
          .silent
          .getWithJsonResponse[DataVaultCredential]
    )

  def getDataSource(datasetId: ObjectId): Fox[DataSource] =
    for {
      dataSource <- rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasources/$datasetId")
        .addQueryParam("key", dataStoreKey)
        .getWithJsonResponse[DataSource] ?~> "Failed to get data source from remote webknossos"
    } yield dataSource

  private lazy val datasetIdCache: AlfuCache[(String, String), ObjectId] =
    AlfuCache(timeToLive = 5 minutes, timeToIdle = 5 minutes)

  def getDatasetId(organizationId: String, datasetDirectoryName: String): Fox[ObjectId] =
    datasetIdCache.getOrLoad(
      (organizationId, datasetDirectoryName),
      _ =>
        rpc(s"$webknossosUri/api/datastores/$dataStoreName/findDatasetId")
          .addQueryParam("key", dataStoreKey)
          .addQueryParam("organizationId", organizationId)
          .addQueryParam("datasetDirectoryName", datasetDirectoryName)
          .getWithJsonResponse[ObjectId] ?~> "Failed to get dataset id from remote webknossos"
    )
}
