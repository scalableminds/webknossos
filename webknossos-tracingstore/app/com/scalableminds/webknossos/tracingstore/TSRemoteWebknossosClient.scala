package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, DataSourceLike}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.{
  AccessTokenService,
  RemoteWebknossosClient,
  UserAccessAnswer,
  UserAccessRequest
}
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsObject, Json, OFormat}
import play.api.libs.ws.WSResponse

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

case class TracingUpdatesReport(annotationId: String,
                                // TODO stats per tracing id?
                                timestamps: List[Instant],
                                statistics: Option[JsObject],
                                significantChangesCount: Int,
                                viewChangesCount: Int,
                                userToken: Option[String])
object TracingUpdatesReport {
  implicit val jsonFormat: OFormat[TracingUpdatesReport] = Json.format[TracingUpdatesReport]
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

  private lazy val dataSourceIdByTracingIdCache: AlfuCache[String, DataSourceId] = AlfuCache()
  private lazy val annotationIdByTracingIdCache: AlfuCache[String, String] = AlfuCache(timeToLive = 5 minutes)

  def reportTracingUpdates(tracingUpdatesReport: TracingUpdatesReport): Fox[WSResponse] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/handleTracingUpdateReport")
      .addQueryString("key" -> tracingStoreKey)
      .silent
      .post(Json.toJson(tracingUpdatesReport))

  def getDataSourceForTracing(tracingId: String): Fox[DataSourceLike] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/dataSource")
      .addQueryString("tracingId" -> tracingId)
      .addQueryString("key" -> tracingStoreKey)
      .getWithJsonResponse[DataSourceLike]

  def getDataStoreUriForDataSource(organizationId: String, datasetName: String): Fox[String] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/dataStoreUri/$datasetName")
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
          .getWithJsonResponse[DataSourceId]
    )

  // TODO what about temporary/compound tracings?
  def getAnnotationIdForTracing(tracingId: String)(implicit ec: ExecutionContext): Fox[String] =
    annotationIdByTracingIdCache.getOrLoad(
      tracingId,
      tracingId =>
        rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/annotationId")
          .addQueryString("tracingId" -> tracingId)
          .addQueryString("key" -> tracingStoreKey)
          .getWithJsonResponse[String]
    )

  override def requestUserAccess(accessRequest: UserAccessRequest)(implicit tc: TokenContext): Fox[UserAccessAnswer] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/validateUserAccess")
      .addQueryString("key" -> tracingStoreKey)
      .withTokenFromContext
      .postJsonWithJsonResponse[UserAccessRequest, UserAccessAnswer](accessRequest)
}

class TracingStoreAccessTokenService @Inject()(val remoteWebknossosClient: TSRemoteWebknossosClient)
    extends AccessTokenService
