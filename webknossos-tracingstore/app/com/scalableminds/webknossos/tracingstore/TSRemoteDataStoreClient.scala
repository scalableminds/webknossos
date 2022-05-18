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
) extends LazyLogging {
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
}
