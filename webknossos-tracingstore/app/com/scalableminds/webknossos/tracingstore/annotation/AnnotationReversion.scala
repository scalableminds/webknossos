package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.EditableMappingInfo.EditableMappingInfo
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.tracings.VersionedKeyValuePair
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingUpdater
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingService

import scala.concurrent.ExecutionContext

trait AnnotationReversion extends FoxImplicits {

  def volumeTracingService: VolumeTracingService

  def findVolumeRaw(tracingId: String, version: Option[Long] = None): Fox[VersionedKeyValuePair[VolumeTracing]]

  protected def getEditableMappingInfoRaw(volumeTracingId: String,
                                          version: Option[Long]): Fox[VersionedKeyValuePair[EditableMappingInfo]]

  protected def editableMappingUpdaterFor(
      annotationId: ObjectId,
      tracingId: String,
      volumeTracing: VolumeTracing,
      editableMappingInfo: EditableMappingInfo,
      currentMaterializedVersion: Long,
      targetVersion: Long)(implicit tc: TokenContext, ec: ExecutionContext): Fox[EditableMappingUpdater]

  def revertDistributedElements(annotationId: ObjectId,
                                currentAnnotationWithTracings: AnnotationWithTracings,
                                sourceAnnotationWithTracings: AnnotationWithTracings,
                                sourceVersion: Long,
                                newVersion: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(sourceAnnotationWithTracings.getVolumes) {
        // Only volume data for volume layers present in the *source annotation* needs to be reverted.
        case (tracingId, sourceTracing) =>
          for {
            tracingBeforeRevertOpt <- Fox.successful(currentAnnotationWithTracings.getVolume(tracingId))
            tracingBeforeRevert: VolumeTracing <- tracingBeforeRevertOpt.toFox.orElse(findVolumeRaw(tracingId).map(
              _.value)) // If source annotation doesn’t have this tracing layer, use the last existing one as a “before point” for the reversion
            shouldRevertElements = tracingBeforeRevert.version > sourceVersion
            _ <- Fox.runIf(shouldRevertElements && !sourceTracing.getHasEditableMapping)(
              volumeTracingService.revertVolumeData(tracingId,
                                                    annotationId,
                                                    sourceVersion,
                                                    sourceTracing,
                                                    newVersion: Long,
                                                    tracingBeforeRevert)) ?~> "revert.volumeData.failed"
            _ <- Fox.runIf(shouldRevertElements && sourceTracing.getHasEditableMapping)(
              revertEditableMappingFields(annotationId,
                                          currentAnnotationWithTracings,
                                          tracingBeforeRevert,
                                          sourceVersion,
                                          newVersion,
                                          tracingId)) ?~> "revert.editableMappingData.failed"
          } yield ()
      }
    } yield ()

  private def revertEditableMappingFields(
      annotationId: ObjectId,
      currentAnnotationWithTracings: AnnotationWithTracings,
      tracingBeforeRevert: VolumeTracing,
      sourceVersion: Long,
      newVersion: Long,
      tracingId: String)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Unit] =
    for {
      updaterOpt <- Fox.successful(currentAnnotationWithTracings.getEditableMappingUpdater(tracingId))
      updater <- updaterOpt.toFox.orElse(
        editableMappingReversionUpdater(annotationId, tracingId, tracingBeforeRevert, newVersion))
      _ <- updater.revertToVersion(sourceVersion)
      _ <- updater.flushBuffersToFossil()
    } yield ()

  // If source annotation doesn’t have this editable mapping, use the last existing one as a “before point” for the reversion
  private def editableMappingReversionUpdater(annotationId: ObjectId,
                                              tracingId: String,
                                              tracingBeforeRevert: VolumeTracing,
                                              targetVersion: Long)(implicit ec: ExecutionContext, tc: TokenContext) =
    for {
      editableMappingInfo <- getEditableMappingInfoRaw(tracingId, version = None) ?~> "getEditableMappingInfoRaw.failed"
      updater <- editableMappingUpdaterFor(annotationId,
                                           tracingId,
                                           tracingBeforeRevert,
                                           editableMappingInfo.value,
                                           tracingBeforeRevert.version,
                                           targetVersion) ?~> "EditableMappingUpdater.initialize.failed"
    } yield updater
}
