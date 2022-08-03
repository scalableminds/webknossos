package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClass

import scala.concurrent.ExecutionContext

case class RemoteFallbackLayer(organizationName: String,
                               dataSetName: String,
                               layerName: String,
                               elementClass: ElementClass)

object RemoteFallbackLayer extends FoxImplicits {

  def fromVolumeTracing(tracing: VolumeTracing)(implicit ec: ExecutionContext): Fox[RemoteFallbackLayer] = {
    for {
      layerName <- tracing.fallbackLayer.toFox ?~> "This feature is only defined on volume annotations with fallback segmentation layer."
      organizationName <- tracing.organizationName.toFox ?~> "This feature is only implemented for volume annotations with an explicit organization name tag, not for legacy volume annotations."
    } yield RemoteFallbackLayer(organizationName, tracing.dataSetName, layerName, tracing.elementClass)
  }
}
