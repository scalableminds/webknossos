package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{box2Fox, option2Fox}
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingService

import scala.concurrent.ExecutionContext

trait AnnotationReversion {

  def volumeTracingService: VolumeTracingService

  def revertDistributedElements(annotationId: String,
                                currentAnnotationWithTracings: AnnotationWithTracings,
                                sourceAnnotationWithTracings: AnnotationWithTracings,
                                revertAction: RevertToVersionAnnotationAction,
                                newVersion: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Unit] =
    // TODO segment index, volume buckets, proofreading data
    for {
      _ <- Fox.serialCombined(sourceAnnotationWithTracings.getVolumes) {
        // Only volume data for volume layers present in the *source annotation* needs to be reverted.
        case (tracingId, sourceTracing) =>
          for {
            tracingBeforeRevert <- currentAnnotationWithTracings.getVolume(tracingId).toFox
            _ <- Fox.runIf(!sourceTracing.getHasEditableMapping)(
              volumeTracingService.revertVolumeData(tracingId,
                                                    revertAction.sourceVersion,
                                                    sourceTracing,
                                                    newVersion: Long,
                                                    tracingBeforeRevert))
            _ <- Fox.runIf(sourceTracing.getHasEditableMapping)(
              revertEditableMappingFields(currentAnnotationWithTracings, revertAction, tracingId))
          } yield ()
      }
    } yield ()

  private def revertEditableMappingFields(currentAnnotationWithTracings: AnnotationWithTracings,
                                          revertAction: RevertToVersionAnnotationAction,
                                          tracingId: String)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      updater <- currentAnnotationWithTracings.getEditableMappingUpdater(tracingId).toFox
      _ <- updater.revertToVersion(revertAction)
      _ <- updater.flushBuffersToFossil()
    } yield ()
}
