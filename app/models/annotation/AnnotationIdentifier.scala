package models.annotation

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationType.AnnotationType
import utils.ObjectId

import scala.concurrent.ExecutionContext

case class AnnotationIdentifier(annotationType: AnnotationType, identifier: ObjectId) {

  def toUniqueString: String =
    annotationType + "__" + identifier

}

object AnnotationIdentifier extends FoxImplicits {

  def parse(typ: String, id: String)(implicit ec: ExecutionContext): Fox[AnnotationIdentifier] =
    for {
      identifier <- ObjectId.parse(id) ?~> ("Invalid ObjectId: " + id)
      typ <- AnnotationType.fromString(typ) ?~> ("Invalid AnnotationType: " + typ)
    } yield AnnotationIdentifier(typ, identifier)

}
