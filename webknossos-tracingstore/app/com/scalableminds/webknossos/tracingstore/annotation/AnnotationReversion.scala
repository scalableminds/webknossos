package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.box2Fox
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingService

import scala.concurrent.ExecutionContext

trait AnnotationReversion {

  def volumeTracingService: VolumeTracingService

  def revertDistributedElements(annotationId: String,
                                currentAnnotationWithTracings: AnnotationWithTracings,
                                sourceAnnotationWithTracings: AnnotationWithTracings,
                                revertAction: RevertToVersionUpdateAction,
                                newVersion: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Unit] =
    // TODO segment index, volume buckets, proofreading data
    for {
      _ <- Fox.serialCombined(sourceAnnotationWithTracings.getVolumes) {
        // Only volume data for volume layers present in the *source annotation* needs to be reverted.
        case (tracingId, sourceTracing) =>
          for {
            tracingBeforeRevert <- currentAnnotationWithTracings.getVolume(tracingId).toFox
            _ <- volumeTracingService.revertVolumeData(tracingId,
                                                       revertAction.sourceVersion,
                                                       sourceTracing,
                                                       newVersion: Long,
                                                       tracingBeforeRevert)
          } yield ()
      }
    } yield ()

}
