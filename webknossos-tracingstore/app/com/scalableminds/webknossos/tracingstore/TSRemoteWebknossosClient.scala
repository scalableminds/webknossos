package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayerType
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, UsableDataSource}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.{
  AccessTokenService,
  RemoteWebknossosClient,
  UserAccessAnswer,
  UserAccessRequest
}
import com.scalableminds.webknossos.tracingstore.annotation.AnnotationLayerParameters
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.SkeletonTracingWithUpdatedTreeIds
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsObject, Json, OFormat}
import play.api.libs.ws.WSResponse

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

case class AnnotationUpdateReport(annotationId: ObjectId,
                                  timestamps: List[Instant],
                                  statistics: Option[JsObject],
                                  significantChangesCount: Int,
                                  viewChangesCount: Int,
                                  userToken: Option[String])
object AnnotationUpdateReport {
  implicit val jsonFormat: OFormat[AnnotationUpdateReport] = Json.format[AnnotationUpdateReport]
}

case class CachedAnnotationLayerProperties(hasEditableMapping: Boolean = false,
                                           fallbackLayerName: Option[String] = None,
                                           mappingName: Option[String] = None)

object CachedAnnotationLayerProperties {
  implicit val jsonFormat: OFormat[CachedAnnotationLayerProperties] = Json.format[CachedAnnotationLayerProperties]
}

class TSRemoteWebknossosClient @Inject()(
    rpc: RPC,
    config: TracingStoreConfig,
    val lifecycle: ApplicationLifecycle
) extends RemoteWebknossosClient
    with FoxImplicits
    with LazyLogging {

  private val tracingStoreKey: String = config.Tracingstore.key
  private val tracingStoreName: String = config.Tracingstore.name

  private val webknossosUri: String = config.Tracingstore.WebKnossos.uri

  private lazy val datasetIdByAnnotationIdCache: AlfuCache[ObjectId, ObjectId] = AlfuCache()
  private lazy val annotationIdByTracingIdCache: AlfuCache[String, ObjectId] =
    AlfuCache(maxCapacity = 10000, timeToLive = 5 minutes)
  private lazy val voxelSizeCache: AlfuCache[ObjectId, VoxelSize] = AlfuCache(timeToLive = 10 minutes)

  def reportAnnotationUpdates(tracingUpdatesReport: AnnotationUpdateReport): Fox[WSResponse] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/handleAnnotationUpdateReport")
      .addQueryParam("key", tracingStoreKey)
      .silent
      .postJson(Json.toJson(tracingUpdatesReport))

  def getDataSourceForAnnotation(annotationId: ObjectId)(implicit tc: TokenContext): Fox[UsableDataSource] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/dataSource")
      .addQueryParam("annotationId", annotationId)
      .addQueryParam("key", tracingStoreKey)
      .withTokenFromContext
      .silent
      .getWithJsonResponse[UsableDataSource]

  def getDataStoreUriForDataset(datasetId: ObjectId): Fox[String] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/dataStoreUri/$datasetId")
      .addQueryParam("key", tracingStoreKey)
      .silent
      .getWithJsonResponse[String]

  def getDatasetIdForAnnotation(annotationId: ObjectId)(implicit ec: ExecutionContext): Fox[ObjectId] =
    datasetIdByAnnotationIdCache.getOrLoad(
      annotationId,
      aId =>
        rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/datasetId")
          .addQueryParam("annotationId", aId)
          .addQueryParam("key", tracingStoreKey)
          .silent
          .getWithJsonResponse[ObjectId]
    )

  def getAnnotationIdForTracing(tracingId: String)(implicit ec: ExecutionContext): Fox[ObjectId] =
    annotationIdByTracingIdCache.getOrLoad(
      tracingId,
      tracingId =>
        rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/annotationId")
          .addQueryParam("tracingId", tracingId)
          .addQueryParam("key", tracingStoreKey)
          .silent
          .getWithJsonResponse[ObjectId]
    ) ?~> "annotation.idForTracing.failed"

  def updateAnnotation(annotationId: ObjectId, annotationProto: AnnotationProto): Fox[Unit] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/updateAnnotation")
      .addQueryParam("annotationId", annotationId)
      .addQueryParam("key", tracingStoreKey)
      .silent
      .postProto(annotationProto)

  def updateCachedAnnotationLayerProperties(
      annotationId: ObjectId,
      cachedAnnotationLayerProperties: Map[String, CachedAnnotationLayerProperties]): Fox[_] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/updateCachedAnnotationLayerProperties")
      .addQueryParam("annotationId", annotationId)
      .addQueryParam("key", tracingStoreKey)
      .silent
      .postJson(cachedAnnotationLayerProperties)

  def createTracingFor(annotationId: ObjectId,
                       layerParameters: AnnotationLayerParameters,
                       previousVersion: Long): Fox[Either[SkeletonTracingWithUpdatedTreeIds, VolumeTracing]] = {
    val req = rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/createTracing")
      .addQueryParam("annotationId", annotationId)
      .addQueryParam("previousVersion", previousVersion) // used for fetching old precedence layers
      .addQueryParam("key", tracingStoreKey)
    layerParameters.typ match {
      case AnnotationLayerType.Volume =>
        req
          .postJsonWithProtoResponse[AnnotationLayerParameters, VolumeTracing](layerParameters)(VolumeTracing)
          .map(Right(_))
      case AnnotationLayerType.Skeleton =>
        for {
          skeletonTracing <- req.postJsonWithProtoResponse[AnnotationLayerParameters, SkeletonTracing](layerParameters)(
            SkeletonTracing)
        } yield
          Left[SkeletonTracingWithUpdatedTreeIds, VolumeTracing](
            SkeletonTracingWithUpdatedTreeIds(skeletonTracing, Set.empty))
    }
  }

  def voxelSizeForAnnotationWithCache(annotationId: ObjectId)(implicit tc: TokenContext,
                                                              ec: ExecutionContext): Fox[VoxelSize] =
    voxelSizeCache.getOrLoad(annotationId, aId => voxelSizeForAnnotation(aId))

  private def voxelSizeForAnnotation(annotationId: ObjectId)(implicit tc: TokenContext,
                                                             ec: ExecutionContext): Fox[VoxelSize] =
    for {
      datasetId <- getDatasetIdForAnnotation(annotationId)
      result <- rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/datasources/$datasetId")
        .addQueryParam("key", tracingStoreKey)
        .withTokenFromContext
        .silent
        .getWithJsonResponse[DataSource]
      scale <- result.voxelSizeOpt.toFox ?~> "Could not determine voxel size of dataset"
    } yield scale

  override def requestUserAccess(accessRequest: UserAccessRequest)(implicit tc: TokenContext): Fox[UserAccessAnswer] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/validateUserAccess")
      .addQueryParam("key", tracingStoreKey)
      .withTokenFromContext
      .postJsonWithJsonResponse[UserAccessRequest, UserAccessAnswer](accessRequest)
}

class TracingStoreAccessTokenService @Inject()(val remoteWebknossosClient: TSRemoteWebknossosClient)
    extends AccessTokenService
