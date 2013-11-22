package models.annotation

import braingames.reactivemongo.DBAccessContext
import play.api.Logger
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 15:07
 */

case class ContentReference(contentType: String, _id: String) {
  lazy val service: AnnotationContentService =
    ContentReference.contentProviders.get(contentType) getOrElse {
      throw new Exception("No registered resolver for ContentType: " + contentType)
    }

  def resolveAs[T](implicit ctx: DBAccessContext): Future[Option[T]] = {
    service.findOneById(_id) map {
      case e: Option[T] => e
      case _ => None
    }
  }
}

object ContentReference extends AnnotationContentProviders {
  implicit val contentReferenceFormat = Json.format[ContentReference]

  def createFor(a: AnnotationContent) = {
    ContentReference(a.contentType, a.id)
  }
}

