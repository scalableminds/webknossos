package models.annotation

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Empty, Failure, Fox, FoxImplicits, Full}
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationIdDomain.AnnotationIdDomain
import com.typesafe.scalalogging.LazyLogging
import slick.dbio.{DBIO, Effect, NoStream}
import slick.sql.SqlAction
import utils.sql.{SimpleSQLDAO, SqlClient, SqlToken}
import slick.jdbc.PostgresProfile.api._

import java.util.concurrent.Semaphore
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class AnnotationReservedIdsService @Inject()(annotationReservedIdsDAO: AnnotationReservedIdsDAO,
                                             tracingStoreService: TracingStoreService)
    extends FoxImplicits
    with LazyLogging {

  private val mutexes = new scala.collection.concurrent.TrieMap[ObjectId, Semaphore]()

  private def withMutex[T](annotationId: ObjectId)(block: => Fox[T])(implicit ec: ExecutionContext): Fox[T] = {
    val semaphore = mutexes.getOrElseUpdate(annotationId, new Semaphore(1))
    for {
      _ <- Fox.successful(semaphore.acquire())
      result <- block.andThen { case _ => semaphore.release() }
    } yield result
  }

  def reservedIds(annotationId: ObjectId, tracingId: String, domain: AnnotationIdDomain, userId: ObjectId)(
      implicit ec: ExecutionContext): Fox[Seq[Long]] =
    withMutex(annotationId) {
      annotationReservedIdsDAO.findReservedIdsForUser(annotationId, tracingId, domain, userId)
    }

  def releaseAllForAnnotation(annotationId: ObjectId)(implicit ec: ExecutionContext): Fox[Unit] =
    withMutex(annotationId) {
      annotationReservedIdsDAO.releaseAllForAnnotation(annotationId)
    }

  def reserveIds(annotationId: ObjectId,
                 tracingId: String,
                 domain: AnnotationIdDomain,
                 userId: ObjectId,
                 numberOfIdsToReserve: Int,
                 idsToRelease: Seq[Long])(implicit ec: ExecutionContext): Fox[Seq[Long]] =
    withMutex(annotationId) {
      for {
        largestExistingIdFromDatabaseBox <- annotationReservedIdsDAO
          .findLargestReservedId(annotationId, tracingId, domain)
          .shiftBox
        largestExistingId <- largestExistingIdFromDatabaseBox match {
          case Full(largestFromDatabase) => Fox.successful(largestFromDatabase)
          case Empty =>
            for {
              tracingStoreClient <- tracingStoreService.client
              idFromTracingStore <- tracingStoreClient.getLargestIdOfDomainOrZero(annotationId, tracingId, domain)
            } yield idFromTracingStore
          case f: Failure => f.toFox
        }
        idsToReserve = (largestExistingId + 1) until (largestExistingId + 1 + numberOfIdsToReserve)
        _ <- annotationReservedIdsDAO.reserveIdsFor(annotationId, tracingId, domain, userId, idsToReserve)
        _ <- annotationReservedIdsDAO.releaseIdsFor(annotationId, tracingId, domain, userId, idsToRelease)
      } yield idsToReserve
    }

}

class AnnotationReservedIdsDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findReservedIdsForUser(annotationId: ObjectId,
                             tracingId: String,
                             domain: AnnotationIdDomain,
                             userId: ObjectId): Fox[Seq[Long]] =
    run(q"""SELECT id FROM webknossos.annotation_reserved_ids
          WHERE _annotation = $annotationId
          AND tracingId = $tracingId
          AND _user = $userId
          AND domain = $domain""".as[Long])

  def releaseAllForAnnotation(annotationId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"DELETE FROM webknossos.annotation_reserved_ids WHERE _annotation = $annotationId".asUpdate)
    } yield ()

  def findLargestReservedId(annotationId: ObjectId, tracingId: String, domain: AnnotationIdDomain): Fox[Long] =
    for {
      rows <- run(q"""
           SELECT MAX(id) FROM webknossos.annotation_reserved_ids
           WHERE _annotation = $annotationId
           AND tracingId = $tracingId
           AND domain = $domain
           GROUP BY (_annotation, tracingId, domain)
           """.as[Long])
      first <- rows.headOption.toFox
    } yield first

  def reserveIdsFor(annotationId: ObjectId,
                    tracingId: String,
                    domain: AnnotationIdDomain,
                    userId: ObjectId,
                    ids: Seq[Long]): Fox[Unit] = {
    val insertQueries: Seq[SqlAction[Int, NoStream, Effect]] =
      ids.map(id => q"""INSERT INTO webknossos.annotation_reserved_ids (_annotation, tracingId, domain, _user, id)
                        VALUES ($annotationId, $tracingId, $domain, $userId, $id)""".asUpdate)
    for {
      _ <- run(DBIO.sequence(insertQueries).transactionally)
    } yield ()
  }

  def releaseIdsFor(annotationId: ObjectId,
                    tracingId: String,
                    domain: AnnotationIdDomain,
                    userId: ObjectId,
                    ids: Seq[Long]): Fox[Unit] =
    if (ids.isEmpty) Fox.successful(())
    else
      for {
        _ <- run(q"""DELETE FROM webknossos.annotation_reserved_ids
              WHERE _annotation = $annotationId
              AND tracingId = $tracingId
              AND domain = $domain
              AND _user = $userId
              AND id IN ${SqlToken.tupleFromList(ids)}""".asUpdate)
      } yield ()

}
