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

case class AnnotationMutex(annotationId: ObjectId, userId: ObjectId, expiry: Instant)

case class MutexResult(canEdit: Boolean, blockedByUser: Option[ObjectId])

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

  def tryAcquiringAnnotationMutex(annotationId: ObjectId, userId: ObjectId): Fox[MutexResult] =
    for {
      _ <- Fox.successful(logger.info(s"Try acquire mutex inner for user $userId and id $annotationId."))
      ownerUserId <- annotationMutexDAO.tryAcquireReturningOwner(annotationId, userId, Instant.in(defaultExpiryTime))
      _ <- Fox.successful(
        logger.info(s"Try acquire mutex inner for user $userId and id $annotationId got ownerUserId $ownerUserId."))
      result = if (ownerUserId == userId)
        MutexResult(canEdit = true, None)
      else
        MutexResult(canEdit = false, blockedByUser = Some(ownerUserId))
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
        "blockedByUser" -> userJsonOpt
      )

}

class AnnotationMutexDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  private def parse(r: AnnotationMutexesRow): AnnotationMutex =
    AnnotationMutex(
      ObjectId(r._Annotation),
      ObjectId(r._User),
      Instant.fromSql(r.expiry)
    )

  def tryAcquireReturningOwner(annotationId: ObjectId, userId: ObjectId, expiry: Instant): Fox[ObjectId] =
    for {
      rows <- run(q"""INSERT INTO webknossos.annotation_mutexes(_annotation, _user, expiry)
                      VALUES($annotationId, $userId, $expiry)
                      ON CONFLICT (_annotation)
                        DO UPDATE SET
                          _user = EXCLUDED._user,
                          expiry = EXCLUDED.expiry
                        WHERE webknossos.annotation_mutexes._user = EXCLUDED._user
                           OR webknossos.annotation_mutexes.expiry < NOW()
                      RETURNING _annotation, _user, expiry

                      UNION ALL

                      SELECT _annotation, _user, expiry
                      FROM webknossos.annotation_mutexes
                      WHERE _annotation = $annotationId
                        AND expiry >= NOW()""".as[AnnotationMutexesRow]) ~> "Upserting annotation mutex failed."
      first <- rows.headOption.toFox ~> "Could not find mutex for annotation."
      parsed = parse(first)
    } yield parsed.userId

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
