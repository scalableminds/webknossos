package models.annotation

import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import models.annotation.AnnotationType.AnnotationType
import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.ExecutionContext

case class AnnotationIdentifier(annotationType: AnnotationType, identifier: ObjectId) {

  def toUniqueString: String =
    f"${annotationType}__$identifier"

}

object AnnotationIdentifier  {

  def parse(typ: String, id: ObjectId)(implicit ec: ExecutionContext): Fox[AnnotationIdentifier] =
    for {
      typ <- AnnotationType.fromString(typ).toFox ?~> ("Invalid AnnotationType: " + typ)
    } yield AnnotationIdentifier(typ, id)
}
