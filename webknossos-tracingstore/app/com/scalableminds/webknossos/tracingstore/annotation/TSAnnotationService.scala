package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{box2Fox, option2Fox}
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto
import com.scalableminds.webknossos.datastore.EditableMappingInfo.EditableMappingInfo
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.{
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
  KeyValueStoreImplicits,
  RemoteFallbackLayer,
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

class TSAnnotationService @Inject()(remoteWebknossosClient: TSRemoteWebknossosClient,
                                    editableMappingService: EditableMappingService,
                                    remoteDatastoreClient: TSRemoteDatastoreClient,
                                    tracingDataStore: TracingDataStore)
    extends KeyValueStoreImplicits
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

  private def applyUpdate(
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
            withNewEditableMapping <- addEditableMapping(annotationWithTracings, a, targetVersion)
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

  def updateActionLog(annotationId: String, newestVersion: Option[Long], oldestVersion: Option[Long]): Fox[JsValue] = {
    def versionedTupleToJson(tuple: (Long, List[UpdateAction])): JsObject =
      Json.obj(
        "version" -> tuple._1,
        "value" -> Json.toJson(tuple._2)
      )

    for {
      updateActionGroups <- tracingDataStore.annotationUpdates.getMultipleVersionsAsVersionValueTuple(
        annotationId,
        newestVersion,
        oldestVersion)(fromJsonBytes[List[UpdateAction]])
      updateActionGroupsJs = updateActionGroups.map(versionedTupleToJson)
    } yield Json.toJson(updateActionGroupsJs)
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
      annotation <- getWithTracings(annotationId, version, List.empty, List(tracingId))
      tracing <- annotation.getEditableMappingInfo(tracingId) ?~> "getEditableMapping.failed"
    } yield tracing

  // move the functions that construct the AnnotationWithTracigns elsewhere?
  private def addEditableMapping(annotationWithTracings: AnnotationWithTracings,
                                 action: UpdateMappingNameVolumeAction,
                                 targetVersion: Long)(implicit tc: TokenContext): Fox[AnnotationWithTracings] =
    for {
      editableMappingInfo <- getEditableMappingInfoFromStore(action.actionTracingId, annotationWithTracings.version)
      updater = editableMappingUpdaterFor(action.actionTracingId,
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
      annotationWithTracingsAndMappings <- findEditableMappingsForUpdates(annotationWithTracings,
                                                                          updates,
                                                                          annotation.version,
                                                                          targetVersion)
      updated <- applyUpdates(annotationWithTracingsAndMappings, annotationId, updates, targetVersion) ?~> "applyUpdates.inner.failed"
    } yield updated

  private def findEditableMappingsForUpdates( // TODO integrate with findTracings?
                                             annotationWithTracings: AnnotationWithTracings,
                                             updates: List[UpdateAction],
                                             currentMaterializedVersion: Long,
                                             targetVersion: Long)(implicit ec: ExecutionContext, tc: TokenContext) = {
    val volumeIdsWithEditableMapping = annotationWithTracings.volumesIdsThatHaveEditableMapping
    logger.info(s"fetching editable mappings ${volumeIdsWithEditableMapping.mkString(",")}")
    // TODO intersect with editable mapping updates?
    for {
      editableMappingInfos <- Fox.serialCombined(volumeIdsWithEditableMapping) { volumeTracingId =>
        getEditableMappingInfoFromStore(volumeTracingId, annotationWithTracings.version)
      }
    } yield
      annotationWithTracings.copy(
        editableMappingsByTracingId = editableMappingInfos
          .map(
            keyValuePair =>
              (keyValuePair.key,
               (keyValuePair.value,
                editableMappingUpdaterFor(keyValuePair.key,
                                          keyValuePair.value,
                                          currentMaterializedVersion,
                                          targetVersion))))
          .toMap)
  }

  private def getEditableMappingInfoFromStore(volumeTracingId: String,
                                              version: Long): Fox[VersionedKeyValuePair[EditableMappingInfo]] =
    tracingDataStore.editableMappingsInfo.get(volumeTracingId, version = Some(version))(
      fromProtoBytes[EditableMappingInfo])

  private def editableMappingUpdaterFor(tracingId: String,
                                        editableMappingInfo: EditableMappingInfo,
                                        currentMaterializedVersion: Long,
                                        targetVersion: Long)(implicit tc: TokenContext): EditableMappingUpdater = {
    val remoteFallbackLayer
      : RemoteFallbackLayer = RemoteFallbackLayer("todo", "todo", "todo", ElementClassProto.uint8) // TODO
    new EditableMappingUpdater(
      tracingId,
      editableMappingInfo.baseMappingName,
      currentMaterializedVersion,
      targetVersion,
      remoteFallbackLayer,
      tc,
      remoteDatastoreClient,
      editableMappingService,
      tracingDataStore,
      relyOnAgglomerateIds = false // TODO
    )
  }

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
            case update :: tail => updateIter(applyUpdate(annotationWithTracings, update, targetVersion), tail)
          }
        case _ => annotationWithTracingsFox
      }

    if (updates.isEmpty) Full(annotation)
    else {
      for {
        updated <- updateIter(Some(annotation), updates)
        // TODO flush editable mapping updaters
      } yield updated.withVersion(targetVersion)
    }
  }

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
      updateActionGroups <- tracingDataStore.skeletonUpdates.getMultipleVersions(tracingId)(
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
}
