package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.option2Fox
import com.scalableminds.webknossos.datastore.Annotation.{AnnotationLayerProto, AnnotationProto}
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayerType
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating.{
  CreateNodeSkeletonAction,
  DeleteNodeSkeletonAction,
  SkeletonUpdateAction,
  UpdateTracingSkeletonAction
}
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  ApplyableVolumeUpdateAction,
  BucketMutatingVolumeUpdateAction,
  UpdateBucketVolumeAction,
  VolumeTracingService,
  VolumeUpdateAction
}
import com.scalableminds.webknossos.tracingstore.tracings.{KeyValueStoreImplicits, TracingDataStore}
import com.scalableminds.webknossos.tracingstore.{TSRemoteWebknossosClient, TracingUpdatesReport}
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.libs.json.{JsObject, JsValue, Json}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class TSAnnotationService @Inject()(remoteWebknossosClient: TSRemoteWebknossosClient,
                                    tracingDataStore: TracingDataStore,
                                    volumeTracingService: VolumeTracingService)
    extends KeyValueStoreImplicits {

  def reportUpdates(annotationId: String, updateGroups: List[UpdateActionGroup], userToken: Option[String]): Fox[Unit] =
    for {
      _ <- remoteWebknossosClient.reportTracingUpdates(
        TracingUpdatesReport(
          annotationId,
          timestamps = updateGroups.map(g => Instant(g.timestamp)),
          statistics = updateGroups.flatMap(_.stats).lastOption,
          significantChangesCount = updateGroups.map(_.significantChangesCount).sum,
          viewChangesCount = updateGroups.map(_.viewChangesCount).sum,
          userToken
        ))
    } yield ()

  def currentVersion(annotationId: String): Fox[Long] = ???

  def handleUpdateGroup(annotationId: String, updateActionGroup: UpdateActionGroup, userToken: Option[String])(
      implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- tracingDataStore.annotationUpdates.put(annotationId,
                                                  updateActionGroup.version,
                                                  preprocessActionsForStorage(updateActionGroup))
      bucketMutatingActions = findBucketMutatingActions(updateActionGroup)
      _ <- Fox.runIf(bucketMutatingActions.nonEmpty)(
        volumeTracingService.applyBucketMutatingActions(bucketMutatingActions, updateActionGroup.version, userToken))
    } yield ()

  private def findBucketMutatingActions(updateActionGroup: UpdateActionGroup): List[BucketMutatingVolumeUpdateAction] =
    updateActionGroup.actions.flatMap {
      case a: BucketMutatingVolumeUpdateAction => Some(a)
      case _                                   => None
    }

  private def preprocessActionsForStorage(updateActionGroup: UpdateActionGroup): List[UpdateAction] = {
    val actionsWithInfo = updateActionGroup.actions.map(
      _.addTimestamp(updateActionGroup.timestamp).addAuthorId(updateActionGroup.authorId)) match {
      case Nil => List[UpdateAction]()
      //to the first action in the group, attach the group's info
      case first :: rest => first.addInfo(updateActionGroup.info) :: rest
    }
    actionsWithInfo.map {
      case a: UpdateBucketVolumeAction => a.transformToCompact // TODO or not?
      case a                           => a
    }
  }

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

  private def applyUpdate(annotationWithTracings: AnnotationWithTracings, updateAction: UpdateAction)(
      implicit ec: ExecutionContext): Fox[AnnotationWithTracings] =
    for {
      updated <- updateAction match {
        case a: AddLayerAnnotationUpdateAction =>
          // TODO create tracing object (ask wk for needed parameters e.g. fallback layer info?)
          Fox.successful(annotationWithTracings.addTracing(a))
        case a: DeleteLayerAnnotationUpdateAction =>
          Fox.successful(annotationWithTracings.deleteTracing(a))
        case a: UpdateLayerMetadataAnnotationUpdateAction =>
          Fox.successful(annotationWithTracings.updateLayerMetadata(a))
        case a: UpdateMetadataAnnotationUpdateAction =>
          Fox.successful(annotationWithTracings.updateMetadata(a))
        case a: SkeletonUpdateAction =>
          annotationWithTracings.applySkeletonAction(a)
        case a: ApplyableVolumeUpdateAction =>
          annotationWithTracings.applyVolumeAction(a)
        case _ => Fox.failure("Received unsupported AnnotationUpdateAction action")
      }
    } yield updated

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

  def get(annotationId: String, version: Option[Long], applyUpdates: Boolean, userToken: Option[String])(
      implicit ec: ExecutionContext): Fox[AnnotationProto] =
    for {
      annotationWithVersion <- tracingDataStore.annotations.get(annotationId, version)(fromProtoBytes[AnnotationProto])
      annotation = annotationWithVersion.value
      updated <- if (applyUpdates) applyPendingUpdates(annotation, annotationId, version, userToken)
      else Fox.successful(annotation)
    } yield updated

  private def applyPendingUpdates(annotation: AnnotationProto,
                                  annotationId: String,
                                  targetVersionOpt: Option[Long],
                                  userToken: Option[String])(implicit ec: ExecutionContext): Fox[AnnotationProto] =
    for {
      targetVersion <- determineTargetVersion(annotation, annotationId, targetVersionOpt)
      updates <- findPendingUpdates(annotationId, annotation.version, targetVersion)
      annotationWithTracings <- findTracingsForUpdates(annotation, updates)
      updated <- applyUpdates(annotationWithTracings, annotationId, updates, targetVersion, userToken)
    } yield updated.annotation

  private def findTracingsForUpdates(annotation: AnnotationProto, updates: List[UpdateAction])(
      implicit ec: ExecutionContext): Fox[AnnotationWithTracings] = {
    val skeletonTracingIds = updates.flatMap {
      case u: SkeletonUpdateAction => Some(u.actionTracingId)
      case _                       => None
    }
    val volumeTracingIds = updates.flatMap {
      case u: VolumeUpdateAction => Some(u.actionTracingId)
      case _                     => None
    }
    for {
      skeletonTracings <- Fox.serialCombined(skeletonTracingIds)(
        id =>
          tracingDataStore.skeletons.get[SkeletonTracing](id, Some(annotation.version), mayBeEmpty = Some(true))(
            fromProtoBytes[SkeletonTracing]))
      volumeTracings <- Fox.serialCombined(volumeTracingIds)(
        id =>
          tracingDataStore.volumes
            .get[VolumeTracing](id, Some(annotation.version), mayBeEmpty = Some(true))(fromProtoBytes[VolumeTracing]))
      skeletonTracingsMap: Map[String, Either[SkeletonTracing, VolumeTracing]] = skeletonTracingIds
        .zip(skeletonTracings.map(versioned => Left[SkeletonTracing, VolumeTracing](versioned.value)))
        .toMap
      volumeTracingsMap: Map[String, Either[SkeletonTracing, VolumeTracing]] = volumeTracingIds
        .zip(volumeTracings.map(versioned => Right[SkeletonTracing, VolumeTracing](versioned.value)))
        .toMap
    } yield AnnotationWithTracings(annotation, skeletonTracingsMap ++ volumeTracingsMap)
  }

  private def applyUpdates(annotation: AnnotationWithTracings,
                           annotationId: String,
                           updates: List[UpdateAction],
                           targetVersion: Long,
                           userToken: Option[String])(implicit ec: ExecutionContext): Fox[AnnotationWithTracings] = {

    def updateIter(annotationWithTracingsFox: Fox[AnnotationWithTracings],
                   remainingUpdates: List[UpdateAction]): Fox[AnnotationWithTracings] =
      annotationWithTracingsFox.futureBox.flatMap {
        case Empty => Fox.empty
        case Full(annotationWithTracings) =>
          remainingUpdates match {
            case List() => Fox.successful(annotationWithTracings)
            case RevertToVersionUpdateAction(sourceVersion, _, _, _) :: tail =>
              ???
            case update :: tail => updateIter(applyUpdate(annotationWithTracings, update), tail)
          }
        case _ => annotationWithTracingsFox
      }

    if (updates.isEmpty) Full(annotation)
    else {
      for {
        updated <- updateIter(Some(annotation), updates)
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
