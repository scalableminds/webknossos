package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayerType
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceLike
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

case class AnnotationUpdatesReport(annotationId: ObjectId,
                                   timestamps: List[Instant],
                                   statistics: Option[JsObject],
                                   significantChangesCount: Int,
                                   viewChangesCount: Int,
                                   userToken: Option[String])
object AnnotationUpdatesReport {
  implicit val jsonFormat: OFormat[AnnotationUpdatesReport] = Json.format[AnnotationUpdatesReport]
}

class TSRemoteWebknossosClient @Inject()(
    rpc: RPC,
    config: TracingStoreConfig,
    val lifecycle: ApplicationLifecycle
) extends RemoteWebknossosClient
    with LazyLogging {

  private val tracingStoreKey: String = config.Tracingstore.key
  private val tracingStoreName: String = config.Tracingstore.name

  private val webknossosUri: String = config.Tracingstore.WebKnossos.uri

  private lazy val datasetIdByAnnotationIdCache: AlfuCache[ObjectId, ObjectId] = AlfuCache()
  private lazy val annotationIdByTracingIdCache: AlfuCache[String, ObjectId] =
    AlfuCache(maxCapacity = 10000, timeToLive = 5 minutes)

  def reportAnnotationUpdates(tracingUpdatesReport: AnnotationUpdatesReport): Fox[WSResponse] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/handleTracingUpdateReport")
      .addQueryString("key" -> tracingStoreKey)
      .silent
      .postJson(Json.toJson(tracingUpdatesReport))

  def getDataSourceForAnnotation(annotationId: ObjectId)(implicit tc: TokenContext): Fox[DataSourceLike] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/dataSource")
      .addQueryString("annotationId" -> annotationId.toString)
      .addQueryString("key" -> tracingStoreKey)
      .withTokenFromContext
      .silent
      .getWithJsonResponse[DataSourceLike]

  def getDataStoreUriForDataset(datasetId: ObjectId): Fox[String] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/dataStoreUri/$datasetId")
      .addQueryString("key" -> tracingStoreKey)
      .silent
      .getWithJsonResponse[String]

  def getDatasetIdForAnnotation(annotationId: ObjectId)(implicit ec: ExecutionContext): Fox[ObjectId] =
    datasetIdByAnnotationIdCache.getOrLoad(
      annotationId,
      aId =>
        rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/datasetId")
          .addQueryString("annotationId" -> aId.toString)
          .addQueryString("key" -> tracingStoreKey)
          .silent
          .getWithJsonResponse[ObjectId]
    )

  def getAnnotationIdForTracing(tracingId: String)(implicit ec: ExecutionContext): Fox[ObjectId] =
    annotationIdByTracingIdCache.getOrLoad(
      tracingId,
      tracingId =>
        rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/annotationId")
          .addQueryString("tracingId" -> tracingId)
          .addQueryString("key" -> tracingStoreKey)
          .silent
          .getWithJsonResponse[ObjectId]
    ) ?~> "annotation.idForTracing.failed"

  def updateAnnotation(annotationId: ObjectId, annotationProto: AnnotationProto): Fox[Unit] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/updateAnnotation")
      .addQueryString("annotationId" -> annotationId.toString)
      .addQueryString("key" -> tracingStoreKey)
      .silent
      .postProto(annotationProto)

  def createTracingFor(annotationId: ObjectId,
                       layerParameters: AnnotationLayerParameters,
                       previousVersion: Long): Fox[Either[SkeletonTracingWithUpdatedTreeIds, VolumeTracing]] = {
    val req = rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/createTracing")
      .addQueryString("annotationId" -> annotationId.toString)
      .addQueryString("previousVersion" -> previousVersion.toString) // used for fetching old precedence layers
      .addQueryString("key" -> tracingStoreKey)
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

  override def requestUserAccess(accessRequest: UserAccessRequest)(implicit tc: TokenContext): Fox[UserAccessAnswer] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/validateUserAccess")
      .addQueryString("key" -> tracingStoreKey)
      .withTokenFromContext
      .postJsonWithJsonResponse[UserAccessRequest, UserAccessAnswer](accessRequest)
}

class TracingStoreAccessTokenService @Inject()(val remoteWebknossosClient: TSRemoteWebknossosClient)
    extends AccessTokenService
