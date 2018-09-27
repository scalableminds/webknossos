package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.services.{AccessTokenService, UserAccessAnswer, UserAccessRequest, WkRpcClient}
import com.typesafe.scalalogging.LazyLogging
import play.api.cache.SyncCacheApi
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsObject, Json}


class TracingStoreWkRpcClient @Inject()(
                                  rpc: RPC,
                                  config: TracingStoreConfig,
                                  val lifecycle: ApplicationLifecycle
                                ) extends WkRpcClient with LazyLogging {

  private val dataStoreKey: String = config.Tracingstore.key
  private val dataStoreName: String = config.Tracingstore.name
  private val dataStoreUrl: String = config.Http.uri

  private val webKnossosUrl = {
    val url = config.Tracingstore.Oxalis.uri
    if (config.Tracingstore.Oxalis.secured)
      s"https://$url"
    else
      s"http://$url"
  }

  def reportTracingUpdates(tracingId: String, timestamps: List[Long], statistics: Option[JsObject], userToken: Option[String]): Fox[_] = {
    rpc(s"$webKnossosUrl/api/datastores/$dataStoreName/handleTracingUpdateReport")
      .addQueryString("key" -> dataStoreKey)
      .post(Json.obj("timestamps" -> timestamps, "statistics" -> statistics, "tracingId" -> tracingId, "userToken" -> userToken))
  }

  override def requestUserAccess(token: String, accessRequest: UserAccessRequest): Fox[UserAccessAnswer] = {
    rpc(s"$webKnossosUrl/api/datastores/$dataStoreName/validateUserAccess")
      .addQueryString("key" -> dataStoreKey)
      .addQueryString("token" -> token)
      .postWithJsonResponse[UserAccessRequest, UserAccessAnswer](accessRequest)
  }
}

class TracingStoreAccessTokenService @Inject()(val webKnossosServer: TracingStoreWkRpcClient, val cache: SyncCacheApi) extends AccessTokenService
