package models.annotation

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationType.AnnotationType
import play.api.libs.concurrent.Execution.Implicits._
import utils.ObjectId

case class AnnotationIdentifier(annotationType: AnnotationType, identifier: ObjectId) {

  def toUniqueString =
    annotationType + "__" + identifier

}

object AnnotationIdentifier extends FoxImplicits {

  def parse(typ: String, id: String): Fox[AnnotationIdentifier] =
    for {
      identifier <- ObjectId.parse(id) ?~> ("Invalid ObjectId: " + id)
      typ <- AnnotationType.fromString(typ) ?~> ("Invalid AnnotationType: " + typ)
    } yield AnnotationIdentifier(typ, identifier)

}
