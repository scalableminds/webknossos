package models.annotation

import play.api.Logger
import models.tracing.skeleton.{SkeletonTracingService, SkeletonTracing}
import models.tracing.volume.{VolumeTracingService, VolumeTracing}
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import models.binary.DataSet

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 02.06.13
 * Time: 02:49
 */
trait AnnotationContentService {
  type AType <: AnnotationContent

  def updateSettings(settings: AnnotationSettings, tracingId: String)(implicit ctx: DBAccessContext): Fox[Boolean]

  def findOneById(id: String)(implicit ctx: DBAccessContext): Fox[AType]

  def createFrom(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[AType]

  def clearTracingData(id: String)(implicit ctx: DBAccessContext): Fox[AType]
}

trait AnnotationContentProviders {

  val contentProviders: Map[String, AnnotationContentService] = Map(
    SkeletonTracing.contentType -> SkeletonTracingService,
    VolumeTracing.contentType -> VolumeTracingService
  )

  val providerList = contentProviders.keys

  def withProviderForContentType[T](contentType: String)(f: AnnotationContentService => Fox[T]): Fox[T] = {
    contentProviders.get(contentType) match {
      case Some(p) =>
        f(p)
      case _ =>
        Logger.warn(s"Couldn't find content provider for $contentType")
        Fox.failure(s"Couldn't find content provider for $contentType")
    }
  }
}
