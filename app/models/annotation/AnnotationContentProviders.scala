package models.annotation

import play.api.Logger
import models.tracing.skeleton.{SkeletonTracingService, SkeletonTracing}
import models.tracing.volume.{VolumeTracingService, VolumeTracing}
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.DBAccessContext
import braingames.util.Fox
import models.binary.DataSet

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 02.06.13
 * Time: 02:49
 */
trait AnnotationContentService {
  type AType <: AnnotationContent

  def updateSettings(settings: AnnotationSettings, tracingId: String)(implicit ctx: DBAccessContext): Unit

  def findOneById(id: String)(implicit ctx: DBAccessContext): Future[Option[AType]]

  def createFrom(dataSet: DataSet)(implicit ctx: DBAccessContext): Future[AType]

  def clearTracingData(id: String)(implicit ctx: DBAccessContext): Fox[AType]
}

trait AnnotationContentProviders {

  val contentProviders: Map[String, AnnotationContentService] = Map(
    SkeletonTracing.contentType -> SkeletonTracingService,
    VolumeTracing.contentType -> VolumeTracingService
  )

  val providerList = contentProviders.keys

  def withProviderForContentType[T](contentType: String)(f: AnnotationContentService => Future[T]): Future[Option[T]] = {
    contentProviders.get(contentType) match {
      case Some(p) =>
        f(p).map(result => Some(result))
      case _ =>
        Logger.warn(s"Couldn't find content provider for $contentType")
        Future.successful(None)
    }
  }
}