package models.annotation

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 15:07
 */

case class ContentReference(contentType: String, _id: String) {
  lazy val dao: AnnotationContentDAO =
    ContentReference.contentProviders.get(contentType) getOrElse {
      throw new Exception("No registered resolver for ContentType: " + contentType)
    }

  def resolveAs[T]: Option[T] = {
    dao.findOneById(_id) match {
      case e: Option[T] => e
      case _ => None
    }
  }
}

object ContentReference extends AnnotationContentProviders {
  def createFor(a: AnnotationContent) = {
    ContentReference(a.contentType, a.id)
  }
}

