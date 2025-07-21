package com.scalableminds.webknossos.datastore.services

import org.apache.pekko.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.controllers.JobExportProperties
import com.scalableminds.webknossos.datastore.helpers.{IntervalScheduler, LayerMagLinkInfo}
import com.scalableminds.webknossos.datastore.models.UnfinishedUpload
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationSource
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, DataSourceId, GenericDataSource}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.InboxDataSourceLike
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.uploading.{
  ReserveAdditionalInformation,
  ReserveUploadInformation
}
import com.scalableminds.webknossos.datastore.storage.DataVaultCredential
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsValue, Json, OFormat}

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

case class DataSourcePathInfo(dataSourceId: DataSourceId, magPathInfos: List[MagPathInfo])

object DataSourcePathInfo {
  implicit val jsonFormat: OFormat[DataSourcePathInfo] = Json.format[DataSourcePathInfo]
}

case class MagPathInfo(layerName: String, mag: Vec3Int, path: String, realPath: String, hasLocalData: Boolean)

object MagPathInfo {
  implicit val jsonFormat: OFormat[MagPathInfo] = Json.format[MagPathInfo]
}

case class DataSourceRegistrationInfo(dataSource: DataSource, folderId: Option[String])

object DataSourceRegistrationInfo {
  implicit val jsonFormat: OFormat[DataSourceRegistrationInfo] = Json.format[DataSourceRegistrationInfo]
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
  private val reportUsedStorageEnabled: Boolean = config.Datastore.ReportUsedStorage.enabled

  private val webknossosUri: String = config.Datastore.WebKnossos.uri

  protected lazy val tickerInterval: FiniteDuration = config.Datastore.WebKnossos.pingInterval

  def tick(): Fox[Unit] = reportStatus().map(_ => ())

  private def reportStatus(): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/status")
      .addQueryString("key" -> dataStoreKey)
      .patchJson(DataStoreStatus(ok = true, dataStoreUri, Some(reportUsedStorageEnabled)))

  def reportDataSource(dataSource: InboxDataSourceLike): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasource")
      .addQueryString("key" -> dataStoreKey)
      .putJson(dataSource)

  def getUnfinishedUploadsForUser(organizationName: String)(implicit tc: TokenContext): Fox[List[UnfinishedUpload]] =
    for {
      unfinishedUploads <- rpc(s"$webknossosUri/api/datastores/$dataStoreName/getUnfinishedUploadsForUser")
        .addQueryString("key" -> dataStoreKey)
        .addQueryString("organizationName" -> organizationName)
        .withTokenFromContext
        .getWithJsonResponse[List[UnfinishedUpload]]
    } yield unfinishedUploads

  def reportUpload(dataSourceId: DataSourceId, datasetSizeBytes: Long, needsConversion: Boolean, viaAddRoute: Boolean)(
      implicit tc: TokenContext): Fox[String] =
    for {
      uploadedDatasetIdJson <- rpc(s"$webknossosUri/api/datastores/$dataStoreName/reportDatasetUpload")
        .addQueryString("key" -> dataStoreKey)
        .addQueryString("datasetDirectoryName" -> dataSourceId.directoryName)
        .addQueryString("needsConversion" -> needsConversion.toString)
        .addQueryString("viaAddRoute" -> viaAddRoute.toString)
        .addQueryString("datasetSizeBytes" -> datasetSizeBytes.toString)
        .withTokenFromContext
        .postEmptyWithJsonResponse[JsValue]()
      uploadedDatasetId <- JsonHelper.as[String](uploadedDatasetIdJson \ "id").toFox ?~> "uploadedDatasetId.invalid"
    } yield uploadedDatasetId

  def reportDataSources(dataSources: List[InboxDataSourceLike]): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasources")
      .addQueryString("key" -> dataStoreKey)
      .silent
      .putJson(dataSources)

  def reportRealPaths(dataSourcePaths: List[DataSourcePathInfo]): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasources/paths")
      .addQueryString("key" -> dataStoreKey)
      .silent
      .putJson(dataSourcePaths)

  def fetchPaths(datasetId: ObjectId): Fox[List[LayerMagLinkInfo]] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasources/${datasetId}/paths")
      .addQueryString("key" -> dataStoreKey)
      .getWithJsonResponse[List[LayerMagLinkInfo]]

  def reserveDataSourceUpload(info: ReserveUploadInformation)(
      implicit tc: TokenContext): Fox[ReserveAdditionalInformation] =
    for {
      reserveUploadInfo <- rpc(s"$webknossosUri/api/datastores/$dataStoreName/reserveUpload")
        .addQueryString("key" -> dataStoreKey)
        .withTokenFromContext
        .postJsonWithJsonResponse[ReserveUploadInformation, ReserveAdditionalInformation](info)
    } yield reserveUploadInfo

  def registerDataSource(dataSource: DataSource, dataSourceId: DataSourceId, folderId: Option[String])(
      implicit tc: TokenContext): Fox[String] =
    for {
      _ <- Fox.successful(())
      info = DataSourceRegistrationInfo(dataSource, folderId)
      response <- rpc(
        s"$webknossosUri/api/datastores/$dataStoreName/datasources/${dataSourceId.organizationId}/${dataSourceId.directoryName}")
        .addQueryString("key" -> dataStoreKey)
        .withTokenFromContext
        .postJson[DataSourceRegistrationInfo](info)
      datasetId = response.body
    } yield datasetId

  def updateDataSource(dataSource: DataSource, datasetId: ObjectId)(implicit tc: TokenContext): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasources/${datasetId.toString}")
      .addQueryString("key" -> dataStoreKey)
      .withTokenFromContext
      .putJson(dataSource)

  def deleteDataSource(id: DataSourceId): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/deleteDataset")
      .addQueryString("key" -> dataStoreKey)
      .postJson(id)

  def deleteVirtualDataset(id: ObjectId): Fox[_] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/deleteVirtualDataset")
      .addQueryString("key" -> dataStoreKey)
      .postJson(id)

  def getJobExportProperties(jobId: String): Fox[JobExportProperties] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/jobExportProperties")
      .addQueryString("jobId" -> jobId)
      .addQueryString("key" -> dataStoreKey)
      .getWithJsonResponse[JobExportProperties]

  override def requestUserAccess(accessRequest: UserAccessRequest)(implicit tc: TokenContext): Fox[UserAccessAnswer] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/validateUserAccess")
      .addQueryString("key" -> dataStoreKey)
      .withTokenFromContext
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

  def getAnnotationSource(accessToken: String)(implicit tc: TokenContext): Fox[AnnotationSource] =
    annotationSourceCache.getOrLoad(
      (accessToken, tc.userTokenOpt),
      _ =>
        rpc(s"$webknossosUri/api/annotations/source/$accessToken")
          .addQueryString("key" -> dataStoreKey)
          .addQueryStringOptional("userToken", tc.userTokenOpt)
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

  def getDataset(datasetId: String): Fox[GenericDataSource[DataLayer]] =
    rpc(s"$webknossosUri/api/datastores/$dataStoreName/datasources/$datasetId")
      .addQueryString("key" -> dataStoreKey)
      .getWithJsonResponse[GenericDataSource[DataLayer]] ?~> "Failed to get data source from remote webknossos"
}
