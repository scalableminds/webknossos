package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, DataSourceLike}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.{
  AccessTokenService,
  RemoteWebKnossosClient,
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

class TSRemoteWebKnossosClient @Inject()(
    rpc: RPC,
    config: TracingStoreConfig,
    val lifecycle: ApplicationLifecycle
) extends RemoteWebKnossosClient
    with LazyLogging {

  private val tracingStoreKey: String = config.Tracingstore.key
  private val tracingStoreName: String = config.Tracingstore.name

  private val webKnossosUri: String = config.Tracingstore.WebKnossos.uri

  private lazy val dataSourceIdByTracingIdCache: AlfuCache[String, DataSourceId] = AlfuCache()

  def reportTracingUpdates(tracingUpdatesReport: TracingUpdatesReport): Fox[WSResponse] =
    rpc(s"$webKnossosUri/api/tracingstores/$tracingStoreName/handleTracingUpdateReport")
      .addQueryString("key" -> tracingStoreKey)
      .silent
      .post(Json.toJson(tracingUpdatesReport))

  def getDataSourceForTracing(tracingId: String): Fox[DataSourceLike] =
    rpc(s"$webKnossosUri/api/tracingstores/$tracingStoreName/dataSource")
      .addQueryString("tracingId" -> tracingId)
      .addQueryString("key" -> tracingStoreKey)
      .getWithJsonResponse[DataSourceLike]

  def getDataStoreUriForDataSource(organizationName: String, datasetName: String): Fox[String] =
    rpc(s"$webKnossosUri/api/tracingstores/$tracingStoreName/dataStoreUri/$datasetName")
      .addQueryString("organizationName" -> organizationName)
      .addQueryString("key" -> tracingStoreKey)
      .silent
      .getWithJsonResponse[String]

  def getDataSourceIdForTracing(tracingId: String)(implicit ec: ExecutionContext): Fox[DataSourceId] =
    dataSourceIdByTracingIdCache.getOrLoad(
      tracingId,
      tracingId =>
        rpc(s"$webKnossosUri/api/tracingstores/$tracingStoreName/dataSourceId")
          .addQueryString("tracingId" -> tracingId)
          .addQueryString("key" -> tracingStoreKey)
          .getWithJsonResponse[DataSourceId]
    )

  override def requestUserAccess(token: Option[String], accessRequest: UserAccessRequest): Fox[UserAccessAnswer] =
    rpc(s"$webKnossosUri/api/tracingstores/$tracingStoreName/validateUserAccess")
      .addQueryString("key" -> tracingStoreKey)
      .addQueryStringOptional("token", token)
      .postJsonWithJsonResponse[UserAccessRequest, UserAccessAnswer](accessRequest)
}

class TracingStoreAccessTokenService @Inject()(val remoteWebKnossosClient: TSRemoteWebKnossosClient)
    extends AccessTokenService
