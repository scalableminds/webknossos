package com.scalableminds.webknossos.tracingstore.annotation

import collections.SequenceUtils
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
import com.scalableminds.webknossos.tracingstore.tracings._
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
import com.scalableminds.webknossos.tracingstore.tracings.volume._
import com.scalableminds.webknossos.tracingstore.{TSRemoteDatastoreClient, TSRemoteWebknossosClient}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Empty, Full}
import play.api.libs.json.{JsObject, JsValue, Json}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class TSAnnotationService @Inject()(val remoteWebknossosClient: TSRemoteWebknossosClient,
                                    editableMappingService: EditableMappingService,
                                    val volumeTracingService: VolumeTracingService,
                                    skeletonTracingService: SkeletonTracingService,
                                    skeletonTracingMigrationService: SkeletonTracingMigrationService,
                                    volumeTracingMigrationService: VolumeTracingMigrationService,
                                    temporaryTracingService: TemporaryTracingService,
                                    val remoteDatastoreClient: TSRemoteDatastoreClient,
                                    tracingDataStore: TracingDataStore)
    extends KeyValueStoreImplicits
    with FallbackDataHelper
    with ProtoGeometryImplicits
    with AnnotationReversion
    with UpdateGroupHandling
    with LazyLogging {

  // two-level caching: outer key: annotation id; inner key version
  // This way we cache at most two versions of the same annotation, and at most 1000 different annotations
  private lazy val materializedAnnotationWithTracingCache =
    AlfuCache[String, AlfuCache[Long, AnnotationWithTracings]](maxCapacity = 1000)

  private def newInnerCache(implicit ec: ExecutionContext): Fox[AlfuCache[Long, AnnotationWithTracings]] =
    Fox.successful(AlfuCache[Long, AnnotationWithTracings](maxCapacity = 2))

  def get(annotationId: String, version: Option[Long])(implicit ec: ExecutionContext,
                                                       tc: TokenContext): Fox[AnnotationProto] =
    for {
      isTemporaryTracing <- temporaryTracingService.isTemporaryAnnotation(annotationId)
      annotation <- if (isTemporaryTracing) temporaryTracingService.getAnnotation(annotationId)
      else
        for {
          withTracings <- getWithTracings(annotationId, version) ?~> "annotation.notFound"
        } yield withTracings.annotation
    } yield annotation

  def getMultiple(annotationIds: Seq[String])(implicit ec: ExecutionContext,
                                              tc: TokenContext): Fox[Seq[AnnotationProto]] =
    Fox.serialCombined(annotationIds) { annotationId =>
      get(annotationId, None)
    }

  private def getWithTracings(annotationId: String, version: Option[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[AnnotationWithTracings] =
    for {
      newestMaterialized <- getNewestMaterialized(annotationId) ?~> "getNewestMaterialized.failed"
      targetVersion <- determineTargetVersion(annotationId, newestMaterialized, version) ?~> "determineTargetVersion.failed"
      // When requesting any other than the newest version, do not consider the changes final
      reportChangesToWk = version.isEmpty || version.contains(targetVersion)
      materializedAnnotationInnerCache <- materializedAnnotationWithTracingCache.getOrLoad(annotationId,
                                                                                           _ => newInnerCache)
      updatedAnnotation <- materializedAnnotationInnerCache.getOrLoad(
        targetVersion,
        _ => getWithTracingsVersioned(annotationId, targetVersion, reportChangesToWk = reportChangesToWk)
      )
    } yield updatedAnnotation

  private def getWithTracingsVersioned(annotationId: String, version: Long, reportChangesToWk: Boolean)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[AnnotationWithTracings] =
    for {
      annotationWithVersion <- tracingDataStore.annotations.get(annotationId, Some(version))(
        fromProtoBytes[AnnotationProto]) ?~> "getAnnotation.failed"
      annotation = annotationWithVersion.value
      annotationWithTracings <- findTracingsForAnnotation(annotation) ?~> "findTracingsForAnnotation.failed"
      annotationWithTracingsAndMappings <- findEditableMappingsForAnnotation(
        annotationId,
        annotationWithTracings,
        annotation.version,
        version // Note: this targetVersion is used for the updater buffers, and is overwritten for each update group, see annotation.withNewUpdaters
      ) ?~> "findEditableMappingsForAnnotation.failed"
      updated <- applyPendingUpdates(annotationWithTracingsAndMappings, annotationId, version, reportChangesToWk) ?~> "applyUpdates.failed"
    } yield updated

  def currentMaterializableVersion(annotationId: String): Fox[Long] =
    tracingDataStore.annotationUpdates.getVersion(annotationId, mayBeEmpty = Some(true), emptyFallback = Some(0L))

  def currentMaterializedVersion(annotationId: String): Fox[Long] =
    tracingDataStore.annotations.getVersion(annotationId, mayBeEmpty = Some(true), emptyFallback = Some(0L))

  private def getNewestMaterialized(annotationId: String): Fox[AnnotationProto] =
    for {
      keyValuePair <- tracingDataStore.annotations.get[AnnotationProto](annotationId, mayBeEmpty = Some(true))(
        fromProtoBytes[AnnotationProto]) ?~> "getAnnotation.failed"
    } yield keyValuePair.value

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
          Fox.successful(annotationWithTracings.deleteLayer(a))
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
          revertToVersion(annotationId, annotationWithTracings, a, targetVersion)
        case _: ResetToBaseAnnotationAction =>
          resetToBase(annotationId, annotationWithTracings, targetVersion)
        case _: BucketMutatingVolumeUpdateAction =>
          Fox.successful(annotationWithTracings) // No-op, as bucket-mutating actions are performed eagerly, so not here.
        case _: CompactVolumeUpdateAction =>
          Fox.successful(annotationWithTracings) // No-op, as legacy compacted update actions cannot be applied
        case _: UpdateTdCameraAnnotationAction =>
          Fox.successful(annotationWithTracings) // No-op, exists just to mark these updates in the history / count times
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
    // Note: works only if revert actions are in separate update groups
    for {
      _ <- bool2Fox(revertAction.sourceVersion >= annotationWithTracings.annotation.earliestAccessibleVersion) ?~> f"Trying to revert to ${revertAction.sourceVersion}, but earliest accessible is ${annotationWithTracings.annotation.earliestAccessibleVersion}"
      before = Instant.now
      sourceAnnotation: AnnotationWithTracings <- getWithTracings(annotationId, Some(revertAction.sourceVersion))
      _ <- revertDistributedElements(annotationWithTracings, sourceAnnotation, revertAction.sourceVersion, newVersion)
      _ = Instant.logSince(
        before,
        s"Reverting annotation $annotationId from v${annotationWithTracings.version} to v${revertAction.sourceVersion}")
    } yield sourceAnnotation

  private def resetToBase(annotationId: String, annotationWithTracings: AnnotationWithTracings, newVersion: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[AnnotationWithTracings] = {
    // Note: works only if reset actions are in separate update groups
    val sourceVersion = 0L // Tasks are always created with as v0 currently
    val before = Instant.now
    for {
      sourceAnnotation: AnnotationWithTracings <- getWithTracings(annotationId, Some(sourceVersion))
      _ <- revertDistributedElements(annotationWithTracings, sourceAnnotation, sourceVersion, newVersion)
      _ = Instant.logSince(before, s"Resetting annotation $annotationId to base (v$sourceVersion)")
    } yield sourceAnnotation
  }

  def saveAnnotationProto(annotationId: String,
                          version: Long,
                          annotationProto: AnnotationProto,
                          toTemporaryStore: Boolean = false): Fox[Unit] =
    if (toTemporaryStore)
      temporaryTracingService.saveAnnotationProto(annotationId, annotationProto)
    else
      tracingDataStore.annotations.put(annotationId, version, annotationProto)

  def updateActionLog(annotationId: String, newestVersion: Long, oldestVersion: Long)(
      implicit ec: ExecutionContext): Fox[JsValue] = {
    def versionedTupleToJson(tuple: (Long, List[UpdateAction])): JsObject =
      Json.obj(
        "version" -> tuple._1,
        "value" -> Json.toJson(tuple._2)
      )

    val batchRanges = SequenceUtils.batchRangeInclusive(oldestVersion, newestVersion, batchSize = 1000).reverse
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

  def findEditableMappingInfo(annotationId: String, tracingId: String, version: Option[Long] = None)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[EditableMappingInfo] =
    for {
      annotation <- getWithTracings(annotationId, version) ?~> "getWithTracings.failed"
      tracing <- annotation.getEditableMappingInfo(tracingId) ?~> "getEditableMapping.failed"
    } yield tracing

  private def addEditableMapping(
      annotationId: String,
      annotationWithTracings: AnnotationWithTracings,
      action: UpdateMappingNameVolumeAction,
      targetVersion: Long)(implicit tc: TokenContext, ec: ExecutionContext): Fox[AnnotationWithTracings] =
    for {
      volumeTracing <- annotationWithTracings.getVolume(action.actionTracingId).toFox
      _ <- assertMappingIsNotLocked(volumeTracing)
      baseMappingName <- volumeTracing.mappingName.toFox ?~> "makeEditable.failed.noBaseMapping"
      _ <- bool2Fox(volumeTracingService.volumeBucketsAreEmpty(action.actionTracingId)) ?~> "annotation.volumeBucketsNotEmpty"
      editableMappingInfo = editableMappingService.create(baseMappingName)
      updater <- editableMappingUpdaterFor(annotationId,
                                           action.actionTracingId,
                                           volumeTracing,
                                           editableMappingInfo,
                                           annotationWithTracings.version,
                                           targetVersion)
    } yield annotationWithTracings.addEditableMapping(action.actionTracingId, editableMappingInfo, updater)

  private def assertMappingIsNotLocked(volumeTracing: VolumeTracing)(implicit ec: ExecutionContext): Fox[Unit] =
    bool2Fox(!volumeTracing.mappingIsLocked.getOrElse(false)) ?~> "annotation.mappingIsLocked"

  private def applyPendingUpdates(
      annotationWithTracingsAndMappings: AnnotationWithTracings,
      annotationId: String,
      targetVersion: Long,
      reportChangesToWk: Boolean)(implicit ec: ExecutionContext, tc: TokenContext): Fox[AnnotationWithTracings] =
    for {
      updateGroupsAsSaved <- findPendingUpdates(annotationId, annotationWithTracingsAndMappings.version, targetVersion) ?~> "findPendingUpdates.failed"
      updatesGroupsRegrouped = regroupByIsolationSensitiveActions(updateGroupsAsSaved)
      updated <- applyUpdatesGrouped(annotationWithTracingsAndMappings,
                                     annotationId,
                                     updatesGroupsRegrouped,
                                     reportChangesToWk) ?~> "applyUpdates.inner.failed"
    } yield updated

  private def findPendingUpdates(annotationId: String, existingVersion: Long, desiredVersion: Long)(
      implicit ec: ExecutionContext): Fox[List[(Long, List[UpdateAction])]] =
    if (desiredVersion == existingVersion) Fox.successful(List())
    else {
      tracingDataStore.annotationUpdates.getMultipleVersionsAsVersionValueTuple(
        annotationId,
        Some(desiredVersion),
        Some(existingVersion + 1))(fromJsonBytes[List[UpdateAction]])
    }

  private def findTracingsForAnnotation(annotation: AnnotationProto)(
      implicit ec: ExecutionContext): Fox[AnnotationWithTracings] = {
    val skeletonTracingIds =
      annotation.annotationLayers.filter(_.`type` == AnnotationLayerTypeProto.Skeleton).map(_.tracingId)
    val volumeTracingIds =
      annotation.annotationLayers.filter(_.`type` == AnnotationLayerTypeProto.Volume).map(_.tracingId)
    for {
      skeletonTracings <- Fox.serialCombined(skeletonTracingIds.toList)(id =>
        findSkeletonRaw(id, Some(annotation.version))) ?~> "findSkeletonRaw.failed"
      volumeTracings <- Fox.serialCombined(volumeTracingIds.toList)(id => findVolumeRaw(id, Some(annotation.version))) ?~> "findVolumeRaw.failed"
      skeletonTracingsMap: Map[String, Either[SkeletonTracing, VolumeTracing]] = skeletonTracingIds
        .zip(skeletonTracings.map(versioned => Left[SkeletonTracing, VolumeTracing](versioned.value)))
        .toMap
      volumeTracingsMap: Map[String, Either[SkeletonTracing, VolumeTracing]] = volumeTracingIds
        .zip(volumeTracings.map(versioned => Right[SkeletonTracing, VolumeTracing](versioned.value)))
        .toMap
    } yield AnnotationWithTracings(annotation, skeletonTracingsMap ++ volumeTracingsMap, Map.empty)
  }

  private def findEditableMappingsForAnnotation(
      annotationId: String,
      annotationWithTracings: AnnotationWithTracings,
      currentMaterializedVersion: Long,
      targetVersion: Long)(implicit ec: ExecutionContext, tc: TokenContext) = {
    val volumeWithEditableMapping = annotationWithTracings.volumesThatHaveEditableMapping
    for {
      idInfoUpdaterTuples <- Fox.serialCombined(volumeWithEditableMapping) {
        case (volumeTracing, volumeTracingId) =>
          for {
            editableMappingInfo <- getEditableMappingInfoRaw(volumeTracingId, annotationWithTracings.version) ?~> "getEditableMappingInfoRaw.failed"
            updater <- editableMappingUpdaterFor(annotationId,
                                                 volumeTracingId,
                                                 volumeTracing,
                                                 editableMappingInfo.value,
                                                 currentMaterializedVersion,
                                                 targetVersion) ?~> "EditableMappingUpdater.initialize.failed"
          } yield (editableMappingInfo.key, (editableMappingInfo.value, updater))
      }
    } yield annotationWithTracings.copy(editableMappingsByTracingId = idInfoUpdaterTuples.toMap)
  }

  private def getEditableMappingInfoRaw(volumeTracingId: String,
                                        version: Long): Fox[VersionedKeyValuePair[EditableMappingInfo]] =
    tracingDataStore.editableMappingsInfo.get(volumeTracingId, version = Some(version))(
      fromProtoBytes[EditableMappingInfo])

  private def editableMappingUpdaterFor(annotationId: String,
                                        tracingId: String,
                                        remoteFallbackLayer: RemoteFallbackLayer,
                                        editableMappingInfo: EditableMappingInfo,
                                        currentMaterializedVersion: Long,
                                        targetVersion: Long)(implicit tc: TokenContext): EditableMappingUpdater =
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
      tracingDataStore
    )

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
      editableMappingUpdaterFor(annotationId,
                                tracingId,
                                remoteFallbackLayer,
                                editableMappingInfo,
                                currentMaterializedVersion,
                                targetVersion)

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
      annotationWithTracings: AnnotationWithTracings,
      annotationId: String,
      updates: List[UpdateAction],
      targetVersion: Long,
      reportChangesToWk: Boolean)(implicit ec: ExecutionContext, tc: TokenContext): Fox[AnnotationWithTracings] = {

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

    if (updates.isEmpty) Full(annotationWithTracings)
    else {
      for {
        updated <- updateIter(
          Some(annotationWithTracings.withNewUpdaters(annotationWithTracings.version, targetVersion)),
          updates)
        updatedWithNewVerson = updated.withVersion(targetVersion)
        _ <- updatedWithNewVerson.flushBufferedUpdates()
        _ <- flushUpdatedTracings(updatedWithNewVerson, updates)
        _ <- flushAnnotationInfo(annotationId, updatedWithNewVerson)
        _ <- Fox.runIf(reportChangesToWk && annotationWithTracings.annotation != updated.annotation)(
          remoteWebknossosClient.updateAnnotation(annotationId, updatedWithNewVerson.annotation))
      } yield updatedWithNewVerson
    }
  }

  private def flushUpdatedTracings(annotationWithTracings: AnnotationWithTracings, updates: List[UpdateAction])(
      implicit ec: ExecutionContext) = {
    // Flush updated tracing objects, but only if they were updated.
    // If they weren’t updated, the older versions that will automatically be fetched are guaranteed identical
    val allMayHaveUpdates = updates.exists { update: UpdateAction =>
      update match {
        case _: RevertToVersionAnnotationAction => true
        case _: ResetToBaseAnnotationAction     => true
        case _                                  => false
      }
    }
    val tracingIdsWithUpdates: Set[String] = updates.flatMap {
      case a: LayerUpdateAction        => Some(a.actionTracingId)
      case a: AddLayerAnnotationAction => a.tracingId // tracingId is an option, but filled on save. Drop Nones
      case _                           => None
    }.toSet
    for {
      _ <- Fox.serialCombined(annotationWithTracings.getVolumes) {
        case (volumeTracingId, volumeTracing) if allMayHaveUpdates || tracingIdsWithUpdates.contains(volumeTracingId) =>
          tracingDataStore.volumes.put(volumeTracingId, volumeTracing.version, volumeTracing)
        case _ => Fox.successful(())
      }
      _ <- Fox.serialCombined(annotationWithTracings.getSkeletons) {
        case (skeletonTracingId, skeletonTracing: SkeletonTracing)
            if allMayHaveUpdates || tracingIdsWithUpdates.contains(skeletonTracingId) =>
          tracingDataStore.skeletons.put(skeletonTracingId, skeletonTracing.version, skeletonTracing)
        case _ => Fox.successful(())
      }
      _ <- Fox.serialCombined(annotationWithTracings.getEditableMappingsInfo) {
        case (volumeTracingId, editableMappingInfo)
            if allMayHaveUpdates || tracingIdsWithUpdates.contains(volumeTracingId) =>
          tracingDataStore.editableMappingsInfo.put(volumeTracingId,
                                                    annotationWithTracings.version,
                                                    editableMappingInfo)
        case _ => Fox.successful(())
      }
    } yield ()
  }

  private def flushAnnotationInfo(annotationId: String, annotationWithTracings: AnnotationWithTracings) =
    saveAnnotationProto(annotationId, annotationWithTracings.version, annotationWithTracings.annotation)

  private def determineTargetVersion(annotationId: String,
                                     newestMaterializedAnnotation: AnnotationProto,
                                     requestedVersionOpt: Option[Long]): Fox[Long] =
    /*
     * Determines the newest saved version from the updates column.
     * if there are no updates at all, assume annotation is brand new (possibly created from NML,
     * hence the emptyFallbck newestMaterializedAnnotation.version)
     */
    for {
      newestUpdateVersion <- tracingDataStore.annotationUpdates.getVersion(annotationId,
                                                                           mayBeEmpty = Some(true),
                                                                           emptyFallback =
                                                                             Some(newestMaterializedAnnotation.version))
      targetVersion = requestedVersionOpt match {
        case None => newestUpdateVersion
        case Some(requestedVersion) =>
          math.max(newestMaterializedAnnotation.earliestAccessibleVersion,
                   math.min(requestedVersion, newestUpdateVersion))
      }
    } yield targetVersion

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

  def findVolumeRaw(tracingId: String, version: Option[Long] = None): Fox[VersionedKeyValuePair[VolumeTracing]] =
    tracingDataStore.volumes
      .get[VolumeTracing](tracingId, version, mayBeEmpty = Some(true))(fromProtoBytes[VolumeTracing])

  private def findSkeletonRaw(tracingId: String, version: Option[Long]): Fox[VersionedKeyValuePair[SkeletonTracing]] =
    tracingDataStore.skeletons
      .get[SkeletonTracing](tracingId, version, mayBeEmpty = Some(true))(fromProtoBytes[SkeletonTracing])

  def findVolume(annotationId: String, tracingId: String, version: Option[Long] = None)(
      implicit tc: TokenContext,
      ec: ExecutionContext): Fox[VolumeTracing] =
    for {
      isTemporaryTracing <- temporaryTracingService.isTemporaryTracing(tracingId)
      tracing <- if (isTemporaryTracing) temporaryTracingService.getVolume(tracingId)
      else
        for {
          annotation <- getWithTracings(annotationId, version)
          tracing <- annotation.getVolume(tracingId).toFox
          migrated <- volumeTracingMigrationService.migrateTracing(tracing)
        } yield migrated
    } yield tracing

  def findSkeleton(
      annotationId: String,
      tracingId: String,
      version: Option[Long] = None
  )(implicit tc: TokenContext, ec: ExecutionContext): Fox[SkeletonTracing] =
    if (tracingId == TracingId.dummy)
      Fox.successful(skeletonTracingService.dummyTracing)
    else {
      for {
        isTemporaryTracing <- temporaryTracingService.isTemporaryTracing(tracingId)
        tracing <- if (isTemporaryTracing) temporaryTracingService.getSkeleton(tracingId)
        else
          for {
            annotation <- getWithTracings(annotationId, version)
            tracing <- annotation.getSkeleton(tracingId).toFox
            migrated <- skeletonTracingMigrationService.migrateTracing(tracing)
          } yield migrated
      } yield tracing
    }

  def findMultipleVolumes(selectors: Seq[Option[TracingSelector]])(
      implicit tc: TokenContext,
      ec: ExecutionContext): Fox[List[Option[VolumeTracing]]] =
    Fox.combined {
      selectors.map {
        case Some(selector) =>
          for {
            annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(selector.tracingId)
            tracing <- findVolume(annotationId, selector.tracingId, selector.version).map(Some(_))
          } yield tracing
        case None => Fox.successful(None)
      }
    }

  def findMultipleSkeletons(selectors: Seq[Option[TracingSelector]])(
      implicit tc: TokenContext,
      ec: ExecutionContext): Fox[List[Option[SkeletonTracing]]] =
    Fox.combined {
      selectors.map {
        case Some(selector) =>
          for {
            annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(selector.tracingId)
            tracing <- findSkeleton(annotationId, selector.tracingId, selector.version).map(Some(_))
          } yield tracing
        case None => Fox.successful(None)
      }
    }

  def duplicate(
      annotationId: String,
      newAnnotationId: String,
      version: Option[Long],
      isFromTask: Boolean,
      datasetBoundingBox: Option[BoundingBox])(implicit ec: ExecutionContext, tc: TokenContext): Fox[AnnotationProto] =
    for {
      v0Annotation <- get(annotationId, Some(0L))
      currentAnnotation <- get(annotationId, version)

      // Duplicate updates
      tracingIdMap <- duplicateUpdates(annotationId,
                                       newAnnotationId,
                                       v0Annotation.annotationLayers.map(_.tracingId),
                                       currentAnnotation.version)

      // Duplicate v0
      v0NewLayers <- Fox.serialCombined(v0Annotation.annotationLayers)(layer =>
        duplicateLayer(annotationId, layer, tracingIdMap, v0Annotation.version, isFromTask, datasetBoundingBox))
      v0DuplicatedAnnotation = v0Annotation.copy(annotationLayers = v0NewLayers,
                                                 earliestAccessibleVersion = v0Annotation.version)

      _ <- saveAnnotationProto(newAnnotationId, v0Annotation.version, v0DuplicatedAnnotation)

      // Duplicate current
      duplicatedAnnotation <- if (currentAnnotation.version > 0L) {
        for {
          newLayers <- Fox.serialCombined(currentAnnotation.annotationLayers)(
            layer =>
              duplicateLayer(annotationId,
                             layer,
                             tracingIdMap,
                             currentAnnotation.version,
                             isFromTask,
                             datasetBoundingBox))
          currentDuplicatedAnnotation = currentAnnotation.copy(annotationLayers = newLayers,
                                                               earliestAccessibleVersion = currentAnnotation.version)
          _ <- saveAnnotationProto(newAnnotationId, currentAnnotation.version, currentDuplicatedAnnotation)
        } yield currentDuplicatedAnnotation
      } else Fox.successful(v0DuplicatedAnnotation)

    } yield duplicatedAnnotation

  private def duplicateUpdates(annotationId: String,
                               newAnnotationId: String,
                               v0TracingIds: Seq[String],
                               newestVersion: Long)(implicit ec: ExecutionContext): Fox[Map[String, String]] = {
    val tracingIdMapMutable = scala.collection.mutable.Map[String, String]()
    v0TracingIds.foreach { v0TracingId =>
      tracingIdMapMutable.put(v0TracingId, TracingId.generate)
    }
    val updateBatchRanges = SequenceUtils.batchRangeInclusive(0L, newestVersion, batchSize = 100)
    Fox
      .serialCombined(updateBatchRanges.toList) { batchRange =>
        for {
          updateLists: Seq[(Long, List[UpdateAction])] <- tracingDataStore.annotationUpdates
            .getMultipleVersionsAsVersionValueTuple(
              annotationId,
              oldestVersion = Some(batchRange._1),
              newestVersion = Some(batchRange._2))(fromJsonBytes[List[UpdateAction]])
          _ <- Fox.serialCombined(updateLists) {
            case (version, updateList) =>
              for {
                updateListAdapted <- Fox.serialCombined(updateList) {
                  case a: AddLayerAnnotationAction =>
                    for {
                      actionTracingId <- a.tracingId ?~> "duplicating addLayer without tracingId"
                      _ = if (!tracingIdMapMutable.contains(actionTracingId)) {
                        a.tracingId.foreach(actionTracingId =>
                          tracingIdMapMutable.put(actionTracingId, TracingId.generate))
                      }
                      mappedTracingId <- tracingIdMapMutable.get(actionTracingId) ?~> "duplicating action for unknown layer"
                    } yield a.copy(tracingId = Some(mappedTracingId))
                  case a: LayerUpdateAction =>
                    for {
                      mappedTracingId <- tracingIdMapMutable.get(a.actionTracingId) ?~> "duplicating action for unknown layer"
                    } yield a.withActionTracingId(mappedTracingId)
                }
                _ <- tracingDataStore.annotationUpdates.put(newAnnotationId, version, Json.toJson(updateListAdapted))
              } yield ()
          }
        } yield ()
      }
      .map(_ => tracingIdMapMutable.toMap)
  }

  private def duplicateLayer(annotationId: String,
                             layer: AnnotationLayerProto,
                             tracingIdMap: Map[String, String],
                             version: Long,
                             isFromTask: Boolean,
                             datasetBoundingBox: Option[BoundingBox])(implicit ec: ExecutionContext,
                                                                      tc: TokenContext): Fox[AnnotationLayerProto] =
    for {
      newTracingId <- tracingIdMap.get(layer.tracingId) ?~> "duplicate unknown layer"
      _ <- layer.`type` match {
        case AnnotationLayerTypeProto.Volume =>
          duplicateVolumeTracing(annotationId,
                                 layer.tracingId,
                                 version,
                                 newTracingId,
                                 version,
                                 isFromTask,
                                 None,
                                 datasetBoundingBox,
                                 MagRestrictions.empty,
                                 None,
                                 None)
        case AnnotationLayerTypeProto.Skeleton =>
          duplicateSkeletonTracing(annotationId,
                                   layer.tracingId,
                                   version,
                                   newTracingId,
                                   version,
                                   isFromTask,
                                   None,
                                   None,
                                   None)
        case AnnotationLayerTypeProto.Unrecognized(num) => Fox.failure(f"unrecognized annotation layer type: $num")
      }
    } yield layer.copy(tracingId = newTracingId)

  def duplicateVolumeTracing(
      sourceAnnotationId: String,
      sourceTracingId: String,
      sourceVersion: Long,
      newTracingId: String,
      newVersion: Long,
      isFromTask: Boolean,
      boundingBox: Option[BoundingBox],
      datasetBoundingBox: Option[BoundingBox],
      magRestrictions: MagRestrictions,
      editPosition: Option[Vec3Int],
      editRotation: Option[Vec3Double])(implicit ec: ExecutionContext, tc: TokenContext): Fox[String] =
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
      newTracingId: String,
      newVersion: Long,
      isFromTask: Boolean,
      editPosition: Option[Vec3Int],
      editRotation: Option[Vec3Double],
      boundingBox: Option[BoundingBox])(implicit ec: ExecutionContext, tc: TokenContext): Fox[String] =
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

  def mergeEditableMappings(annotationIds: List[String],
                            newAnnotationId: String,
                            newVolumeTracingId: String,
                            tracingsWithIds: List[(VolumeTracing, String)],
                            toTemporaryStore: Boolean)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    if (tracingsWithIds.nonEmpty && tracingsWithIds.forall(tracingWithId => tracingWithId._1.getHasEditableMapping)) {
      for {
        before <- Instant.nowFox
        _ <- bool2Fox(!toTemporaryStore) ?~> "Cannot merge editable mappings to temporary store (trying to merge compound annotations?)"
        remoteFallbackLayers <- Fox.serialCombined(tracingsWithIds)(tracingWithId =>
          remoteFallbackLayerFromVolumeTracing(tracingWithId._1, tracingWithId._2))
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
          Fox.serialCombined(linearizedEditableMappingUpdates) { update: UpdateAction =>
            for {
              _ <- tracingDataStore.annotationUpdates.put(newVolumeTracingId, updateVersion, Json.toJson(List(update)))
              _ = updateVersion += 1
            } yield ()
          }
        }
        editableMappingInfo = editableMappingService.create(baseMappingName)
        updater = editableMappingUpdaterFor(newAnnotationId,
                                            newVolumeTracingId,
                                            remoteFallbackLayer,
                                            editableMappingInfo,
                                            0L,
                                            targetVersion)
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

}