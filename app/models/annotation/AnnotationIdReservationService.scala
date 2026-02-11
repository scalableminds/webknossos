package models.annotation

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import models.user.User

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class AnnotationIdReservationService @Inject()() {
  def reservedIds(annotationId: ObjectId, annotation: Annotation, tracingId: String, user: User)(
      implicit ec: ExecutionContext): Fox[Seq[Long]] =
    Fox.successful(Seq(0L))

  def reserveIds(annotationId: ObjectId,
                 annotation: Annotation,
                 tracingId: String,
                 user: User,
                 idsToRelease: Seq[Long])(implicit ec: ExecutionContext): Fox[Seq[Long]] =
    Fox.successful(Seq(0L))
}
