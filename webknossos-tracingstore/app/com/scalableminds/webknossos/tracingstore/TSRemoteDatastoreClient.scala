package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.DataRequestCollection.DataRequestCollection
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.RemoteFallbackLayer
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle

class TSRemoteDatastoreClient @Inject()(
    rpc: RPC,
    config: TracingStoreConfig,
    val lifecycle: ApplicationLifecycle
) extends LazyLogging {

  private val datastoreUrl: String = config.Tracingstore.WebKnossos.uri

  def getAgglomerateSkeleton(userToken: Option[String],
                             organizationName: String,
                             dataSetName: String,
                             dataLayerName: String,
                             mappingName: String,
                             agglomerateId: Long): Fox[Array[Byte]] =
    rpc(
      s"$datastoreUrl/data/datasets/$organizationName/$dataSetName/layers/$dataLayerName/agglomerates/$mappingName/skeleton/$agglomerateId")
      .addQueryStringOptional("token", userToken)
      .getWithBytesResponse

  def getData(remoteFallbackLayer: RemoteFallbackLayer,
              dataRequests: DataRequestCollection): Fox[(Array[Byte], List[Int])] = ???

}
