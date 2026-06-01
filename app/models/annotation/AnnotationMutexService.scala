package models.annotation

import org.apache.pekko.actor.ActorSystem
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.schema.Tables.AnnotationMutexesRow
import com.typesafe.scalalogging.LazyLogging
import models.user.{UserDAO, UserService}
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsObject, Json}
import utils.WkConf
import utils.sql.{SimpleSQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{DurationInt, FiniteDuration}

case class AnnotationMutex(annotationId: ObjectId, userId: ObjectId, sessionId: String, expiry: Instant)

case class MutexResult(canEdit: Boolean, blockedByUser: Option[ObjectId], blockedBySessionId: Option[String])

class AnnotationMutexService @Inject()(val lifecycle: ApplicationLifecycle,
                                       val actorSystem: ActorSystem,
                                       wkConf: WkConf,
                                       userDAO: UserDAO,
                                       userService: UserService,
                                       annotationMutexDAO: AnnotationMutexDAO)(implicit val ec: ExecutionContext)
    extends IntervalScheduler
    with FoxImplicits
    with LazyLogging {

  override protected def tickerInterval: FiniteDuration = 1 hour

  override protected def tick(): Fox[Unit] =
    for {
      deleteCount <- annotationMutexDAO.deleteExpired()
    } yield logger.info(s"Cleaned up $deleteCount expired annotation mutexes.")

  private val defaultExpiryTime = wkConf.WebKnossos.Annotation.Mutex.expiryTime

  def tryAcquiringAnnotationMutex(annotationId: ObjectId, userId: ObjectId, sessionId: String): Fox[MutexResult] =
    for {
      _ <- Fox.successful(logger.info(s"Try acquire mutex inner for user $userId and id $annotationId."))
      mutex <- annotationMutexDAO.tryAcquire(annotationId, userId, sessionId, Instant.in(defaultExpiryTime)) ?~> "Trying to acquire or find current annotation mutex failed."
      _ <- Fox.successful(
        logger.info(s"Try acquire mutex inner for user $userId and id $annotationId got userId ${mutex.userId} and sessionId ${mutex.sessionId}."))
      result = if (mutex.userId == userId && mutex.sessionId == sessionId)
        MutexResult(canEdit = true, None, None)
      else
        MutexResult(canEdit = false, blockedByUser = Some(mutex.userId), blockedBySessionId = Some(mutex.sessionId))
    } yield result

  def release(annotationId: ObjectId, userId: ObjectId): Fox[Unit] =
    annotationMutexDAO.deleteForUser(annotationId, userId)

  def publicWrites(mutexResult: MutexResult): Fox[JsObject] =
    for {
      userOpt <- Fox.runOptional(mutexResult.blockedByUser)(user => userDAO.findOne(user)(GlobalAccessContext))
      userJsonOpt <- Fox.runOptional(userOpt)(user => userService.compactWrites(user))
    } yield
      Json.obj(
        "canEdit" -> mutexResult.canEdit,
        "blockedByUser" -> userJsonOpt,
        "blockedBySessionId" -> mutexResult.blockedBySessionId
      )

}

class AnnotationMutexDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  private def parse(r: AnnotationMutexesRow): AnnotationMutex =
    AnnotationMutex(
      ObjectId(r._Annotation),
      ObjectId(r._User),
      r.sessionid,
      Instant.fromSql(r.expiry)
    )

  def tryAcquire(annotationId: ObjectId, userId: ObjectId, sessionId: String, expiry: Instant): Fox[AnnotationMutex] = {
    // Returns the mutex object for the given annotation (either with the requested user & session or an old/existing mutex).
    //
    // Parallel executions can produce an empty result when both upserts race and one might read
    // an outdated version in the lower select but an updated one in the insert part.
    // This is possible due to the default isolation level.
    // As this rarely happens, we simply retry in this case.
    def attempt(remainingAttempts: Int): Fox[AnnotationMutex] =
      for {
        _ <- Fox.successful(
          logger.info(s"Trying Upserting Mutex for user $userId with attempt ${4 - remainingAttempts}"))
        rows <- run(q"""WITH attempt AS (
                          INSERT INTO webknossos.annotation_mutexes(_annotation, _user, sessionId, expiry)
                          VALUES($annotationId, $userId, $sessionId, $expiry)
                          ON CONFLICT (_annotation)
                            DO UPDATE SET
                              _user = EXCLUDED._user,
                              sessionId = EXCLUDED.sessionId,
                              expiry = EXCLUDED.expiry
                            WHERE (webknossos.annotation_mutexes._user = EXCLUDED._user AND
                              webknossos.annotation_mutexes.sessionId = EXCLUDED.sessionId
                            ) OR webknossos.annotation_mutexes.expiry < NOW()
                          RETURNING _annotation, _user, sessionId, expiry
                        )
                        SELECT _annotation, _user, sessionId, expiry FROM attempt

                        UNION ALL

                        SELECT _annotation, _user, sessionId, expiry
                        FROM webknossos.annotation_mutexes
                        WHERE _annotation = $annotationId
                          AND expiry >= NOW()
                          AND NOT EXISTS (SELECT 1 FROM attempt)""".as[AnnotationMutexesRow]) ?~> "Upserting annotation mutex failed."
        result <- rows.headOption match {
          case Some(first)                   => Fox.successful(parse(first))
          case None if remainingAttempts > 1 => attempt(remainingAttempts - 1)
          case None                          => Fox.failure("Could not find mutex for annotation after retries.")
        }
      } yield result

    attempt(remainingAttempts = 3)
  }

  def deleteExpired(): Fox[Int] =
    run(q"DELETE FROM webknossos.annotation_mutexes WHERE expiry < NOW()".asUpdate)

  def deleteForUser(annotationId: ObjectId, userId: ObjectId): Fox[Unit] =
    for {
      _ <- run(
        q"DELETE FROM webknossos.annotation_mutexes WHERE _annotation = $annotationId AND _user = $userId".asUpdate)
    } yield ()

  def hasMutex(userId: ObjectId, annotationId: ObjectId): Fox[Boolean] =
    for {
      countRows <- run(q"""SELECT COUNT(*)
                      FROM webknossos.annotation_mutexes
                      WHERE _annotation = $annotationId
                      AND _user = $userId
                      AND expiry > NOW()""".as[Int])
      count <- countRows.headOption.toFox
    } yield count > 0

}
