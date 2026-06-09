package models.annotation

import org.apache.pekko.actor.ActorSystem
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Empty, Failure, Fox, FoxImplicits, Full}
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
    this.synchronized {
      for {
        mutexBox <- annotationMutexDAO.findOne(annotationId).shiftBox
        result <- mutexBox match {
          case Full(mutex) =>
            if (mutex.userId == userId && mutex.sessionId == sessionId)
              refresh(mutex)
            else
              Fox.successful(
                MutexResult(canEdit = false,
                            blockedByUser = Some(mutex.userId),
                            blockedBySessionId = Some(mutex.sessionId)))
          case Empty =>
            acquire(annotationId, userId, sessionId)
          case f: Failure =>
            f.toFox
        }
      } yield result
    }

  private def acquire(annotationId: ObjectId, userId: ObjectId, sessionId: String): Fox[MutexResult] =
    for {
      _ <- annotationMutexDAO.upsertOne(AnnotationMutex(annotationId, userId, sessionId, Instant.in(defaultExpiryTime)))
    } yield MutexResult(canEdit = true, None, None)

  private def refresh(mutex: AnnotationMutex): Fox[MutexResult] =
    for {
      _ <- annotationMutexDAO.upsertOne(mutex.copy(expiry = Instant.in(defaultExpiryTime)))
    } yield MutexResult(canEdit = true, None, None)

  def release(annotationId: ObjectId, userId: ObjectId, sessionId: String): Fox[Unit] =
    annotationMutexDAO.deleteForUser(annotationId, userId, sessionId)

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

  def findOne(annotationId: ObjectId): Fox[AnnotationMutex] =
    for {
      rows <- run(q"""SELECT _annotation, _user, sessionId, expiry
            FROM webknossos.annotation_mutexes
            WHERE _annotation = $annotationId
            AND expiry > NOW()""".as[AnnotationMutexesRow])
      first <- rows.headOption.toFox
      parsed = parse(first)
    } yield parsed

  def upsertOne(annotationMutex: AnnotationMutex): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.annotation_mutexes(_annotation, _user, sessionId, expiry)
                   VALUES(${annotationMutex.annotationId}, ${annotationMutex.userId}, ${annotationMutex.sessionId}, ${annotationMutex.expiry})
                   ON CONFLICT (_annotation)
                     DO UPDATE SET
                       _user = ${annotationMutex.userId},
                       sessionId = ${annotationMutex.sessionId},
                       expiry = ${annotationMutex.expiry}
                   """.asUpdate)
    } yield ()

  def deleteExpired(): Fox[Int] =
    run(q"DELETE FROM webknossos.annotation_mutexes WHERE expiry < NOW()".asUpdate)

  def deleteForUser(annotationId: ObjectId, userId: ObjectId, sessionId: String): Fox[Unit] =
    for {
      _ <- run(
        q"DELETE FROM webknossos.annotation_mutexes WHERE _annotation = $annotationId AND _user = $userId AND sessionid = $sessionId".asUpdate)
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
