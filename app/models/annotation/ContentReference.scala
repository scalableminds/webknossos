package models.annotation

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.typesafe.scalalogging.LazyLogging
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import com.scalableminds.util.tools.Fox
import net.liftweb.common.Full

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 15:07
 */

case class ContentReference(contentType: String, _id: String) {
  lazy val service: AnnotationContentService =
    ContentReference.contentProviders.getOrElse(contentType, {
      throw new Exception("No registered resolver for ContentType: " + contentType)
    })

  def resolveAs[T](implicit ctx: DBAccessContext): Fox[T] = {
    service.findOneById(_id).flatMap {
      r =>
        try {
          Fox.successful(r.asInstanceOf[T])
        } catch {
          case e: ClassCastException => Fox.failure("Content Service returned wrong object type")
        }
    }
  }
}

object ContentReference extends AnnotationContentProviders {
  implicit val contentReferenceFormat = Json.format[ContentReference]

  def createFor(a: AnnotationContent) = {
    ContentReference(a.contentType, a.id)
  }
}

