package models.annotation

import braingames.binary.models.DataSet
import play.api.Logger
import models.tracing.skeleton.SkeletonTracing
import models.tracing.volume.VolumeTracing

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 02.06.13
 * Time: 02:49
 */
trait AnnotationContentDAO {
  type AType <: AnnotationContent

  def updateSettings(settings: AnnotationSettings, tracingId: String): Unit

  def findOneById(id: String): Option[AType]

  def createFrom(dataSet: DataSet): AType

  def contentType: String
}

trait AnnotationContentProviders {

  val contentProviders: Map[String, AnnotationContentDAO] = Map(
    SkeletonTracing.contentType -> SkeletonTracing,
    VolumeTracing.contentType -> VolumeTracing
  )

  val providerList = contentProviders.keys

  def withProviderForContentType[T](contentType: String)(f: AnnotationContentDAO => T): Option[T] = {
    contentProviders.get(contentType) match {
      case Some(p) =>
        Some(f(p))
      case _ =>
        Logger.warn(s"Couldn't find content provider for $contentType")
        None
    }
  }
}
