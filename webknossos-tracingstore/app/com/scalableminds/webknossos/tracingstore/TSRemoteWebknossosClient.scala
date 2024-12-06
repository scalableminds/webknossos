package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
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

case class TracingUpdatesReport(tracingId: String,
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
          .getWithJsonResponse[DataSourceId]
    )

  override def requestUserAccess(token: Option[String], accessRequest: UserAccessRequest): Fox[UserAccessAnswer] =
    rpc(s"$webknossosUri/api/tracingstores/$tracingStoreName/validateUserAccess")
      .addQueryString("key" -> tracingStoreKey)
      .addQueryStringOptional("token", token)
      .postJsonWithJsonResponse[UserAccessRequest, UserAccessAnswer](accessRequest)
}

class TracingStoreAccessTokenService @Inject()(val remoteWebknossosClient: TSRemoteWebknossosClient)
    extends AccessTokenService
