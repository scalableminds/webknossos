package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.webknossos.datastore.Annotation.{
  AnnotationLayerProto,
  AnnotationProto,
  AnnotationUserStateProto
}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.EditableMappingInfo.EditableMappingInfo
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.datastore.models.annotation.{AnnotationLayer, AnnotationLayerType}
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.{
  EditableMappingUpdateAction,
  EditableMappingUpdater
}
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.SkeletonTracingWithUpdatedTreeIds
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating.SkeletonUpdateAction
import com.scalableminds.webknossos.tracingstore.tracings.volume.ApplyableVolumeUpdateAction
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Failure, Full}

import scala.concurrent.ExecutionContext

case class AnnotationWithTracings(
    annotation: AnnotationProto,
    tracingsById: Map[String, Either[SkeletonTracingWithUpdatedTreeIds, VolumeTracing]],
    editableMappingsByTracingId: Map[String, (EditableMappingInfo, EditableMappingUpdater)])
    extends LazyLogging
    with FoxImplicits
    with ProtoGeometryImplicits {

  // Assumes that there is at most one skeleton layer per annotation. This is true as of this writing
  def getSkeletonId: Option[String] =
    getSkeletons.headOption.map(_._1)

  def getSkeleton(tracingId: String): Box[SkeletonTracing] =
    for {
      tracingEither <- tracingsById.get(tracingId)
      skeletonTracing <- tracingEither match {
        case Left(SkeletonTracingWithUpdatedTreeIds(skeletonTracing, _)) => Full(skeletonTracing)
        case _                                                           => Failure(f"Tried to access tracing $tracingId as skeleton, but is volume")
      }
    } yield skeletonTracing

  def getSkeletons: List[(String, SkeletonTracing)] =
    tracingsById.view.flatMap {
      case (id, Left(SkeletonTracingWithUpdatedTreeIds(skeletonTracing, _))) => Some(id, skeletonTracing)
      case _                                                                 => None
    }.toList

  def getUpdatedTreeBodyIdsForSkeleton(tracingId: String): Box[Set[Int]] =
    for {
      tracingEither <- tracingsById.get(tracingId)
      updatedTreeIds <- tracingEither match {
        case Left(SkeletonTracingWithUpdatedTreeIds(_, updatedTreeIds)) => Full(updatedTreeIds)
        case _                                                          => Failure(f"Tried to access tracing $tracingId as skeleton to access updated tree ids, but is volume")
      }
    } yield updatedTreeIds

  def getVolumes: List[(String, VolumeTracing)] =
    tracingsById.view.flatMap {
      case (id, Right(vt: VolumeTracing)) => Some(id, vt)
      case _                              => None
    }.toList

  def getVolume(tracingId: String): Box[VolumeTracing] =
    for {
      tracingEither <- tracingsById.get(tracingId)
      volumeTracing <- tracingEither match {
        case Right(vt: VolumeTracing) => Full(vt)
        case _                        => Failure(f"Tried to access tracing $tracingId as volume, but is skeleton")
      }
    } yield volumeTracing

  def volumesThatHaveEditableMapping: List[(VolumeTracing, String)] =
    tracingsById.view.flatMap {
      case (id, Right(vt: VolumeTracing)) if vt.getHasEditableMapping => Some((vt, id))
      case _                                                          => None
    }.toList

  def getEditableMappingTracingIds: List[String] = editableMappingsByTracingId.keys.toList

  def getEditableMappingsInfo: List[(String, EditableMappingInfo)] =
    editableMappingsByTracingId.view.flatMap {
      case (id, (info: EditableMappingInfo, _)) => Some(id, info)
      case _                                    => None
    }.toList

  def getEditableMappingInfo(tracingId: String): Option[EditableMappingInfo] =
    for {
      (info, _) <- editableMappingsByTracingId.get(tracingId)
    } yield info

  def getEditableMappingUpdater(tracingId: String): Option[EditableMappingUpdater] =
    for {
      (_, updater) <- editableMappingsByTracingId.get(tracingId)
    } yield updater

  def version: Long = annotation.version

  def addLayer(a: AddLayerAnnotationAction,
               tracingId: String,
               tracing: Either[SkeletonTracingWithUpdatedTreeIds, VolumeTracing]): AnnotationWithTracings =
    this.copy(
      annotation = annotation.copy(
        annotationLayers = annotation.annotationLayers :+ AnnotationLayerProto(
          tracingId,
          a.layerParameters.name.getOrElse(AnnotationLayer.defaultNameForType(a.layerParameters.typ)),
          typ = AnnotationLayerType.toProto(a.layerParameters.typ)
        )),
      tracingsById = tracingsById.updated(tracingId, tracing)
    )

  def deleteLayer(a: DeleteLayerAnnotationAction): AnnotationWithTracings =
    this.copy(
      annotation = annotation.copy(annotationLayers = annotation.annotationLayers.filter(_.tracingId != a.tracingId)),
      tracingsById = tracingsById.removed(a.tracingId),
      editableMappingsByTracingId = editableMappingsByTracingId.removed(a.tracingId)
    )

  def updateLayerMetadata(a: UpdateLayerMetadataAnnotationAction): AnnotationWithTracings =
    this.copy(annotation = annotation.copy(annotationLayers = annotation.annotationLayers.map(l =>
      if (l.tracingId == a.tracingId) l.copy(name = a.layerName) else l)))

  def updateMetadata(a: UpdateMetadataAnnotationAction): AnnotationWithTracings =
    a.description.map { newDescription =>
      this.copy(annotation = annotation.copy(description = newDescription))
    }.getOrElse(this)

  def updateCamera(a: UpdateCameraAnnotationAction): AnnotationWithTracings =
    a.actionAuthorId match {
      case None => this
      case Some(actionUserId) =>
        val userStateAlreadyPresent = annotation.userStates.exists(state => actionUserId == state.userId)
        if (userStateAlreadyPresent) {
          this.copy(annotation = annotation.copy(userStates = annotation.userStates.map { userState =>
            if (actionUserId == userState.userId)
              userState.copy(
                userId = actionUserId,
                editPosition = a.editPosition,
                editRotation = a.editRotation,
                zoomLevel = a.zoomLevel,
                editPositionAdditionalCoordinates = AdditionalCoordinate.toProto(a.editPositionAdditionalCoordinates),
              )
            else userState
          }))
        } else
          this.copy(
            annotation = annotation.copy(userStates = annotation.userStates :+ AnnotationUserStateProto(
              userId = actionUserId,
              editPosition = a.editPosition,
              editRotation = a.editRotation,
              zoomLevel = a.zoomLevel,
              editPositionAdditionalCoordinates = AdditionalCoordinate.toProto(a.editPositionAdditionalCoordinates),
            )))
    }

  def withVersion(newVersion: Long): AnnotationWithTracings = {
    val tracingsUpdated = tracingsById.view.mapValues {
      case Left(t: SkeletonTracingWithUpdatedTreeIds) =>
        Left(t.withVersion(newVersion))
      case Right(t: VolumeTracing) => Right(t.withVersion(newVersion))
    }
    this.copy(
      annotation = annotation.copy(version = newVersion,
                                   skeletonMayHavePendingUpdates = None,
                                   editableMappingsMayHavePendingUpdates = None),
      tracingsById = tracingsUpdated.toMap
    )
  }

  def withNewUpdaters(materializedVersion: Long, targetVersion: Long): AnnotationWithTracings = {
    val editableMappingsUpdated = editableMappingsByTracingId.view.mapValues {
      case (mapping, updater) => (mapping, updater.newWithTargetVersion(materializedVersion, targetVersion))
    }
    this.copy(editableMappingsByTracingId = editableMappingsUpdated.toMap)
  }

  def addEditableMapping(volumeTracingId: String,
                         editableMappingInfo: EditableMappingInfo,
                         updater: EditableMappingUpdater): AnnotationWithTracings =
    this.copy(editableMappingsByTracingId =
      editableMappingsByTracingId.updated(volumeTracingId, (editableMappingInfo, updater)))

  def applySkeletonAction(a: SkeletonUpdateAction): Box[AnnotationWithTracings] =
    for {
      skeletonTracing <- getSkeleton(a.actionTracingId)
      previousUpdatedTreeIds <- getUpdatedTreeBodyIdsForSkeleton(a.actionTracingId)
      updated = a.applyOn(skeletonTracing)
      newUpdatedTreeIds = previousUpdatedTreeIds.concat(a.updatedTreeBodyIds)
    } yield
      this.copy(
        tracingsById =
          tracingsById.updated(a.actionTracingId, Left(SkeletonTracingWithUpdatedTreeIds(updated, newUpdatedTreeIds))))

  def applyVolumeAction(a: ApplyableVolumeUpdateAction): Box[AnnotationWithTracings] =
    for {
      volumeTracing <- getVolume(a.actionTracingId)
      updated = a.applyOn(volumeTracing)
    } yield this.copy(tracingsById = tracingsById.updated(a.actionTracingId, Right(updated)))

  def applyEditableMappingAction(a: EditableMappingUpdateAction)(
      implicit ec: ExecutionContext): Fox[AnnotationWithTracings] =
    for {
      updater: EditableMappingUpdater <- getEditableMappingUpdater(a.actionTracingId).toFox
      info <- getEditableMappingInfo(a.actionTracingId).toFox
      updated <- updater.applyOneUpdate(info, a)
    } yield
      this.copy(
        editableMappingsByTracingId = editableMappingsByTracingId.updated(a.actionTracingId, (updated, updater)))

  def flushEditableMappingUpdaterBuffers()(implicit ec: ExecutionContext): Fox[Unit] = {
    val updaters = editableMappingsByTracingId.values.map(_._2).toList
    for {
      _ <- Fox.serialCombined(updaters)(updater => updater.flushBuffersToFossil())
    } yield ()
  }

  def markAllTreeBodiesAsChanged: AnnotationWithTracings = {
    val newTracingsById = tracingsById.view.map {
      case (id, Left(st: SkeletonTracingWithUpdatedTreeIds)) =>
        (id, Left[SkeletonTracingWithUpdatedTreeIds, VolumeTracing](st.markAllTreeBodiesAsChanged))
      case other => other
    }.toMap
    this.copy(tracingsById = newTracingsById)
  }

}
