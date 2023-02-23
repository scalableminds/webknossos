package models.annotation

import akka.actor.ActorSystem
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.schema.Tables.AnnotationMutexesRow
import com.typesafe.scalalogging.LazyLogging
import models.user.{UserDAO, UserService}
import net.liftweb.common.Full
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsObject, Json}
import utils.{ObjectId, WkConf}
import utils.sql.{SimpleSQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{DurationInt, FiniteDuration}

case class AnnotationMutex(annotationId: ObjectId, userId: ObjectId, expiry: Instant)

case class MutexResult(canEdit: Boolean, blockedByUser: Option[ObjectId])

class AnnotationMutexService @Inject()(val lifecycle: ApplicationLifecycle,
                                       val system: ActorSystem,
                                       wkConf: WkConf,
                                       userDAO: UserDAO,
                                       userService: UserService,
                                       annotationMutexDAO: AnnotationMutexDAO)
    extends IntervalScheduler
    with LazyLogging {

  override protected def tickerInterval: FiniteDuration = 1 hour

  override protected def tick(): Unit = {
    logger.info("Cleaning up expired annotation mutexes...")
    annotationMutexDAO.deleteExpired()
    ()
  }

  private val defaultExpiryTime = wkConf.WebKnossos.Annotation.Mutex.expiryTime

  def tryAcquiringAnnotationMutex(annotationId: ObjectId, userId: ObjectId)(
      implicit ec: ExecutionContext): Fox[MutexResult] =
    this.synchronized {
      for {
        mutexBox <- annotationMutexDAO.findOne(annotationId).futureBox
        result <- mutexBox match {
          case Full(mutex) =>
            if (mutex.userId == userId)
              refresh(mutex)
            else
              Fox.successful(MutexResult(canEdit = false, blockedByUser = Some(mutex.userId)))
          case _ =>
            acquire(annotationId, userId)
        }
      } yield result
    }

  private def acquire(annotationId: ObjectId, userId: ObjectId): Fox[MutexResult] =
    for {
      _ <- annotationMutexDAO.upsertOne(AnnotationMutex(annotationId, userId, Instant.in(defaultExpiryTime)))
    } yield MutexResult(canEdit = true, None)

  private def refresh(mutex: AnnotationMutex): Fox[MutexResult] =
    for {
      _ <- annotationMutexDAO.upsertOne(mutex.copy(expiry = Instant.in(defaultExpiryTime)))
    } yield MutexResult(canEdit = true, None)

  def publicWrites(mutexResult: MutexResult)(implicit ec: ExecutionContext): Fox[JsObject] =
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

  def findOne(annotationId: ObjectId): Fox[AnnotationMutex] =
    for {
      rows <- run(q"""SELECT _annotation, _user, expiry
            FROM webknossos.annotation_mutexes
            WHERE _annotation = $annotationId
            AND expiry > NOW()""".as[AnnotationMutexesRow])
      first <- rows.headOption
      parsed = parse(first)
    } yield parsed

  def upsertOne(annotationMutex: AnnotationMutex): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.annotation_mutexes(_annotation, _user, expiry)
                   VALUES(${annotationMutex.annotationId}, ${annotationMutex.userId}, ${annotationMutex.expiry})
                   ON CONFLICT (_annotation)
                     DO UPDATE SET
                       _user = ${annotationMutex.userId},
                       expiry = ${annotationMutex.expiry}
                   """.asUpdate)
    } yield ()

  def deleteExpired(): Fox[Unit] =
    for {
      _ <- run(q"DELETE FROM webknossos.annotation_mutexes WHERE expiry < NOW()".asUpdate)
    } yield ()

}
