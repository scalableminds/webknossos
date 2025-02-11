package models.annotation

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.geometry.{
  AdditionalCoordinateProto,
  NamedBoundingBoxProto,
  Vec3DoubleProto,
  Vec3IntProto
}
import com.scalableminds.webknossos.datastore.models.annotation.{
  AnnotationLayer,
  AnnotationLayerType,
  FetchedAnnotationLayer
}
import com.scalableminds.webknossos.tracingstore.tracings.volume.{VolumeDataZipFormat, VolumeTracingDefaults}
import models.dataset.Dataset

import scala.concurrent.ExecutionContext

// Used to pass duplicate properties when creating a new tracing to avoid masking them.
case class RedundantTracingProperties(
    editPosition: Vec3IntProto,
    editRotation: Vec3DoubleProto,
    zoomLevel: Double,
    userBoundingBoxes: Seq[NamedBoundingBoxProto],
    editPositionAdditionalCoordinates: Seq[AdditionalCoordinateProto]
)

trait AnnotationLayerPrecedence {

  protected def combineLargestSegmentIdsByPrecedence(
      fromNml: Option[Long],
      fromFallbackLayer: Option[Option[Long]]
  ): Option[Long] =
    if (fromNml.nonEmpty)
      // This was called for an NML upload. The NML had an explicit largestSegmentId. Use that.
      fromNml
    else if (fromFallbackLayer.nonEmpty)
      // There is a fallback layer. Use its largestSegmentId, even if it is None.
      // Some tracing functionality will be disabled until a segment id is set by the user.
      fromFallbackLayer.flatten
    else {
      // There is no fallback layer. Start at default segment id for fresh volume layers
      VolumeTracingDefaults.largestSegmentId
    }

  protected def adaptSkeletonTracing(
      skeletonTracing: SkeletonTracing,
      oldPrecedenceLayerProperties: Option[RedundantTracingProperties]
  ): SkeletonTracing =
    oldPrecedenceLayerProperties.map { (p: RedundantTracingProperties) =>
      skeletonTracing.copy(
        editPosition = p.editPosition,
        editRotation = p.editRotation,
        zoomLevel = p.zoomLevel,
        userBoundingBoxes = p.userBoundingBoxes,
        editPositionAdditionalCoordinates = p.editPositionAdditionalCoordinates
      )
    }.getOrElse(skeletonTracing)

  protected def adaptVolumeTracing(
      volumeTracing: VolumeTracing,
      oldPrecedenceLayerProperties: Option[RedundantTracingProperties]
  ): VolumeTracing =
    oldPrecedenceLayerProperties.map { (p: RedundantTracingProperties) =>
      volumeTracing.copy(
        editPosition = p.editPosition,
        editRotation = p.editRotation,
        zoomLevel = p.zoomLevel,
        userBoundingBoxes = p.userBoundingBoxes,
        editPositionAdditionalCoordinates = p.editPositionAdditionalCoordinates
      )
    }.getOrElse(volumeTracing)

  protected def getOldPrecedenceLayerProperties(
      existingAnnotationId: Option[ObjectId],
      existingAnnotationLayers: List[AnnotationLayer],
      previousVersion: Option[Long],
      dataset: Dataset,
      tracingStoreClient: WKRemoteTracingStoreClient
  )(implicit ec: ExecutionContext): Fox[Option[RedundantTracingProperties]] =
    for {
      oldPrecedenceLayer <- fetchOldPrecedenceLayer(
        existingAnnotationId,
        existingAnnotationLayers,
        previousVersion,
        dataset,
        tracingStoreClient
      )
      oldPrecedenceLayerProperties: Option[RedundantTracingProperties] = oldPrecedenceLayer.map(
        extractPrecedenceProperties
      )
    } yield oldPrecedenceLayerProperties

  // If there is more than one tracing, select the one that has precedence for the parameters (they should be identical anyway)
  protected def selectLayerWithPrecedenceFetched(
      skeletonLayers: List[FetchedAnnotationLayer],
      volumeLayers: List[FetchedAnnotationLayer]
  )(implicit ec: ExecutionContext): Fox[FetchedAnnotationLayer] =
    if (skeletonLayers.nonEmpty) {
      Fox.successful(skeletonLayers.minBy(_.tracingId))
    } else if (volumeLayers.nonEmpty) {
      Fox.successful(volumeLayers.minBy(_.tracingId))
    } else Fox.failure("annotation.download.noLayers")

  private def selectLayerWithPrecedence(
      annotationLayers: List[AnnotationLayer]
  )(implicit ec: ExecutionContext): Fox[AnnotationLayer] = {
    val skeletonLayers = annotationLayers.filter(_.typ == AnnotationLayerType.Skeleton)
    val volumeLayers = annotationLayers.filter(_.typ == AnnotationLayerType.Volume)
    if (skeletonLayers.nonEmpty) {
      Fox.successful(skeletonLayers.minBy(_.tracingId))
    } else if (volumeLayers.nonEmpty) {
      Fox.successful(volumeLayers.minBy(_.tracingId))
    } else Fox.failure("Trying to select precedence layer from empty layer list.")
  }

  private def fetchOldPrecedenceLayer(
      existingAnnotationIdOpt: Option[ObjectId],
      existingAnnotationLayers: List[AnnotationLayer],
      previousVersion: Option[Long],
      dataset: Dataset,
      tracingStoreClient: WKRemoteTracingStoreClient
  )(implicit ec: ExecutionContext): Fox[Option[FetchedAnnotationLayer]] =
    if (existingAnnotationLayers.isEmpty) Fox.successful(None)
    else
      for {
        existingAnnotationId <- existingAnnotationIdOpt.toFox ?~> "fetchOldPrecedenceLayer.needsAnnotationId"
        oldPrecedenceLayer <- selectLayerWithPrecedence(existingAnnotationLayers)
        oldPrecedenceLayerFetched <-
          if (oldPrecedenceLayer.typ == AnnotationLayerType.Skeleton)
            tracingStoreClient.getSkeletonTracing(existingAnnotationId, oldPrecedenceLayer, previousVersion)
          else
            tracingStoreClient.getVolumeTracing(
              existingAnnotationId,
              oldPrecedenceLayer,
              previousVersion,
              skipVolumeData = true,
              volumeDataZipFormat = VolumeDataZipFormat.wkw,
              dataset.voxelSize
            )
      } yield Some(oldPrecedenceLayerFetched)

  private def extractPrecedenceProperties(oldPrecedenceLayer: FetchedAnnotationLayer): RedundantTracingProperties =
    oldPrecedenceLayer.tracing match {
      case Left(s) =>
        RedundantTracingProperties(
          s.editPosition,
          s.editRotation,
          s.zoomLevel,
          s.userBoundingBoxes ++ s.userBoundingBox
            .map(com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto(0, None, None, None, _)),
          s.editPositionAdditionalCoordinates
        )
      case Right(v) =>
        RedundantTracingProperties(
          v.editPosition,
          v.editRotation,
          v.zoomLevel,
          v.userBoundingBoxes ++ v.userBoundingBox
            .map(com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto(0, None, None, None, _)),
          v.editPositionAdditionalCoordinates
        )
    }
}
