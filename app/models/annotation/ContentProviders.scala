package models.annotation

import braingames.binary.models.DataSet
import play.api.Logger
import models.tracing.skeleton.SkeletonTracing
import models.tracing.volume.VolumeTracing
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._

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

  def withProviderForContentType[T](contentType: String)(f: AnnotationContentDAO => Future[T]): Future[Option[T]] = {
    contentProviders.get(contentType) match {
      case Some(p) =>
        f(p).map(result => Some(result))
      case _ =>
        Logger.warn(s"Couldn't find content provider for $contentType")
        Future.successful(None)
    }
  }
}
