package com.scalableminds.webknossos.datastore.services

import org.apache.pekko.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.controllers.JobExportProperties
import com.scalableminds.webknossos.datastore.helpers.{IntervalScheduler, UPath}
import com.scalableminds.webknossos.datastore.models.UnfinishedUpload
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationSource
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, DataSourceId}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.uploading.{
  AttachmentUploadAdditionalInfo,
  AttachmentUploadInfo,
  DatasetUploadAdditionalInfo,
  DatasetUploadInfo,
  MagUploadAdditionalInfo,
  MagUploadInfo,
  ReportAttachmentUploadParameters,
  ReportDatasetUploadParameters,
  ReportMagUploadParameters
}
import com.scalableminds.webknossos.datastore.storage.DataVaultCredential
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{Json, OFormat}

import java.nio.file.Path
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

case class DataStoreStatus(ok: Boolean, url: String)
object DataStoreStatus {
  implicit val jsonFormat: OFormat[DataStoreStatus] = Json.format[DataStoreStatus]
}

case class DataSourceWithRootPathInfo(dataSource: DataSource, rootPath: Option[String], rootRealPath: Option[String])
object DataSourceWithRootPathInfo {
  implicit val jsonFormat: OFormat[DataSourceWithRootPathInfo] = Json.format[DataSourceWithRootPathInfo]
}

case class TracingStoreInfo(name: String, url: String)
object TracingStoreInfo {
  implicit val jsonFormat: OFormat[TracingStoreInfo] = Json.format[TracingStoreInfo]
}

case class DataSourcePathInfo(
    dataSourceId: DataSourceId,
    magPathInfos: Seq[RealPathInfo],
    attachmentPathInfos: Seq[RealPathInfo]
) {
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
  def requestUserAccess(accessRequest: UserAccessRequest)(using tc: TokenContext): Fox[UserAccessAnswer]
}

class DSRemoteWebknossosClient @Inject() (
    rpc: RPC,
    config: DataStoreConfig,
    val lifecycle: ApplicationLifecycle,
    @Named("webknossos-datastore") val actorSystem: ActorSystem
)(implicit val ec: ExecutionContext)
    extends RemoteWebknossosClient
    with IntervalScheduler
    with LazyLogging {

  private val dataStoreKey: String = config.Datastore.key
  private val dataStoreName: String = config.Datastore.name
  private val dataStoreUri: String = config.Http.uri

  private val webknossosUri: String = config.Datastore.WebKnossos.uri

  protected lazy val tickerInterval: FiniteDuration = config.Datastore.WebKnossos.pingInterval

  def tick(): Fox[Unit] = reportStatus().map(_ => ())

  private def reportStatus(): Fox[?] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/status")
      .addQueryParam("key", dataStoreKey)
      .patchJson(DataStoreStatus(ok = true, dataStoreUri))

  // Only used for legacy refresh
  def reportDataSource(dataSource: DataSource): Fox[?] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasource")
      .addQueryParam("key", dataStoreKey)
      .putJson(dataSource)

  def getUnfinishedUploadsForUser(organizationName: String)(using tc: TokenContext): Fox[List[UnfinishedUpload]] =
    for {
      unfinishedUploads <- rpc(s"$webknossosUri/api/datastores/$dataStoreName/getUnfinishedDatasetUploadsForUser")
        .addQueryParam("key", dataStoreKey)
        .addQueryParam("organizationName", organizationName)
        .withTokenFromContext
        .getWithJsonResponse[List[UnfinishedUpload]]
    } yield unfinishedUploads

  def reportDatasetUpload(datasetId: ObjectId, parameters: ReportDatasetUploadParameters)(using
      tc: TokenContext
  ): Fox[?] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/reportDatasetUpload")
      .addQueryParam("key", dataStoreKey)
      .addQueryParam("datasetId", datasetId)
      .withTokenFromContext
      .postJson[ReportDatasetUploadParameters](parameters)

  def reportMagUpload(parameters: ReportMagUploadParameters): Fox[?] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/reportMagUpload")
      .addQueryParam("key", dataStoreKey)
      .postJson[ReportMagUploadParameters](parameters)

  def reportAttachmentUpload(parameters: ReportAttachmentUploadParameters): Fox[?] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/reportAttachmentUpload")
      .addQueryParam("key", dataStoreKey)
      .postJson[ReportAttachmentUploadParameters](parameters)

  def reportDataSources(
      dataSourcesWithPathInfo: Seq[DataSourceWithRootPathInfo],
      organizationId: Option[String]
  ): Fox[?] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasources")
      .addQueryParam("key", dataStoreKey)
      .addQueryParam("organizationId", organizationId)
      .silent
      .putJson(dataSourcesWithPathInfo)

  def reportRealPaths(dataSourcePaths: Seq[DataSourcePathInfo]): Fox[?] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasources/realpaths")
      .addQueryParam("key", dataStoreKey)
      .silent
      .putJson(dataSourcePaths)

  def reserveDatasetUpload(info: DatasetUploadInfo)(using tc: TokenContext): Fox[DatasetUploadAdditionalInfo] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/reserveDatasetUpload")
      .addQueryParam("key", dataStoreKey)
      .withTokenFromContext
      .postJsonWithJsonResponse[DatasetUploadInfo, DatasetUploadAdditionalInfo](info)

  def reserveMagUpload(info: MagUploadInfo)(using tc: TokenContext): Fox[MagUploadAdditionalInfo] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/reserveMagUpload")
      .addQueryParam("key", dataStoreKey)
      .withTokenFromContext
      .postJsonWithJsonResponse[MagUploadInfo, MagUploadAdditionalInfo](info)

  def reserveAttachmentUpload(
      info: AttachmentUploadInfo
  )(using tc: TokenContext): Fox[AttachmentUploadAdditionalInfo] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/reserveAttachmentUpload")
      .addQueryParam("key", dataStoreKey)
      .withTokenFromContext
      .postJsonWithJsonResponse[AttachmentUploadInfo, AttachmentUploadAdditionalInfo](info)

  def updateDataSource(dataSource: DataSource, datasetId: ObjectId)(using tc: TokenContext): Fox[?] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasources/${datasetId.toString}")
      .addQueryParam("key", dataStoreKey)
      .withTokenFromContext
      .putJson(dataSource)

  def deleteDataset(datasetId: ObjectId): Fox[?] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/deleteDataset")
      .addQueryParam("key", dataStoreKey)
      .postJson(datasetId)

  def getJobExportProperties(jobId: ObjectId): Fox[JobExportProperties] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/jobExportProperties")
      .addQueryParam("jobId", jobId)
      .addQueryParam("key", dataStoreKey)
      .getWithJsonResponse[JobExportProperties]

  override def requestUserAccess(accessRequest: UserAccessRequest)(using tc: TokenContext): Fox[UserAccessAnswer] =
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

  def getAnnotationSource(accessToken: String)(using tc: TokenContext): Fox[AnnotationSource] =
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

  def getLocalRootPathOrEmpty(datasetId: ObjectId): Fox[Path] =
    for {
      rootPathStr <- rpc(s"$webknossosUri/api/datastores/$dataStoreName/findDatasetLocalRootPath")
        .addQueryParam("key", dataStoreKey)
        .addQueryParam("datasetId", datasetId)
        .getWithJsonResponse[String] ?~> "Failed to get data source root path remote webknossos"
      rootPath <- if (rootPathStr.isEmpty) Fox.empty else Fox.successful(Path.of(rootPathStr))
    } yield rootPath
}
