package models.annotation

import com.scalableminds.util.tools.Fox
import models.annotation.AnnotationTypeSQL.AnnotationTypeSQL
import utils.ObjectId

case class AnnotationIdentifier(annotationType: AnnotationTypeSQL, identifier: ObjectId) {

  def toUniqueString =
    annotationType + "__" + identifier

}

object AnnotationIdentifier {

  def parse(typ: String, id: String): Fox[AnnotationIdentifier] = for {
    identifier <- ObjectId.parse(id)
    typ <- AnnotationTypeSQL.fromString(typ)
  } yield AnnotationIdentifier(typ, identifier)

}
