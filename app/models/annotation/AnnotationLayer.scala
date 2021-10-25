package models.annotation

import akka.stream.Materializer
import akka.stream.scaladsl.{Source, StreamConverters}
import akka.util.ByteString
import com.scalableminds.util.io.NamedEnumeratorStream
import com.scalableminds.util.tools.Fox.bool2Fox
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import models.annotation.AnnotationLayerType.AnnotationLayerType
import play.api.libs.iteratee.Enumerator
import play.api.libs.json.{Json, OFormat}
import scalapb.GeneratedMessage

import scala.concurrent.ExecutionContext

case class AnnotationLayer(
    tracingId: String,
    typ: AnnotationLayerType,
    name: Option[String] = None
) {}

object AnnotationLayer extends FoxImplicits {
  implicit val jsonFormat: OFormat[AnnotationLayer] = Json.format[AnnotationLayer]

  def layersFromIds(skeletonTracingIdOpt: Option[String],
                    volumeTracingIdOpt: Option[String],
                    assertNonEmpty: Boolean = true)(implicit ec: ExecutionContext): Fox[List[AnnotationLayer]] = {
    val annotationLayers: List[AnnotationLayer] = List(
      skeletonTracingIdOpt.map(AnnotationLayer(_, AnnotationLayerType.Skeleton)),
      volumeTracingIdOpt.map(AnnotationLayer(_, AnnotationLayerType.Volume))).flatten
    for {
      _ <- bool2Fox(!assertNonEmpty || annotationLayers.nonEmpty) ?~> "annotation.needsEitherSkeletonOrVolume"
    } yield annotationLayers
  }
}

case class FetchedAnnotationLayer(tracingId: String,
                                  name: Option[String],
                                  tracing: Either[SkeletonTracing, VolumeTracing],
                                  volumeDataOpt: Option[Source[ByteString, _]] = None) {
  def typ: AnnotationLayerType =
    if (tracing.isLeft) AnnotationLayerType.Skeleton else AnnotationLayerType.Volume

  def volumeDataEnumerator(implicit ec: ExecutionContext, materializer: Materializer): Option[Enumerator[Array[Byte]]] =
    volumeDataOpt.map(d => Enumerator.fromStream(d.runWith(StreamConverters.asInputStream())))

  def namedVolumeDataEnumerator(index: Int)(implicit ec: ExecutionContext,
                                            materializer: Materializer): Option[NamedEnumeratorStream] =
    volumeDataEnumerator.map(enumerator => NamedEnumeratorStream(volumeDataZipName(index), enumerator))

  def volumeDataZipName(index: Int): String =
    name.map(n => s"data_${index}_$n.zip").getOrElse(s"data_${index}.zip")
}

object FetchedAnnotationLayer {
  def fromAnnotationLayer[T <: GeneratedMessage](
      annotationLayer: AnnotationLayer,
      tracing: Either[SkeletonTracing, VolumeTracing],
      volumeDataOpt: Option[Source[ByteString, _]] = None)(implicit ec: ExecutionContext): Fox[FetchedAnnotationLayer] =
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

  def layersFromTracings(
      skeletonTracingIdOpt: Option[String],
      volumeTracingIdOpt: Option[String],
      skeletonTracingOpt: Option[SkeletonTracing],
      volumeTracingOpt: Option[VolumeTracing],
      volumeDataOpt: Option[Array[Byte]],
      assertNonEmpty: Boolean = true)(implicit ec: ExecutionContext): Fox[List[FetchedAnnotationLayer]] =
    for {
      _ <- bool2Fox(skeletonTracingIdOpt.isDefined == skeletonTracingOpt.isDefined) ?~> "annotation.mismatchingSkeletonIdsAndTracings"
      _ <- bool2Fox(volumeTracingIdOpt.isDefined == volumeTracingOpt.isDefined) ?~> "annotation.mismatchingVolumeIdsAndTracings"
      annotationLayers: List[FetchedAnnotationLayer] = List(
        skeletonTracingIdOpt.map(FetchedAnnotationLayer(_, None, Left(skeletonTracingOpt.get))),
        volumeTracingIdOpt.map(FetchedAnnotationLayer(_, None, Right(volumeTracingOpt.get), volumeDataOpt))
      ).flatten
      _ <- bool2Fox(!assertNonEmpty || annotationLayers.nonEmpty) ?~> "annotation.needsEitherSkeletonOrVolume"
    } yield annotationLayers
}
