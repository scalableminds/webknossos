package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayerType
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, DataSourceLike}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.{
  AccessTokenService,
  RemoteWebknossosClient,
  UserAccessAnswer,
  UserAccessRequest
}
import com.scalableminds.webknossos.tracingstore.annotation.AnnotationLayerParameters
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsObject, Json, OFormat}
import play.api.libs.ws.WSResponse

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

case class AnnotationUpdatesReport(
    annotationId: String,
    timestamps: List[Instant],
    statistics: Option[JsObject],
    significantChangesCount: Int,
    viewChangesCount: Int,
    userToken: Option[String]
)
object AnnotationUpdatesReport {
  implicit val jsonFormat: OFormat[AnnotationUpdatesReport] = Json.format[AnnotationUpdatesReport]
}

class TSRemoteWebknossosClient @Inject() (
    rpc: RPC,
    config: TracingStoreConfig,
    val lifecycle: ApplicationLifecycle
) extends RemoteWebknossosClient
    with LazyLogging {

  private val tracingStoreKey: String = config.Tracingstore.key
  private val tracingStoreName: String = config.Tracingstore.name

  private val webknossosUri: String = config.Tracingstore.WebKnossos.uri

  private lazy val dataSourceIdByTracingIdCache: AlfuCache[String, DataSourceId] = AlfuCache()
  private lazy val annotationIdByTracingIdCache: AlfuCache[String, String] =
    AlfuCache(maxCapacity = 10000, timeToLive = 5 minutes)

  def reportAnnotationUpdates(tracingUpdatesReport: AnnotationUpdatesReport): Fox[WSResponse] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/handleTracingUpdateReport")
      .addQueryString("key" -> tracingStoreKey)
      .silent
      .postJson(Json.toJson(tracingUpdatesReport))

  def getDataSourceForTracing(tracingId: String)(implicit tc: TokenContext): Fox[DataSourceLike] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/dataSource")
      .addQueryString("tracingId" -> tracingId)
      .addQueryString("key" -> tracingStoreKey)
      .withTokenFromContext
      .silent
      .getWithJsonResponse[DataSourceLike]

  def getDataStoreUriForDataSource(organizationId: String, datasetDirectoryName: String): Fox[String] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/dataStoreUri/$datasetDirectoryName")
      .addQueryString("organizationId" -> organizationId)
      .addQueryString("key" -> tracingStoreKey)
      .silent
      .getWithJsonResponse[String]

  def getDataSourceIdForTracing(tracingId: String)(implicit ec: ExecutionContext): Fox[DataSourceId] =
    dataSourceIdByTracingIdCache.getOrLoad(
      tracingId,
      tracingId =>
        rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/dataSourceId")
          .addQueryString("tracingId" -> tracingId)
          .addQueryString("key" -> tracingStoreKey)
          .silent
          .getWithJsonResponse[DataSourceId]
    )

  def getAnnotationIdForTracing(tracingId: String)(implicit ec: ExecutionContext): Fox[String] =
    annotationIdByTracingIdCache.getOrLoad(
      tracingId,
      tracingId =>
        rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/annotationId")
          .addQueryString("tracingId" -> tracingId)
          .addQueryString("key" -> tracingStoreKey)
          .silent
          .getWithJsonResponse[String]
    ) ?~> "annotation.idForTracing.failed"

  def updateAnnotation(annotationId: String, annotationProto: AnnotationProto): Fox[Unit] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/updateAnnotation")
      .addQueryString("annotationId" -> annotationId)
      .addQueryString("key" -> tracingStoreKey)
      .silent
      .postProto(annotationProto)

  def createTracingFor(
      annotationId: String,
      layerParameters: AnnotationLayerParameters,
      previousVersion: Long
  ): Fox[Either[SkeletonTracing, VolumeTracing]] = {
    val req = rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/createTracing")
      .addQueryString("annotationId" -> annotationId)
      .addQueryString("previousVersion" -> previousVersion.toString) // used for fetching old precedence layers
      .addQueryString("key" -> tracingStoreKey)
    layerParameters.typ match {
      case AnnotationLayerType.Volume =>
        req
          .postJsonWithProtoResponse[AnnotationLayerParameters, VolumeTracing](layerParameters)(VolumeTracing)
          .map(Right(_))
      case AnnotationLayerType.Skeleton =>
        req
          .postJsonWithProtoResponse[AnnotationLayerParameters, SkeletonTracing](layerParameters)(SkeletonTracing)
          .map(Left(_))
    }
  }

  override def requestUserAccess(accessRequest: UserAccessRequest)(implicit tc: TokenContext): Fox[UserAccessAnswer] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/validateUserAccess")
      .addQueryString("key" -> tracingStoreKey)
      .withTokenFromContext
      .postJsonWithJsonResponse[UserAccessRequest, UserAccessAnswer](accessRequest)
}

class TracingStoreAccessTokenService @Inject() (val remoteWebknossosClient: TSRemoteWebknossosClient)
    extends AccessTokenService
