package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{box2Fox, option2Fox}
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto
import com.scalableminds.webknossos.datastore.EditableMappingInfo.EditableMappingInfo
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.{
  EditableMappingLayer,
  EditableMappingService,
  EditableMappingUpdateAction,
  EditableMappingUpdater
}
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating.{
  CreateNodeSkeletonAction,
  DeleteNodeSkeletonAction,
  SkeletonUpdateAction,
  UpdateTracingSkeletonAction
}
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  ApplyableVolumeUpdateAction,
  BucketMutatingVolumeUpdateAction,
  UpdateMappingNameVolumeAction,
  VolumeUpdateAction
}
import com.scalableminds.webknossos.tracingstore.tracings.{
  FallbackDataHelper,
  KeyValueStoreImplicits,
  TracingDataStore,
  VersionedKeyValuePair
}
import com.scalableminds.webknossos.tracingstore.{
  TSRemoteDatastoreClient,
  TSRemoteWebknossosClient,
  TracingUpdatesReport
}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Empty, Full}
import play.api.libs.json.{JsObject, JsValue, Json}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class TSAnnotationService @Inject()(val remoteWebknossosClient: TSRemoteWebknossosClient,
                                    editableMappingService: EditableMappingService,
                                    val remoteDatastoreClient: TSRemoteDatastoreClient,
                                    tracingDataStore: TracingDataStore)
    extends KeyValueStoreImplicits
    with FallbackDataHelper
    with ProtoGeometryImplicits
    with LazyLogging {

  def reportUpdates(annotationId: String, updateGroups: List[UpdateActionGroup])(implicit tc: TokenContext): Fox[Unit] =
    for {
      _ <- remoteWebknossosClient.reportTracingUpdates(
        TracingUpdatesReport(
          annotationId,
          timestamps = updateGroups.map(g => Instant(g.timestamp)),
          statistics = updateGroups.flatMap(_.stats).lastOption, // TODO statistics per tracing/layer
          significantChangesCount = updateGroups.map(_.significantChangesCount).sum,
          viewChangesCount = updateGroups.map(_.viewChangesCount).sum,
          tc.userTokenOpt
        ))
    } yield ()

  def currentMaterializableVersion(annotationId: String): Fox[Long] =
    tracingDataStore.annotationUpdates.getVersion(annotationId, mayBeEmpty = Some(true), emptyFallback = Some(0L))

  def currentMaterializedVersion(annotationId: String): Fox[Long] =
    tracingDataStore.annotations.getVersion(annotationId, mayBeEmpty = Some(true), emptyFallback = Some(0L))

  private def findPendingUpdates(annotationId: String, existingVersion: Long, desiredVersion: Long)(
      implicit ec: ExecutionContext): Fox[List[UpdateAction]] =
    if (desiredVersion == existingVersion) Fox.successful(List())
    else {
      for {
        updateActionGroups <- tracingDataStore.annotationUpdates.getMultipleVersions(
          annotationId,
          Some(desiredVersion),
          Some(existingVersion + 1))(fromJsonBytes[List[UpdateAction]])
      } yield updateActionGroups.reverse.flatten
    }

  // TODO option to dry apply?
  private def applyUpdate(
      annotationId: String,
      annotationWithTracings: AnnotationWithTracings,
      updateAction: UpdateAction,
      targetVersion: Long // Note: this is not the target version of this one update, but of all pending
  )(implicit ec: ExecutionContext, tc: TokenContext): Fox[AnnotationWithTracings] =
    for {
      updated <- updateAction match {
        case a: AddLayerAnnotationUpdateAction =>
          Fox.successful(annotationWithTracings.addTracing(a))
        case a: DeleteLayerAnnotationUpdateAction =>
          Fox.successful(annotationWithTracings.deleteTracing(a))
        case a: UpdateLayerMetadataAnnotationUpdateAction =>
          Fox.successful(annotationWithTracings.updateLayerMetadata(a))
        case a: UpdateMetadataAnnotationUpdateAction =>
          Fox.successful(annotationWithTracings.updateMetadata(a))
        case a: SkeletonUpdateAction =>
          annotationWithTracings.applySkeletonAction(a) ?~> "applySkeletonAction.failed"
        case a: UpdateMappingNameVolumeAction if a.isEditable.contains(true) =>
          for {
            withNewEditableMapping <- addEditableMapping(annotationId, annotationWithTracings, a, targetVersion)
            withApplyedVolumeAction <- withNewEditableMapping.applyVolumeAction(a)
          } yield withApplyedVolumeAction
        case a: ApplyableVolumeUpdateAction =>
          annotationWithTracings.applyVolumeAction(a)
        case a: EditableMappingUpdateAction =>
          annotationWithTracings.applyEditableMappingAction(a)
        case _: BucketMutatingVolumeUpdateAction =>
          Fox.successful(annotationWithTracings) // No-op, as bucket-mutating actions are performed eagerly, so not here.
        case _ => Fox.failure(s"Received unsupported AnnotationUpdateAction action ${Json.toJson(updateAction)}")
      }
    } yield updated

  def createTracing(a: AddLayerAnnotationUpdateAction)(
      implicit ec: ExecutionContext): Fox[Either[SkeletonTracing, VolumeTracing]] =
    Fox.failure("not implemented")
  // TODO create tracing object (ask wk for needed parameters e.g. fallback layer info?)

  def updateActionLog(annotationId: String, newestVersion: Long, oldestVersion: Long)(
      implicit ec: ExecutionContext): Fox[JsValue] = {
    def versionedTupleToJson(tuple: (Long, List[UpdateAction])): JsObject =
      Json.obj(
        "version" -> tuple._1,
        "value" -> Json.toJson(tuple._2)
      )

    val batchRanges = batchRangeInclusive(oldestVersion, newestVersion, batchSize = 100)
    for {
      updateActionBatches <- Fox.serialCombined(batchRanges.toList) { batchRange =>
        val batchFrom = batchRange._1
        val batchTo = batchRange._2
        tracingDataStore.annotationUpdates.getMultipleVersionsAsVersionValueTuple(
          annotationId,
          Some(batchTo),
          Some(batchFrom))(fromJsonBytes[List[UpdateAction]])
      }
    } yield Json.toJson(updateActionBatches.flatten.map(versionedTupleToJson))
  }

  def get(annotationId: String, version: Option[Long])(implicit ec: ExecutionContext,
                                                       tc: TokenContext): Fox[AnnotationProto] =
    for {
      withTracings <- getWithTracings(annotationId, version, List.empty, List.empty)
    } yield withTracings.annotation

  def getWithTracings(annotationId: String,
                      version: Option[Long],
                      requestedSkeletonTracingIds: List[String],
                      requestedVolumeTracingIds: List[String])(implicit ec: ExecutionContext,
                                                               tc: TokenContext): Fox[AnnotationWithTracings] =
    for {
      annotationWithVersion <- tracingDataStore.annotations.get(annotationId, version)(fromProtoBytes[AnnotationProto]) ?~> "getAnnotation.failed"
      annotation = annotationWithVersion.value
      updated <- applyPendingUpdates(annotation,
                                     annotationId,
                                     version,
                                     requestedSkeletonTracingIds,
                                     requestedVolumeTracingIds) ?~> "applyUpdates.failed"
    } yield updated

  def getEditableMappingInfo(annotationId: String, tracingId: String, version: Option[Long] = None)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[EditableMappingInfo] =
    for {
      annotation <- getWithTracings(annotationId, version, List.empty, List(tracingId)) ?~> "getWithTracings.failed"
      tracing <- annotation.getEditableMappingInfo(tracingId) ?~> "getEditableMapping.failed"
    } yield tracing

  // move the functions that construct the AnnotationWithTracigns elsewhere?
  private def addEditableMapping(
      annotationId: String,
      annotationWithTracings: AnnotationWithTracings,
      action: UpdateMappingNameVolumeAction,
      targetVersion: Long)(implicit tc: TokenContext, ec: ExecutionContext): Fox[AnnotationWithTracings] =
    for {
      editableMappingInfo <- getEditableMappingInfoFromStore(action.actionTracingId, annotationWithTracings.version)
      volumeTracing <- annotationWithTracings.getVolume(action.actionTracingId).toFox
      updater <- editableMappingUpdaterFor(annotationId,
                                           action.actionTracingId,
                                           volumeTracing,
                                           editableMappingInfo.value,
                                           annotationWithTracings.version,
                                           targetVersion)
    } yield annotationWithTracings.addEditableMapping(action.actionTracingId, editableMappingInfo.value, updater)

  private def applyPendingUpdates(annotation: AnnotationProto,
                                  annotationId: String,
                                  targetVersionOpt: Option[Long],
                                  requestedSkeletonTracingIds: List[String],
                                  requestedVolumeTracingIds: List[String])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[AnnotationWithTracings] =
    for {
      targetVersion <- determineTargetVersion(annotation, annotationId, targetVersionOpt) ?~> "determineTargetVersion.failed"
      updates <- findPendingUpdates(annotationId, annotation.version, targetVersion) ?~> "findPendingUpdates.failed"
      annotationWithTracings <- findTracingsForUpdates(annotation,
                                                       updates,
                                                       requestedSkeletonTracingIds,
                                                       requestedVolumeTracingIds) ?~> "findTracingsForUpdates.failed"
      annotationWithTracingsAndMappings <- findEditableMappingsForUpdates(annotationId,
                                                                          annotationWithTracings,
                                                                          updates,
                                                                          annotation.version,
                                                                          targetVersion)
      updated <- applyUpdates(annotationWithTracingsAndMappings, annotationId, updates, targetVersion) ?~> "applyUpdates.inner.failed"
    } yield updated

  private def findEditableMappingsForUpdates( // TODO integrate with findTracings?
                                             annotationId: String,
                                             annotationWithTracings: AnnotationWithTracings,
                                             updates: List[UpdateAction],
                                             currentMaterializedVersion: Long,
                                             targetVersion: Long)(implicit ec: ExecutionContext, tc: TokenContext) = {
    val volumeWithEditableMapping = annotationWithTracings.volumesThatHaveEditableMapping
    logger.info(s"fetching editable mappings ${volumeWithEditableMapping.map(_._2).mkString(",")}")
    // TODO perf optimization: intersect with editable mapping updates? unless requested
    for {
      idInfoUpdaterTuples <- Fox.serialCombined(volumeWithEditableMapping) {
        case (volumeTracing, volumeTracingId) =>
          for {
            editableMappingInfo <- getEditableMappingInfoFromStore(volumeTracingId, annotationWithTracings.version)
            updater <- editableMappingUpdaterFor(annotationId,
                                                 volumeTracingId,
                                                 volumeTracing,
                                                 editableMappingInfo.value,
                                                 currentMaterializedVersion,
                                                 targetVersion)
          } yield (editableMappingInfo.key, (editableMappingInfo.value, updater))
      }
    } yield annotationWithTracings.copy(editableMappingsByTracingId = idInfoUpdaterTuples.toMap)
  }

  private def getEditableMappingInfoFromStore(volumeTracingId: String,
                                              version: Long): Fox[VersionedKeyValuePair[EditableMappingInfo]] =
    tracingDataStore.editableMappingsInfo.get(volumeTracingId, version = Some(version))(
      fromProtoBytes[EditableMappingInfo])

  private def editableMappingUpdaterFor(
      annotationId: String,
      tracingId: String,
      volumeTracing: VolumeTracing,
      editableMappingInfo: EditableMappingInfo,
      currentMaterializedVersion: Long,
      targetVersion: Long)(implicit tc: TokenContext, ec: ExecutionContext): Fox[EditableMappingUpdater] =
    for {
      remoteFallbackLayer <- remoteFallbackLayerFromVolumeTracing(volumeTracing, tracingId)
    } yield
      new EditableMappingUpdater(
        annotationId,
        tracingId,
        editableMappingInfo.baseMappingName,
        currentMaterializedVersion,
        targetVersion,
        remoteFallbackLayer,
        tc,
        remoteDatastoreClient,
        editableMappingService,
        this,
        tracingDataStore,
        relyOnAgglomerateIds = false // TODO should we?
      )

  private def findTracingsForUpdates(
      annotation: AnnotationProto,
      updates: List[UpdateAction],
      requestedSkeletonTracingIds: List[String],
      requestedVolumeTracingIds: List[String])(implicit ec: ExecutionContext): Fox[AnnotationWithTracings] = {
    val skeletonTracingIds = (updates.flatMap {
      case u: SkeletonUpdateAction => Some(u.actionTracingId)
      case _                       => None
    } ++ requestedSkeletonTracingIds).distinct
    val volumeTracingIds = (updates.flatMap {
      case u: VolumeUpdateAction => Some(u.actionTracingId)
      case _                     => None
    } ++ requestedVolumeTracingIds).distinct

    logger.info(s"fetching volumes $volumeTracingIds and skeletons $skeletonTracingIds")
    for {
      skeletonTracings <- Fox.serialCombined(skeletonTracingIds)(
        id =>
          tracingDataStore.skeletons.get[SkeletonTracing](id, Some(annotation.version), mayBeEmpty = Some(true))(
            fromProtoBytes[SkeletonTracing]))
      volumeTracings <- Fox.serialCombined(volumeTracingIds)(
        id =>
          tracingDataStore.volumes
            .get[VolumeTracing](id, Some(annotation.version), mayBeEmpty = Some(true))(fromProtoBytes[VolumeTracing]))
      _ = logger.info(s"fetched ${skeletonTracings.length} skeletons and ${volumeTracings.length} volumes")
      skeletonTracingsMap: Map[String, Either[SkeletonTracing, VolumeTracing]] = skeletonTracingIds
        .zip(skeletonTracings.map(versioned => Left[SkeletonTracing, VolumeTracing](versioned.value)))
        .toMap
      volumeTracingsMap: Map[String, Either[SkeletonTracing, VolumeTracing]] = volumeTracingIds
        .zip(volumeTracings.map(versioned => Right[SkeletonTracing, VolumeTracing](versioned.value)))
        .toMap
    } yield AnnotationWithTracings(annotation, skeletonTracingsMap ++ volumeTracingsMap, Map.empty)
  }

  private def applyUpdates(
      annotation: AnnotationWithTracings,
      annotationId: String,
      updates: List[UpdateAction],
      targetVersion: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[AnnotationWithTracings] = {

    def updateIter(annotationWithTracingsFox: Fox[AnnotationWithTracings],
                   remainingUpdates: List[UpdateAction]): Fox[AnnotationWithTracings] =
      annotationWithTracingsFox.futureBox.flatMap {
        case Empty => Fox.empty
        case Full(annotationWithTracings) =>
          remainingUpdates match {
            case List() => Fox.successful(annotationWithTracings)
            case RevertToVersionUpdateAction(sourceVersion, _, _, _) :: tail =>
              ???
            case update :: tail =>
              updateIter(applyUpdate(annotationId, annotationWithTracings, update, targetVersion), tail)
          }
        case _ => annotationWithTracingsFox
      }

    if (updates.isEmpty) Full(annotation)
    else {
      for {
        updated <- updateIter(Some(annotation), updates)
        updatedWithNewVerson = updated.withVersion(targetVersion)
        _ <- updatedWithNewVerson.flushBufferedUpdates()
        _ <- flushUpdatedTracings(updatedWithNewVerson)
        _ <- flushAnnotationInfo(annotationId, updatedWithNewVerson)
      } yield updatedWithNewVerson
    }
  }

  private def flushUpdatedTracings(annotationWithTracings: AnnotationWithTracings)(implicit ec: ExecutionContext) =
    // TODO skip some flushes to save disk space (e.g. skeletons only nth version, or only if requested?)
    for {
      _ <- Fox.serialCombined(annotationWithTracings.getVolumes) {
        case (volumeTracingId, volumeTracing) =>
          tracingDataStore.volumes.put(volumeTracingId, volumeTracing.version, volumeTracing)
      }
      _ <- Fox.serialCombined(annotationWithTracings.getSkeletons) {
        case (skeletonTracingId, skeletonTracing: SkeletonTracing) =>
          tracingDataStore.skeletons.put(skeletonTracingId, skeletonTracing.version, skeletonTracing)
      }
      _ <- Fox.serialCombined(annotationWithTracings.getEditableMappingsInfo) {
        case (volumeTracingId, editableMappingInfo) =>
          tracingDataStore.editableMappingsInfo.put(volumeTracingId,
                                                    annotationWithTracings.version,
                                                    editableMappingInfo)
      }
    } yield ()

  private def flushAnnotationInfo(annotationId: String, annotationWithTracings: AnnotationWithTracings) =
    tracingDataStore.annotations.put(annotationId, annotationWithTracings.version, annotationWithTracings.annotation)

  private def determineTargetVersion(annotation: AnnotationProto,
                                     annotationId: String,
                                     targetVersionOpt: Option[Long]): Fox[Long] =
    /*
     * Determines the newest saved version from the updates column.
     * if there are no updates at all, assume annotation is brand new (possibly created from NML,
     * hence the emptyFallbck annotation.version)
     */
    for {
      newestUpdateVersion <- tracingDataStore.annotationUpdates.getVersion(annotationId,
                                                                           mayBeEmpty = Some(true),
                                                                           emptyFallback = Some(annotation.version))
    } yield {
      targetVersionOpt match {
        case None              => newestUpdateVersion
        case Some(desiredSome) => math.min(desiredSome, newestUpdateVersion)
      }
    }

  def updateActionStatistics(tracingId: String): Fox[JsObject] =
    for {
      updateActionGroups <- tracingDataStore.annotationUpdates.getMultipleVersions(tracingId)(
        fromJsonBytes[List[UpdateAction]])
      updateActions = updateActionGroups.flatten
    } yield {
      Json.obj(
        "updateTracingActionCount" -> updateActions.count {
          case _: UpdateTracingSkeletonAction => true
          case _                              => false
        },
        "createNodeActionCount" -> updateActions.count {
          case _: CreateNodeSkeletonAction => true
          case _                           => false
        },
        "deleteNodeActionCount" -> updateActions.count {
          case _: DeleteNodeSkeletonAction => true
          case _                           => false
        }
      )
    }

  def editableMappingLayer(annotationId: String, tracingId: String, tracing: VolumeTracing)(
      implicit tc: TokenContext): EditableMappingLayer =
    EditableMappingLayer(
      tracingId,
      tracing.boundingBox,
      resolutions = tracing.resolutions.map(vec3IntFromProto).toList,
      largestSegmentId = Some(0L),
      elementClass = tracing.elementClass,
      tc,
      tracing = tracing,
      annotationId = annotationId,
      tracingId = tracingId,
      annotationService = this,
      editableMappingService = editableMappingService
    )

  def baseMappingName(annotationId: String, tracingId: String, tracing: VolumeTracing)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Option[String]] =
    if (tracing.getHasEditableMapping)
      for {
        editableMappingInfo <- getEditableMappingInfo(annotationId, tracingId)
      } yield Some(editableMappingInfo.baseMappingName)
    else Fox.successful(tracing.mappingName)

  private def batchRangeInclusive(from: Long, to: Long, batchSize: Long): Seq[(Long, Long)] =
    (0L to ((to - from) / batchSize)).map { batchIndex =>
      val batchFrom = batchIndex * batchSize + from
      val batchTo = Math.min(to, (batchIndex + 1) * batchSize + from - 1)
      (batchFrom, batchTo)
    }

}