package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.services.FullMeshRequest
import com.scalableminds.webknossos.tracingstore.tracings.FallbackDataHelper
import com.scalableminds.webknossos.tracingstore.{TSRemoteDatastoreClient, TSRemoteWebKnossosClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class TSFullMeshService @Inject()(volumeTracingService: VolumeTracingService,
                                  val remoteDatastoreClient: TSRemoteDatastoreClient,
                                  val remoteWebKnossosClient: TSRemoteWebKnossosClient)
    extends FallbackDataHelper {

  def loadFor(token: Option[String], tracingId: String, fullMeshRequest: FullMeshRequest)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      tracing <- volumeTracingService.find(tracingId) ?~> "tracing.notFound"
      data <- if (fullMeshRequest.meshFileName.isDefined)
        loadFullMeshFromMeshfile(token, tracing, tracingId, fullMeshRequest)
      else loadFullMeshFromAdHoc(token, tracing, tracingId, fullMeshRequest)
    } yield data

  private def loadFullMeshFromMeshfile(
      token: Option[String],
      tracing: VolumeTracing,
      tracingId: String,
      fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      remoteFallbackLayer <- remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
      fullMeshRequestAdapted = if (tracing.mappingIsEditable.getOrElse(false))
        fullMeshRequest.copy(mappingName = tracing.mappingName,
                             editableMappingTracingId = Some(tracingId),
                             mappingType = Some("HDF5"))
      else fullMeshRequest
      array <- remoteDatastoreClient.loadFullMeshStl(token, remoteFallbackLayer, fullMeshRequestAdapted)
    } yield array

  private def loadFullMeshFromAdHoc(token: Option[String],
                                    tracing: VolumeTracing,
                                    tracingId: String,
                                    fullMeshRequest: FullMeshRequest): Fox[Array[Byte]] = ???
}
