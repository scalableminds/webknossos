package com.scalableminds.webknossos.datastore.models.annotation

import com.scalableminds.util.tools.Fox.bool2Fox
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayerType.AnnotationLayerType
import play.api.libs.json.{JsObject, Json, OFormat}
import scalapb.GeneratedMessage

import scala.concurrent.ExecutionContext

case class AnnotationLayer(
    tracingId: String,
    typ: AnnotationLayerType,
    name: String,
    stats: JsObject,
)

object AnnotationLayerStatistics {

  def zeroedForTyp(typ: AnnotationLayerType): JsObject = typ match {
    case AnnotationLayerType.Skeleton =>
      Json.obj(
        "treeCount" -> 0,
        "nodeCount" -> 0,
        "edgeCount" -> 0,
        "branchPointCount" -> 0
      )
    case AnnotationLayerType.Volume =>
      Json.obj(
        "segmentCount" -> 0
      )
  }

  def unknown: JsObject = Json.obj()
}

object AnnotationLayer extends FoxImplicits {
  implicit val jsonFormat: OFormat[AnnotationLayer] = Json.format[AnnotationLayer]

  val defaultSkeletonLayerName: String = "Skeleton"
  val defaultVolumeLayerName: String = "Volume"

  def defaultNameForType(typ: AnnotationLayerType): String =
    typ match {
      case AnnotationLayerType.Skeleton => defaultSkeletonLayerName
      case AnnotationLayerType.Volume   => defaultVolumeLayerName
    }

  def layersFromIds(skeletonTracingIdOpt: Option[String],
                    volumeTracingIdOpt: Option[String],
                    assertNonEmpty: Boolean = true)(implicit ec: ExecutionContext): Fox[List[AnnotationLayer]] = {
    val annotationLayers: List[AnnotationLayer] = List(
      skeletonTracingIdOpt.map(
        AnnotationLayer(_, AnnotationLayerType.Skeleton, defaultSkeletonLayerName, AnnotationLayerStatistics.unknown)),
      volumeTracingIdOpt.map(
        AnnotationLayer(_, AnnotationLayerType.Volume, defaultVolumeLayerName, AnnotationLayerStatistics.unknown))
    ).flatten
    for {
      _ <- bool2Fox(!assertNonEmpty || annotationLayers.nonEmpty) ?~> "annotation.needsEitherSkeletonOrVolume"
    } yield annotationLayers
  }
}

case class FetchedAnnotationLayer(tracingId: String,
                                  name: String,
                                  tracing: Either[SkeletonTracing, VolumeTracing],
                                  volumeDataOpt: Option[Array[Byte]] = None) {
  def typ: AnnotationLayerType =
    if (tracing.isLeft) AnnotationLayerType.Skeleton else AnnotationLayerType.Volume

  def volumeDataZipName(index: Int, isSingle: Boolean): String = {
    val indexLabel = if (isSingle) "" else s"_$index"
    val nameLabel = s"_$name"
    s"data$indexLabel$nameLabel.zip"
  }
}

object FetchedAnnotationLayer {
  def fromAnnotationLayer[T <: GeneratedMessage](
      annotationLayer: AnnotationLayer,
      tracing: Either[SkeletonTracing, VolumeTracing],
      volumeDataOpt: Option[Array[Byte]] = None)(implicit ec: ExecutionContext): Fox[FetchedAnnotationLayer] =
    for {
      _ <- bool2Fox(
        (annotationLayer.typ == AnnotationLayerType.Skeleton && tracing.isLeft) || annotationLayer.typ == AnnotationLayerType.Volume && tracing.isRight) ?~> "annotation.download.fetch.typeMismatch"
    } yield {
      FetchedAnnotationLayer(
        annotationLayer.tracingId,
        annotationLayer.name,
        tracing,
        volumeDataOpt
      )
    }

  // To support compound download. There, at most one skeleton tracing and at most one volume tracing exist per annotation. Volume data is handled separately there.
  @SuppressWarnings(Array("OptionGet")) // Can be suppressed as the assertions ensure full options
  def layersFromTracings(
      skeletonTracingIdOpt: Option[String],
      volumeTracingIdOpt: Option[String],
      skeletonTracingOpt: Option[SkeletonTracing],
      volumeTracingOpt: Option[VolumeTracing],
      assertNonEmpty: Boolean = true)(implicit ec: ExecutionContext): Fox[List[FetchedAnnotationLayer]] =
    for {
      _ <- bool2Fox(skeletonTracingIdOpt.isDefined == skeletonTracingOpt.isDefined) ?~> "annotation.mismatchingSkeletonIdsAndTracings"
      _ <- bool2Fox(volumeTracingIdOpt.isDefined == volumeTracingOpt.isDefined) ?~> "annotation.mismatchingVolumeIdsAndTracings"
      annotationLayers: List[FetchedAnnotationLayer] = List(
        skeletonTracingIdOpt.map(
          FetchedAnnotationLayer(_, AnnotationLayer.defaultSkeletonLayerName, Left(skeletonTracingOpt.get))),
        volumeTracingIdOpt.map(
          FetchedAnnotationLayer(_, AnnotationLayer.defaultVolumeLayerName, Right(volumeTracingOpt.get)))
      ).flatten
      _ <- bool2Fox(!assertNonEmpty || annotationLayers.nonEmpty) ?~> "annotation.needsEitherSkeletonOrVolume"
    } yield annotationLayers
}
