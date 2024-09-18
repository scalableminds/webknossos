package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.Annotation.{AnnotationLayerProto, AnnotationProto}
import com.scalableminds.webknossos.datastore.EditableMappingInfo.EditableMappingInfo
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.annotation.{AnnotationLayer, AnnotationLayerType}
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.{
  EditableMappingUpdateAction,
  EditableMappingUpdater
}
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating.SkeletonUpdateAction
import com.scalableminds.webknossos.tracingstore.tracings.volume.ApplyableVolumeUpdateAction
import net.liftweb.common.{Box, Failure, Full}

import scala.concurrent.ExecutionContext

case class AnnotationWithTracings(
    annotation: AnnotationProto,
    tracingsById: Map[String, Either[SkeletonTracing, VolumeTracing]],
    editableMappingsByTracingId: Map[String, (EditableMappingInfo, EditableMappingUpdater)]) {

  def getSkeleton(tracingId: String): Box[SkeletonTracing] =
    for {
      tracingEither <- tracingsById.get(tracingId)
      skeletonTracing <- tracingEither match {
        case Left(st: SkeletonTracing) => Full(st)
        case _                         => Failure(f"Tried to access tracing $tracingId as skeleton, but is volume")
      }
    } yield skeletonTracing

  def getVolume(tracingId: String): Box[VolumeTracing] =
    for {
      tracingEither <- tracingsById.get(tracingId)
      volumeTracing <- tracingEither match {
        case Right(vt: VolumeTracing) => Full(vt)
        case _                        => Failure(f"Tried to access tracing $tracingId as volume, but is skeleton")
      }
    } yield volumeTracing

  def volumesIdsThatHaveEditableMapping: List[String] =
    tracingsById.view.flatMap {
      case (id, Right(vt: VolumeTracing)) if vt.getHasEditableMapping => Some(id)
      case _                                                          => None
    }.toList

  def getEditableMappingInfo(tracingId: String): Box[EditableMappingInfo] =
    for {
      (info, _) <- editableMappingsByTracingId.get(tracingId)
    } yield info

  def getEditableMappingUpdater(tracingId: String): Option[EditableMappingUpdater] =
    for {
      (_, updater) <- editableMappingsByTracingId.get(tracingId)
    } yield updater

  def version: Long = annotation.version

  def addTracing(a: AddLayerAnnotationUpdateAction): AnnotationWithTracings =
    AnnotationWithTracings(
      annotation.copy(
        layers = annotation.layers :+ AnnotationLayerProto(
          a.tracingId,
          a.layerParameters.name.getOrElse(AnnotationLayer.defaultNameForType(a.layerParameters.typ)),
          `type` = AnnotationLayerType.toProto(a.layerParameters.typ)
        )),
      tracingsById,
      editableMappingsByTracingId
    )

  def deleteTracing(a: DeleteLayerAnnotationUpdateAction): AnnotationWithTracings =
    AnnotationWithTracings(annotation.copy(layers = annotation.layers.filter(_.tracingId != a.tracingId)),
                           tracingsById,
                           editableMappingsByTracingId)

  def updateLayerMetadata(a: UpdateLayerMetadataAnnotationUpdateAction): AnnotationWithTracings =
    AnnotationWithTracings(annotation.copy(layers = annotation.layers.map(l =>
                             if (l.tracingId == a.tracingId) l.copy(name = a.layerName) else l)),
                           tracingsById,
                           editableMappingsByTracingId)

  def updateMetadata(a: UpdateMetadataAnnotationUpdateAction): AnnotationWithTracings =
    AnnotationWithTracings(annotation.copy(name = a.name, description = a.description),
                           tracingsById,
                           editableMappingsByTracingId)

  def incrementVersion: AnnotationWithTracings =
    AnnotationWithTracings(annotation.copy(version = annotation.version + 1L),
                           tracingsById,
                           editableMappingsByTracingId)

  def withVersion(newVersion: Long): AnnotationWithTracings = {
    val tracingsUpdated = tracingsById.view.mapValues {
      case Left(t: SkeletonTracing) => Left(t.withVersion(newVersion))
      case Right(t: VolumeTracing)  => Right(t.withVersion(newVersion))
    }
    AnnotationWithTracings(annotation.copy(version = newVersion), tracingsUpdated.toMap, editableMappingsByTracingId)
  }

  def applySkeletonAction(a: SkeletonUpdateAction)(implicit ec: ExecutionContext): Fox[AnnotationWithTracings] =
    for {
      skeletonTracing <- getSkeleton(a.actionTracingId)
      updated = a.applyOn(skeletonTracing)
    } yield
      AnnotationWithTracings(annotation,
                             tracingsById.updated(a.actionTracingId, Left(updated)),
                             editableMappingsByTracingId)

  def applyVolumeAction(a: ApplyableVolumeUpdateAction)(implicit ec: ExecutionContext): Fox[AnnotationWithTracings] =
    for {
      volumeTracing <- getVolume(a.actionTracingId)
      updated = a.applyOn(volumeTracing)
    } yield
      AnnotationWithTracings(annotation,
                             tracingsById.updated(a.actionTracingId, Right(updated)),
                             editableMappingsByTracingId)

  def applyEditableMappingAction(a: EditableMappingUpdateAction)(
      implicit ec: ExecutionContext): Fox[AnnotationWithTracings] =
    for {
      updater <- getEditableMappingUpdater("tracingId") // TODO editable mapping update actions need tracing id
    } yield this // TODO
}
