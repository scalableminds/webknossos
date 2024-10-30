package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{bool2Fox, box2Fox, option2Fox}
import com.scalableminds.webknossos.datastore.Annotation.{
  AnnotationLayerProto,
  AnnotationLayerTypeProto,
  AnnotationProto
}
import com.scalableminds.webknossos.datastore.EditableMappingInfo.EditableMappingInfo
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayerType
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.{
  EditableMappingLayer,
  EditableMappingService,
  EditableMappingUpdateAction,
  EditableMappingUpdater
}
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.SkeletonTracingService
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating.{
  CreateNodeSkeletonAction,
  DeleteNodeSkeletonAction,
  SkeletonUpdateAction,
  UpdateTracingSkeletonAction
}
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  ApplyableVolumeUpdateAction,
  BucketMutatingVolumeUpdateAction,
  MagRestrictions,
  UpdateMappingNameVolumeAction,
  VolumeTracingService,
  VolumeUpdateAction
}
import com.scalableminds.webknossos.tracingstore.tracings.{
  FallbackDataHelper,
  KeyValueStoreImplicits,
  TracingDataStore,
  TracingId,
  TracingSelector,
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
                                    val volumeTracingService: VolumeTracingService,
                                    skeletonTracingService: SkeletonTracingService,
                                    val remoteDatastoreClient: TSRemoteDatastoreClient,
                                    tracingDataStore: TracingDataStore)
    extends KeyValueStoreImplicits
    with FallbackDataHelper
    with ProtoGeometryImplicits
    with AnnotationReversion
    with UpdateGroupHandling
    with LazyLogging {

  private lazy val materializedAnnotationWithTracingCache =
    // annotation id, version, requestedSkeletons, requestedVolumes, requestAll
    // TODO instead of requested, use list of tracings determined from requests + updates?
    AlfuCache[(String, Long, List[String], List[String], Boolean), AnnotationWithTracings](maxCapacity = 1000)

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
      implicit ec: ExecutionContext): Fox[List[(Long, List[UpdateAction])]] =
    if (desiredVersion == existingVersion) Fox.successful(List())
    else {
      tracingDataStore.annotationUpdates.getMultipleVersionsAsVersionValueTuple(
        annotationId,
        Some(desiredVersion),
        Some(existingVersion + 1))(fromJsonBytes[List[UpdateAction]])
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
        case a: AddLayerAnnotationAction =>
          addLayer(annotationId, annotationWithTracings, a, targetVersion)
        case a: DeleteLayerAnnotationAction =>
          Fox.successful(annotationWithTracings.deleteTracing(a))
        case a: UpdateLayerMetadataAnnotationAction =>
          Fox.successful(annotationWithTracings.updateLayerMetadata(a))
        case a: UpdateMetadataAnnotationAction =>
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
        case a: RevertToVersionAnnotationAction =>
          revertToVersion(annotationId, annotationWithTracings, a, targetVersion) // TODO if the revert action is not isolated, we need not the target version of all but the target version of this update
        case _: BucketMutatingVolumeUpdateAction =>
          Fox.successful(annotationWithTracings) // No-op, as bucket-mutating actions are performed eagerly, so not here.
        case _ => Fox.failure(s"Received unsupported AnnotationUpdateAction action ${Json.toJson(updateAction)}")
      }
    } yield updated

  private def addLayer(annotationId: String,
                       annotationWithTracings: AnnotationWithTracings,
                       action: AddLayerAnnotationAction,
                       targetVersion: Long)(implicit ec: ExecutionContext): Fox[AnnotationWithTracings] =
    for {
      tracingId <- action.tracingId.toFox ?~> "add layer action has no tracingId"
      _ <- bool2Fox(
        !annotationWithTracings.annotation.annotationLayers
          .exists(_.name == action.layerParameters.getNameWithDefault)) ?~> "addLayer.nameInUse"
      _ <- bool2Fox(
        !annotationWithTracings.annotation.annotationLayers.exists(
          _.`type` == AnnotationLayerTypeProto.Skeleton && action.layerParameters.typ == AnnotationLayerType.Skeleton)) ?~> "addLayer.onlyOneSkeletonAllowed"
      tracing <- remoteWebknossosClient.createTracingFor(annotationId,
                                                         action.layerParameters,
                                                         previousVersion = targetVersion - 1)
      updated = annotationWithTracings.addLayer(action, tracingId, tracing)
    } yield updated

  private def revertToVersion(
      annotationId: String,
      annotationWithTracings: AnnotationWithTracings,
      revertAction: RevertToVersionAnnotationAction,
      newVersion: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[AnnotationWithTracings] =
    // Note: works only after “ironing out” the update action groups
    for {
      sourceAnnotation: AnnotationWithTracings <- getWithTracings(
        annotationId,
        Some(revertAction.sourceVersion),
        List.empty,
        List.empty,
        requestAll = true) // TODO do we need to request the others?
      _ = logger.info(
        s"reverting to suorceVersion ${revertAction.sourceVersion}. got sourceAnnotation with version ${sourceAnnotation.version} with ${sourceAnnotation.skeletonStats}")
      _ <- revertDistributedElements(annotationWithTracings, sourceAnnotation, revertAction, newVersion)
    } yield sourceAnnotation

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
      withTracings <- getWithTracings(annotationId, version, List.empty, List.empty, requestAll = false)
    } yield withTracings.annotation

  def getMultiple(annotationIds: Seq[String])(implicit ec: ExecutionContext,
                                              tc: TokenContext): Fox[Seq[AnnotationProto]] =
    Fox.serialCombined(annotationIds) { annotationId =>
      get(annotationId, None)
    }

  private def getWithTracings(
      annotationId: String,
      version: Option[Long],
      requestedSkeletonTracingIds: List[String],
      requestedVolumeTracingIds: List[String],
      requestAll: Boolean)(implicit ec: ExecutionContext, tc: TokenContext): Fox[AnnotationWithTracings] =
    for {
      targetVersion <- determineTargetVersion(annotationId, version) ?~> "determineTargetVersion.failed"
      // When requesting any other than the newest version, do not consider the changes final
      reportChangesToWk = version.isEmpty || version.contains(targetVersion)
      updatedAnnotation <- materializedAnnotationWithTracingCache.getOrLoad(
        (annotationId, targetVersion, requestedSkeletonTracingIds, requestedVolumeTracingIds, requestAll),
        _ =>
          getWithTracingsVersioned(
            annotationId,
            targetVersion,
            requestedSkeletonTracingIds,
            requestedVolumeTracingIds,
            requestAll = true,
            reportChangesToWk = reportChangesToWk) // TODO can we request fewer to save perf? still need to avoid duplicate apply
      )
    } yield updatedAnnotation

  private def getWithTracingsVersioned(
      annotationId: String,
      version: Long,
      requestedSkeletonTracingIds: List[String],
      requestedVolumeTracingIds: List[String],
      requestAll: Boolean,
      reportChangesToWk: Boolean)(implicit ec: ExecutionContext, tc: TokenContext): Fox[AnnotationWithTracings] =
    for {
      annotationWithVersion <- tracingDataStore.annotations.get(annotationId, Some(version))(
        fromProtoBytes[AnnotationProto]) ?~> "getAnnotation.failed"
      _ = logger.info(
        s"cache miss for ${annotationId} v$version, requested ${requestedSkeletonTracingIds.mkString(",")} + ${requestedVolumeTracingIds
          .mkString(",")} (requestAll=$requestAll). Applying updates from ${annotationWithVersion.version} to $version...")
      annotation = annotationWithVersion.value
      updated <- applyPendingUpdates(annotation,
                                     annotationId,
                                     version,
                                     requestedSkeletonTracingIds,
                                     requestedVolumeTracingIds,
                                     requestAll,
                                     reportChangesToWk) ?~> "applyUpdates.failed"
    } yield updated

  def findEditableMappingInfo(annotationId: String, tracingId: String, version: Option[Long] = None)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[EditableMappingInfo] =
    for {
      annotation <- getWithTracings(annotationId, version, List.empty, List(tracingId), requestAll = false) ?~> "getWithTracings.failed"
      tracing <- annotation.getEditableMappingInfo(tracingId) ?~> "getEditableMapping.failed"
    } yield tracing

  // TODO move the functions that construct the AnnotationWithTracigns elsewhere to keep this file smaller?
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

  private def applyPendingUpdates(
      annotation: AnnotationProto,
      annotationId: String,
      targetVersion: Long,
      requestedSkeletonTracingIds: List[String],
      requestedVolumeTracingIds: List[String],
      requestAll: Boolean,
      reportChangesToWk: Boolean)(implicit ec: ExecutionContext, tc: TokenContext): Fox[AnnotationWithTracings] =
    for {
      updateGroupsAsSaved <- findPendingUpdates(annotationId, annotation.version, targetVersion) ?~> "findPendingUpdates.failed"
      updatesGroupsRegrouped = regroupByIsolationSensitiveActions(updateGroupsAsSaved)
      updatesFlat = updatesGroupsRegrouped.flatMap(_._2)
      annotationWithTracings <- findTracingsForUpdates(annotation,
                                                       updatesFlat,
                                                       requestedSkeletonTracingIds,
                                                       requestedVolumeTracingIds,
                                                       requestAll) ?~> "findTracingsForUpdates.failed"
      annotationWithTracingsAndMappings <- findEditableMappingsForUpdates(
        annotationId,
        annotationWithTracings,
        updatesFlat,
        annotation.version,
        targetVersion) // TODO: targetVersion must be set per update group, as reverts may come between these
      updated <- applyUpdatesGrouped(annotationWithTracingsAndMappings,
                                     annotationId,
                                     updatesGroupsRegrouped,
                                     reportChangesToWk) ?~> "applyUpdates.inner.failed"
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
      requestedVolumeTracingIds: List[String],
      requestAll: Boolean)(implicit ec: ExecutionContext): Fox[AnnotationWithTracings] = {
    val skeletonTracingIds =
      if (requestAll)
        annotation.annotationLayers.filter(_.`type` == AnnotationLayerTypeProto.Skeleton).map(_.tracingId)
      else {
        (updates.flatMap {
          case u: SkeletonUpdateAction => Some(u.actionTracingId)
          case _                       => None
        } ++ requestedSkeletonTracingIds).distinct
      }
    val volumeTracingIds =
      if (requestAll)
        annotation.annotationLayers.filter(_.`type` == AnnotationLayerTypeProto.Volume).map(_.tracingId)
      else {
        (updates.flatMap {
          case u: VolumeUpdateAction => Some(u.actionTracingId)
          case _                     => None
        } ++ requestedVolumeTracingIds).distinct
      }

    logger.info(s"fetching volumes $volumeTracingIds and skeletons $skeletonTracingIds")
    for {
      skeletonTracings <- Fox.serialCombined(skeletonTracingIds.toList)(
        id =>
          tracingDataStore.skeletons.get[SkeletonTracing](id, Some(annotation.version), mayBeEmpty = Some(true))(
            fromProtoBytes[SkeletonTracing]))
      volumeTracings <- Fox.serialCombined(volumeTracingIds.toList)(
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

  private def applyUpdatesGrouped(
      annotation: AnnotationWithTracings,
      annotationId: String,
      updateGroups: List[(Long, List[UpdateAction])],
      reportChangesToWk: Boolean
  )(implicit ec: ExecutionContext, tc: TokenContext): Fox[AnnotationWithTracings] = {
    def updateGroupedIter(annotationWithTracingsFox: Fox[AnnotationWithTracings],
                          remainingUpdateGroups: List[(Long, List[UpdateAction])]): Fox[AnnotationWithTracings] =
      annotationWithTracingsFox.futureBox.flatMap {
        case Empty => Fox.empty
        case Full(annotationWithTracings) =>
          remainingUpdateGroups match {
            case List() => Fox.successful(annotationWithTracings)
            case updateGroup :: tail =>
              updateGroupedIter(
                applyUpdates(annotationWithTracings, annotationId, updateGroup._2, updateGroup._1, reportChangesToWk),
                tail)
          }
        case _ => annotationWithTracingsFox
      }

    updateGroupedIter(Some(annotation), updateGroups)
  }

  private def applyUpdates(
      annotation: AnnotationWithTracings,
      annotationId: String,
      updates: List[UpdateAction],
      targetVersion: Long,
      reportChangesToWk: Boolean)(implicit ec: ExecutionContext, tc: TokenContext): Fox[AnnotationWithTracings] = {

    logger.info(s"applying ${updates.length} to go from v${annotation.version} to v$targetVersion")

    // TODO can we make this tail recursive?
    def updateIter(annotationWithTracingsFox: Fox[AnnotationWithTracings],
                   remainingUpdates: List[UpdateAction]): Fox[AnnotationWithTracings] =
      annotationWithTracingsFox.futureBox.flatMap {
        case Empty => Fox.empty
        case Full(annotationWithTracings) =>
          remainingUpdates match {
            case List() => Fox.successful(annotationWithTracings)
            case update :: tail =>
              updateIter(applyUpdate(annotationId, annotationWithTracings, update, targetVersion), tail)
          }
        case _ => annotationWithTracingsFox
      }

    if (updates.isEmpty) Full(annotation)
    else {
      for {
        updated <- updateIter(Some(annotation.withNewUpdaters(annotation.version, targetVersion)), updates)
        updatedWithNewVerson = updated.withVersion(targetVersion)
        _ = logger.info(s"flushing v$targetVersion, with ${updated.skeletonStats}")
        _ <- updatedWithNewVerson.flushBufferedUpdates()
        _ <- flushUpdatedTracings(updatedWithNewVerson)
        _ <- flushAnnotationInfo(annotationId, updatedWithNewVerson)
        _ <- Fox.runIf(reportChangesToWk)(remoteWebknossosClient.updateAnnotation(
          annotationId,
          updatedWithNewVerson.annotation)) // TODO perf: skip if annotation is identical
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

  private def determineTargetVersion(annotationId: String, targetVersionOpt: Option[Long]): Fox[Long] =
    /*
     * Determines the newest saved version from the updates column.
     * if there are no updates at all, assume annotation is brand new (possibly created from NML,
     * hence the emptyFallbck annotation.version)
     */
    for {
      newestUpdateVersion <- tracingDataStore.annotationUpdates.getVersion(annotationId,
                                                                           mayBeEmpty = Some(true),
                                                                           emptyFallback = Some(0L))
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
      resolutions = tracing.mags.map(vec3IntFromProto).toList,
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
        editableMappingInfo <- findEditableMappingInfo(annotationId, tracingId)
      } yield Some(editableMappingInfo.baseMappingName)
    else Fox.successful(tracing.mappingName)

  private def batchRangeInclusive(from: Long, to: Long, batchSize: Long): Seq[(Long, Long)] =
    (0L to ((to - from) / batchSize)).map { batchIndex =>
      val batchFrom = batchIndex * batchSize + from
      val batchTo = Math.min(to, (batchIndex + 1) * batchSize + from - 1)
      (batchFrom, batchTo)
    }

  def findVolume(annotationId: String,
                 tracingId: String,
                 version: Option[Long] = None,
                 useCache: Boolean = true,
                 applyUpdates: Boolean = false)(implicit tc: TokenContext, ec: ExecutionContext): Fox[VolumeTracing] =
    for {
      annotation <- getWithTracings(annotationId, version, List.empty, List(tracingId), requestAll = false) // TODO is applyUpdates still needed?
      tracing <- annotation.getVolume(tracingId)
    } yield tracing

  def findSkeleton(
      annotationId: String,
      tracingId: String,
      version: Option[Long] = None,
      useCache: Boolean = true,
      applyUpdates: Boolean = false)(implicit tc: TokenContext, ec: ExecutionContext): Fox[SkeletonTracing] =
    if (tracingId == TracingId.dummy)
      Fox.successful(skeletonTracingService.dummyTracing)
    else {
      for {
        annotation <- getWithTracings(annotationId, version, List(tracingId), List.empty, requestAll = false) // TODO is applyUpdates still needed?
        tracing <- annotation.getSkeleton(tracingId)
      } yield tracing
    }

  def findMultipleVolumes(selectors: List[Option[TracingSelector]],
                          useCache: Boolean = true,
                          applyUpdates: Boolean = false)(implicit tc: TokenContext,
                                                         ec: ExecutionContext): Fox[List[Option[VolumeTracing]]] =
    Fox.combined {
      selectors.map {
        case Some(selector) =>
          for {
            annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(selector.tracingId)
            tracing <- findVolume(annotationId, selector.tracingId, selector.version, useCache, applyUpdates)
              .map(Some(_))
          } yield tracing
        case None => Fox.successful(None)
      }
    }

  // TODO build variant without TracingSelector and Option?
  def findMultipleSkeletons(selectors: Seq[Option[TracingSelector]],
                            useCache: Boolean = true,
                            applyUpdates: Boolean = false)(implicit tc: TokenContext,
                                                           ec: ExecutionContext): Fox[List[Option[SkeletonTracing]]] =
    Fox.combined {
      selectors.map {
        case Some(selector) =>
          for {
            annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(selector.tracingId) // TODO perf skip that if we already have it?
            tracing <- findSkeleton(annotationId, selector.tracingId, selector.version, useCache, applyUpdates)
              .map(Some(_))
          } yield tracing
        case None => Fox.successful(None)
      }
    }

  // TODO duplicate v0 as well? (if current version is not v0)
  def duplicate(
      annotationId: String,
      newAnnotationId: String,
      version: Option[Long],
      isFromTask: Boolean,
      datasetBoundingBox: Option[BoundingBox])(implicit ec: ExecutionContext, tc: TokenContext): Fox[AnnotationProto] =
    for {
      currentAnnotation <- get(annotationId, version)
      newLayers <- Fox.serialCombined(currentAnnotation.annotationLayers)(layer =>
        duplicateLayer(annotationId, layer, currentAnnotation.version, isFromTask, datasetBoundingBox))
      _ <- duplicateUpdates(annotationId, newAnnotationId)
      duplicatedAnnotation = currentAnnotation.copy(annotationLayers = newLayers)
      _ <- tracingDataStore.annotations.put(newAnnotationId, currentAnnotation.version, duplicatedAnnotation)
    } yield duplicatedAnnotation

  private def duplicateUpdates(annotationId: String, newAnnotationId: String)(
      implicit ec: ExecutionContext): Fox[Unit] =
    // TODO perf: batch or use fossildb duplicate api
    for {
      updatesAsBytes: Seq[(Long, Array[Byte])] <- tracingDataStore.annotationUpdates
        .getMultipleVersionsAsVersionValueTuple(annotationId)
      _ <- Fox.serialCombined(updatesAsBytes) {
        case (version, updateBytes) =>
          tracingDataStore.annotationUpdates.put(newAnnotationId, version, updateBytes)
      }
    } yield ()

  private def duplicateLayer(annotationId: String,
                             layer: AnnotationLayerProto,
                             version: Long,
                             isFromTask: Boolean,
                             datasetBoundingBox: Option[BoundingBox])(implicit ec: ExecutionContext,
                                                                      tc: TokenContext): Fox[AnnotationLayerProto] =
    for {
      newTracingId <- layer.`type` match {
        case AnnotationLayerTypeProto.Volume =>
          duplicateVolumeTracing(annotationId,
                                 layer.tracingId,
                                 version,
                                 version,
                                 isFromTask,
                                 None,
                                 datasetBoundingBox,
                                 MagRestrictions.empty,
                                 None,
                                 None)
        case AnnotationLayerTypeProto.Skeleton =>
          duplicateSkeletonTracing(annotationId, layer.tracingId, version, version, isFromTask, None, None, None)
        case AnnotationLayerTypeProto.Unrecognized(num) => Fox.failure(f"unrecognized annotation layer type: $num")
      }
    } yield layer.copy(tracingId = newTracingId)

  def duplicateVolumeTracing(
      sourceAnnotationId: String,
      sourceTracingId: String,
      sourceVersion: Long,
      newVersion: Long,
      isFromTask: Boolean,
      boundingBox: Option[BoundingBox],
      datasetBoundingBox: Option[BoundingBox],
      magRestrictions: MagRestrictions,
      editPosition: Option[Vec3Int],
      editRotation: Option[Vec3Double])(implicit ec: ExecutionContext, tc: TokenContext): Fox[String] = {
    val newTracingId = TracingId.generate
    for {
      sourceTracing <- findVolume(sourceAnnotationId, sourceTracingId, Some(sourceVersion))
      newTracing <- volumeTracingService.adaptVolumeForDuplicate(sourceTracingId,
                                                                 newTracingId,
                                                                 sourceTracing,
                                                                 isFromTask,
                                                                 boundingBox,
                                                                 datasetBoundingBox,
                                                                 magRestrictions,
                                                                 editPosition,
                                                                 editRotation,
                                                                 newVersion)
      _ <- tracingDataStore.volumes.put(newTracingId, newVersion, newTracing)
      _ <- Fox.runIf(!newTracing.getHasEditableMapping)(
        volumeTracingService.duplicateVolumeData(sourceTracingId, sourceTracing, newTracingId, newTracing))
      _ <- Fox.runIf(newTracing.getHasEditableMapping)(
        duplicateEditableMapping(sourceAnnotationId, sourceTracingId, newTracingId, sourceVersion, newVersion))
    } yield newTracingId
  }

  private def duplicateEditableMapping(sourceAnnotationId: String,
                                       sourceTracingId: String,
                                       newTracingId: String,
                                       sourceVersion: Long,
                                       newVersion: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Unit] =
    for {
      editableMappingInfo <- findEditableMappingInfo(sourceAnnotationId, sourceTracingId, Some(sourceVersion))
      _ <- tracingDataStore.editableMappingsInfo.put(newTracingId, newVersion, toProtoBytes(editableMappingInfo))
      _ <- editableMappingService.duplicateSegmentToAgglomerate(sourceTracingId,
                                                                newTracingId,
                                                                sourceVersion,
                                                                newVersion)
      _ <- editableMappingService.duplicateAgglomerateToGraph(sourceTracingId, newTracingId, sourceVersion, newVersion)
    } yield ()

  def duplicateSkeletonTracing(
      sourceAnnotationId: String,
      sourceTracingId: String,
      sourceVersion: Long,
      newVersion: Long,
      isFromTask: Boolean,
      editPosition: Option[Vec3Int],
      editRotation: Option[Vec3Double],
      boundingBox: Option[BoundingBox])(implicit ec: ExecutionContext, tc: TokenContext): Fox[String] = {
    val newTracingId = TracingId.generate
    for {
      skeleton <- findSkeleton(sourceAnnotationId, sourceTracingId, Some(sourceVersion))
      adaptedSkeleton = skeletonTracingService.adaptSkeletonForDuplicate(skeleton,
                                                                         isFromTask,
                                                                         editPosition,
                                                                         editRotation,
                                                                         boundingBox,
                                                                         newVersion)
      _ <- tracingDataStore.skeletons.put(newTracingId, newVersion, adaptedSkeleton)
    } yield newTracingId
  }

}
