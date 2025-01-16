package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{box2Fox, option2Fox}
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingService

import scala.concurrent.ExecutionContext

trait AnnotationReversion {

  def volumeTracingService: VolumeTracingService

  def revertDistributedElements(currentAnnotationWithTracings: AnnotationWithTracings,
                                sourceAnnotationWithTracings: AnnotationWithTracings,
                                sourceVersion: Long,
                                newVersion: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(sourceAnnotationWithTracings.getVolumes) {
        // Only volume data for volume layers present in the *source annotation* needs to be reverted.
        case (tracingId, sourceTracing) =>
          for {
            tracingBeforeRevert <- currentAnnotationWithTracings.getVolume(tracingId).toFox
            _ <- Fox.runIf(!sourceTracing.getHasEditableMapping)(
              volumeTracingService.revertVolumeData(tracingId,
                                                    sourceVersion,
                                                    sourceTracing,
                                                    newVersion: Long,
                                                    tracingBeforeRevert)) ?~> "revert.volumeData.failed"
            _ <- Fox.runIf(sourceTracing.getHasEditableMapping)(revertEditableMappingFields(
              currentAnnotationWithTracings,
              sourceVersion,
              tracingId)) ?~> "revert.editableMappingData.failed"
          } yield ()
      }
    } yield ()

  private def revertEditableMappingFields(currentAnnotationWithTracings: AnnotationWithTracings,
                                          sourceVersion: Long,
                                          tracingId: String)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      updater <- currentAnnotationWithTracings.getEditableMappingUpdater(tracingId).toFox
      _ <- updater.revertToVersion(sourceVersion)
      _ <- updater.flushBuffersToFossil()
    } yield ()
}
