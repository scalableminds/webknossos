package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.services.FullMeshRequest
import play.api.i18n.MessagesProvider

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class TSFullMeshService @Inject()(volumeTracingService: VolumeTracingService) {
  def loadFor(token: Option[String], tracingId: String, fullMeshRequest: FullMeshRequest)(
      implicit ec: ExecutionContext,
      m: MessagesProvider): Fox[Array[Byte]] =
    for {
      tracing <- volumeTracingService.find(tracingId) ?~> "tracing.notFound"
      data <- if (fullMeshRequest.meshFileName.isDefined)
        loadFullMeshFromMeshfile(token, tracing, tracingId, fullMeshRequest)
      else loadFullMeshFromAdHoc(token, tracing, tracingId, fullMeshRequest)
    } yield data

  private def loadFullMeshFromMeshfile(token: Option[String],
                                       tracing: VolumeTracing,
                                       tracingId: String,
                                       fullMeshRequest: FullMeshRequest): Fox[Array[Byte]] = ???

  private def loadFullMeshFromAdHoc(token: Option[String],
                                    tracing: VolumeTracing,
                                    tracingId: String,
                                    fullMeshRequest: FullMeshRequest): Fox[Array[Byte]] = ???
}
