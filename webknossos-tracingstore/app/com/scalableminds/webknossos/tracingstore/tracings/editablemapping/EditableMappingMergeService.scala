package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import collections.SequenceUtils
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{bool2Fox, option2Fox}
import com.scalableminds.webknossos.datastore.EditableMappingInfo.EditableMappingInfo
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.{TSRemoteDatastoreClient, TSRemoteWebknossosClient}
import com.scalableminds.webknossos.tracingstore.annotation.{UpdateAction, UpdateGroupHandling}
import com.scalableminds.webknossos.tracingstore.tracings.{
  FallbackDataHelper,
  FossilDBPutBuffer,
  KeyValueStoreImplicits,
  TracingDataStore
}
import play.api.libs.json.Json

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class EditableMappingMergeService @Inject()(val tracingDataStore: TracingDataStore,
                                            val remoteDatastoreClient: TSRemoteDatastoreClient,
                                            val remoteWebknossosClient: TSRemoteWebknossosClient,
                                            editableMappingService: EditableMappingService)
    extends KeyValueStoreImplicits
    with UpdateGroupHandling
    with FallbackDataHelper {

  /*
   * Merging editable mappings is complex because it is not defined on the materialized values (as with skeleton + volume),
   * but rather on the update actions.
   * We apply all updates from the first annotation, and then all updates from the second annotation.
   * Everything is looked up by click position so that everything is defined.
   * This means that we also need to store all the editable mapping updates in the merged annotation
   * So that it itself can be merged again.
   * The earliestAccessibleVersion property ensures that the fully merged annotation is still the earliest accessible one.
   */
  def mergeEditableMappings(annotationIds: List[String],
                            firstVolumeAnnotationIdOpt: Option[String],
                            newAnnotationId: String,
                            newVolumeTracingId: String,
                            tracingsWithIds: List[(VolumeTracing, String)],
                            toTemporaryStore: Boolean)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    if (tracingsWithIds.nonEmpty && tracingsWithIds.forall(tracingWithId => tracingWithId._1.getHasEditableMapping)) {
      for {
        before <- Instant.nowFox
        _ <- bool2Fox(!toTemporaryStore) ?~> "Cannot merge editable mappings to temporary store (trying to merge compound annotations?)"
        firstVolumeAnnotationId <- firstVolumeAnnotationIdOpt.toFox
        remoteFallbackLayers <- Fox.serialCombined(tracingsWithIds)(tracingWithId =>
          remoteFallbackLayerForVolumeTracing(tracingWithId._1, firstVolumeAnnotationId))
        remoteFallbackLayer <- SequenceUtils.findUniqueElement(remoteFallbackLayers) ?~> "Cannot merge editable mappings based on different dataset layers"
        editableMappingInfos <- Fox.serialCombined(tracingsWithIds) { tracingWithId =>
          tracingDataStore.editableMappingsInfo.get(tracingWithId._2)(fromProtoBytes[EditableMappingInfo])
        }
        baseMappingName <- SequenceUtils.findUniqueElement(editableMappingInfos.map(_.value.baseMappingName)) ?~> "Cannot merge editable mappings based on different base mappings"
        linearizedEditableMappingUpdates: List[UpdateAction] <- mergeEditableMappingUpdates(annotationIds,
                                                                                            newVolumeTracingId)
        targetVersion = linearizedEditableMappingUpdates.length
        _ <- Fox.runIf(!toTemporaryStore) {
          var updateVersion = 1L
          val annotationUpdatesPutBuffer = new FossilDBPutBuffer(tracingDataStore.annotationUpdates)
          Fox
            .serialCombined(linearizedEditableMappingUpdates) { update: UpdateAction =>
              for {
                _ <- annotationUpdatesPutBuffer.put(newAnnotationId, Json.toJson(List(update)), Some(updateVersion))
                _ = updateVersion += 1
              } yield ()
            }
            .flatMap(_ => annotationUpdatesPutBuffer.flush())
        }
        editableMappingInfo = editableMappingService.create(baseMappingName)
        updater = new EditableMappingUpdater(
          newAnnotationId,
          newVolumeTracingId,
          editableMappingInfo.baseMappingName,
          0L,
          targetVersion,
          remoteFallbackLayer,
          tc,
          remoteDatastoreClient,
          editableMappingService,
          tracingDataStore
        )
        _ <- updater.applyUpdatesAndSave(editableMappingInfo, linearizedEditableMappingUpdates)
        _ = Instant.logSince(
          before,
          s"Merging ${tracingsWithIds.length} editable mappings by applying ${linearizedEditableMappingUpdates.length} updates")
      } yield targetVersion
    } else if (tracingsWithIds.forall(tracingWithId => !tracingWithId._1.getHasEditableMapping)) {
      Fox.empty
    } else {
      Fox.failure("Cannot merge annotations with and without editable mappings")
    }

  private def mergeEditableMappingUpdates(annotationIds: List[String], newTracingId: String)(
      implicit ec: ExecutionContext): Fox[List[EditableMappingUpdateAction]] =
    for {
      updatesByAnnotation <- Fox.serialCombined(annotationIds) { annotationId =>
        for {
          updateGroups <- tracingDataStore.annotationUpdates.getMultipleVersionsAsVersionValueTuple(annotationId)(
            fromJsonBytes[List[UpdateAction]])
          updatesIroned: Seq[UpdateAction] = ironOutReverts(updateGroups)
          editableMappingUpdates = updatesIroned.flatMap {
            case a: EditableMappingUpdateAction => Some(a.withActionTracingId(newTracingId))
            case _                              => None
          }
        } yield editableMappingUpdates
      }
    } yield updatesByAnnotation.flatten
}
