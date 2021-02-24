package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceLike
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.{
  AccessTokenService,
  UserAccessAnswer,
  UserAccessRequest,
  WkRpcClient
}
import com.typesafe.scalalogging.LazyLogging
import play.api.cache.SyncCacheApi
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsObject, Json}
import play.api.libs.ws.WSResponse

class TracingStoreWkRpcClient @Inject()(
    rpc: RPC,
    config: TracingStoreConfig,
    val lifecycle: ApplicationLifecycle
) extends WkRpcClient
    with LazyLogging {

  private val tracingStoreKey: String = config.Tracingstore.key
  private val tracingStoreName: String = config.Tracingstore.name

  private val webKnossosUrl: String = config.Tracingstore.WebKnossos.uri

  def reportTracingUpdates(tracingId: String,
                           timestamps: List[Long],
                           statistics: Option[JsObject],
                           userToken: Option[String]): Fox[WSResponse] =
    rpc(s"$webKnossosUrl/api/tracingstores/$tracingStoreName/handleTracingUpdateReport")
      .addQueryString("key" -> tracingStoreKey)
      .post(
        Json.obj("timestamps" -> timestamps,
                 "statistics" -> statistics,
                 "tracingId" -> tracingId,
                 "userToken" -> userToken))

  def reportIsosurfaceRequest(userToken: Option[String]): Fox[WSResponse] =
    rpc(s"$webKnossosUrl/api/tracingstores/$tracingStoreName/reportIsosurfaceRequest")
      .addQueryString("key" -> tracingStoreKey)
      .addQueryStringOptional("token", userToken)
      .post()

  def getDataSource(organizationNameOpt: Option[String], dataSetName: String): Fox[DataSourceLike] =
    rpc(s"$webKnossosUrl/api/tracingstores/$tracingStoreName/dataSource/$dataSetName")
      .addQueryStringOptional("organizationName", organizationNameOpt)
      .addQueryString("key" -> tracingStoreKey)
      .getWithJsonResponse[DataSourceLike]

  override def requestUserAccess(token: Option[String], accessRequest: UserAccessRequest): Fox[UserAccessAnswer] =
    rpc(s"$webKnossosUrl/api/tracingstores/$tracingStoreName/validateUserAccess")
      .addQueryString("key" -> tracingStoreKey)
      .addQueryStringOptional("token", token)
      .postWithJsonResponse[UserAccessRequest, UserAccessAnswer](accessRequest)
}

class TracingStoreAccessTokenService @Inject()(val webKnossosServer: TracingStoreWkRpcClient, val cache: SyncCacheApi)
    extends AccessTokenService
