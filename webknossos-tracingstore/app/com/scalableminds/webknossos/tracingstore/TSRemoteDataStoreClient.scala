package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.{RemoteWebKnossosClient, UserAccessAnswer, UserAccessRequest}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.util.Helpers.urlEncode
import play.api.inject.ApplicationLifecycle
import play.api.libs.ws.WSResponse

class TSRemoteDataStoreClient @Inject()(
    rpc: RPC,
    config: TracingStoreConfig,
    val lifecycle: ApplicationLifecycle
) extends RemoteWebKnossosClient
    with LazyLogging {

  private val tracingStoreKey: String = config.Tracingstore.key
  private val tracingStoreName: String = config.Tracingstore.name

  private val webKnossosUrl: String = config.Tracingstore.WebKnossos.uri

  def fallbackLayerBucket(dataStoreURI: String,
                          organizationName: String,
                          dataSetName: String,
                          dataLayerName: String,
                          mag: String,
                          cxyz: String,
                          urlToken: Option[String]): Fox[Array[Byte]] =
    rpc(s"$dataStoreURI/data/zarr/${urlEncode(organizationName)}/$dataSetName/$dataLayerName/$mag/$cxyz")
      .addQueryStringOptional("token", urlToken)
      .getWithBytesResponse

  override def requestUserAccess(token: Option[String], accessRequest: UserAccessRequest): Fox[UserAccessAnswer] =
    rpc(s"$webKnossosUrl/api/tracingstores/$tracingStoreName/validateUserAccess")
      .addQueryString("key" -> tracingStoreKey)
      .addQueryStringOptional("token", token)
      .postJsonWithJsonResponse[UserAccessRequest, UserAccessAnswer](accessRequest)
}
