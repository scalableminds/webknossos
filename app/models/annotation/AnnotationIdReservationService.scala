package models.annotation

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationIdDomain.AnnotationIdDomain
import models.user.User
import utils.sql.{SimpleSQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class AnnotationIdReservationService @Inject()(tracingStoreClient: WKRemoteTracingStoreClient) {

  def reservedIds(annotationId: ObjectId,
                  annotation: Annotation,
                  tracingId: String,
                  user: User,
                  domain: AnnotationIdDomain)(implicit ec: ExecutionContext): Fox[Seq[Long]] =
    Fox.successful(Seq(0L))

  def reserveIds(annotationId: ObjectId,
                 tracingId: String,
                 user: User,
                 domain: AnnotationIdDomain,
                 numberOfIdsToReserve: Int,
                 idsToRelease: Seq[Long])(implicit ec: ExecutionContext): Fox[Seq[Long]] = {
    if (false) {
      tracingStoreClient.getLargestIdOfDomain(annotationId, tracingId, domain)
    }
    Fox.successful(Seq(0L))
  }

}

class AnnotationIdReservationDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findReservedIdsForUser(annotationId: ObjectId,
                             tracingId: ObjectId,
                             domain: AnnotationIdDomain,
                             userId: ObjectId): Fox[Seq[Long]] = ???

  def findLargestReservedId(annotationId: ObjectId, tracingId: ObjectId, domain: AnnotationIdDomain): Fox[Long] = ???

  def reserveIdsFor(annotationId: ObjectId,
                    tracingId: ObjectId,
                    domain: AnnotationIdDomain,
                    userId: ObjectId,
                    ids: Seq[Long]): Fox[Unit] = ???

  def releaseIdsFor(annotationId: ObjectId,
                    tracingId: ObjectId,
                    domain: AnnotationIdDomain,
                    userId: ObjectId,
                    ids: Seq[Long]): Fox[Unit] = ???

}
