package models.user.time

import com.scalableminds.util.mail.Send
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.annotation._
import models.task.TaskSQLDAO
import models.user.User
import net.liftweb.common.Full
import oxalis.mail.DefaultMails
import oxalis.thirdparty.BrainTracing.Mailer
import play.api.Play
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import utils.ObjectId

import scala.collection.mutable
import scala.concurrent.duration._


object TimeSpanService extends FoxImplicits with LazyLogging {
  private val MaxTracingPause =
    Play.current.configuration.getInt("oxalis.user.time.tracingPauseInSeconds").getOrElse(60).seconds.toMillis

  def logUserInteraction(user: User, annotation: AnnotationSQL)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val timestamp = System.currentTimeMillis
    logUserInteraction(Seq(timestamp), user, annotation)
  }

  def logUserInteraction(timestamps: Seq[Long], user: User, annotation: AnnotationSQL)(implicit ctx: DBAccessContext): Fox[Unit] =
    trackTime(timestamps, user._id, annotation)

  def loggedTimeOfUser[T](
    user: User,
    groupingF: TimeSpanSQL => T,
    start: Option[Long] = None,
    end: Option[Long] = None)(implicit ctx: DBAccessContext): Fox[Map[T, Duration]] =

    for {
      timeTrackingOpt <- TimeSpanSQLDAO.findAllByUser(ObjectId.fromBsonId(user._id), start, end).futureBox
    } yield {
      timeTrackingOpt match {
        case Full(timeSpans) =>
          timeSpans.groupBy(groupingF).mapValues(_.foldLeft(0L)(_ + _.time).millis)
        case _ =>
          Map.empty[T, Duration]
      }
    }

  def loggedTimeOfAnnotation[T](
    annotationId: ObjectId,
    groupingF: TimeSpanSQL => T,
    start: Option[Long] = None,
    end: Option[Long] = None)(implicit ctx: DBAccessContext): Fox[Map[T, Duration]] =

    for {
      timeTrackingOpt <- TimeSpanSQLDAO.findAllByAnnotation(annotationId, start, end).futureBox
    } yield {
      timeTrackingOpt match {
        case Full(timeSpans) =>
          timeSpans.groupBy(groupingF).mapValues(_.foldLeft(0L)(_ + _.time).millis)
        case _ =>
          Map.empty[T, Duration]
      }
    }

  def totalTimeOfUser[T](user: User, start: Option[Long], end: Option[Long])(implicit ctx: DBAccessContext): Fox[Duration] =
    for {
      timeTrackingOpt <- TimeSpanSQLDAO.findAllByUser(ObjectId.fromBsonId(user._id), start, end).futureBox
    } yield {
      timeTrackingOpt match {
        case Full(timeSpans) =>
          timeSpans.foldLeft(0L)(_ + _.time).millis
        case _ =>
          0.millis
      }
    }

  def loggedTimePerInterval[T](groupingF: TimeSpanSQL => T, start: Option[Long] = None, end: Option[Long] = None): Fox[Map[T, Duration]] =
    for {
      timeTrackingOpt <- TimeSpanSQLDAO.findAll(start, end).futureBox
    } yield {
      timeTrackingOpt match {
        case Full(timeSpans) =>
          timeSpans.groupBy(groupingF).mapValues(_.foldLeft(0L)(_ + _.time).millis)
        case _ =>
          Map.empty[T, Duration]
      }
    }



  private val lastUserActivities = mutable.HashMap.empty[BSONObjectID, TimeSpanSQL]

  private def trackTime(timestamps: Seq[Long], _user: BSONObjectID, _annotation: AnnotationSQL)(implicit ctx: DBAccessContext) = {
    // Only if the annotation belongs to the user, we are going to log the time on the annotation
    val annotation = if (_annotation._user == ObjectId.fromBsonId(_user)) Some(_annotation) else None
    val start = timestamps.head

    var timeSpansToInsert: List[TimeSpanSQL] = List()
    var timeSpansToUpdate: List[(TimeSpanSQL, Long)] = List()

    def createNewTimeSpan(timestamp: Long, _user: BSONObjectID, annotation: Option[AnnotationSQL]) = {
      val timeSpan = TimeSpanSQL.createFrom(timestamp, timestamp, ObjectId.fromBsonId(_user), annotation.map(_._id))
      timeSpansToInsert = timeSpan :: timeSpansToInsert
      timeSpan
    }

    def updateTimeSpan(timeSpan: TimeSpanSQL, timestamp: Long) = {
      timeSpansToUpdate = (timeSpan, timestamp) :: timeSpansToUpdate

      val duration = timestamp - timeSpan.lastUpdate
      val updated = timeSpan.addTime(duration, timestamp)
      updated
    }

    var current = lastUserActivities.get(_user).flatMap(lastActivity => {
      if (isNotInterrupted(start, lastActivity)) {
        if (belongsToSameTracing(lastActivity, annotation)) {
          Some(lastActivity)
        } else {
          updateTimeSpan(lastActivity, start)
          None
        }
      } else None
    }).getOrElse(createNewTimeSpan(start, _user, annotation))

    timestamps.sliding(2).foreach { pair =>
      val start = pair.head
      val end = pair.last
      val duration = end - start
      if (duration >= MaxTracingPause) {
        updateTimeSpan(current, start)
        current = createNewTimeSpan(end, _user, annotation)
      }
    }
    current = updateTimeSpan(current, timestamps.last)
    lastUserActivities.update(_user, current)

    flushToDb(timeSpansToInsert, timeSpansToUpdate)(ctx)
  }

  private def isNotInterrupted(current: Long, last: TimeSpanSQL) = {
    val duration = current - last.lastUpdate
    duration >= 0 && duration < MaxTracingPause
  }

  private def belongsToSameTracing( last: TimeSpanSQL, annotation: Option[AnnotationSQL]) =
    last._annotation == annotation.map(_.id)

  private def logTimeToAnnotation(
    duration: Long,
    annotation: Option[ObjectId]): Fox[Unit] = {
    // Log time to annotation
    annotation match {
      case Some(a: ObjectId) =>
        AnnotationSQLDAO.logTime(a, duration)(GlobalAccessContext) ?~> "FAILED: AnnotationService.logTime"
      case _ =>
        Fox.successful(())
      // do nothing, this is not a stored annotation
    }
  }

  def signalOverTime(time: Long, annotationOpt: Option[AnnotationSQL])(implicit ctx: DBAccessContext): Fox[_] = {
    for {
      annotation <- annotationOpt.toFox
      user <- annotation.user
      task <- annotation.task
      project <- task.project
      annotationTime <- annotation.tracingTime ?~> "no annotation.tracingTime"
      timeLimit <- project.expectedTime ?~> "no project.expectedTime"
    } yield {
      if (annotationTime >= timeLimit && annotationTime - time < timeLimit) {
        Mailer ! Send(DefaultMails.overLimitMail(
          user,
          project.name,
          task._id.toString,
          annotation.id))
      }
    }
  }

  private def logTimeToTask(
                             duration: Long,
                             annotation: Option[AnnotationSQL]) = {
    annotation.flatMap(_._task) match {
      case Some(taskId) =>
        for {
          _ <- TaskSQLDAO.logTime(taskId, duration)(GlobalAccessContext) ?~> "FAILED: TaskSQLDAO.logTime"
          _ <- signalOverTime(duration, annotation)(GlobalAccessContext).futureBox //signalOverTime is expected to fail in some cases, hence the .futureBox
        } yield {}
      case _ =>
        Fox.successful(())
    }
  }

  // We intentionally return a Fox[Option] here, since the calling for-comprehension expects an Option[Annotation]. In case
  // None is passed in as "annotation", we want to pass this None on as Fox.successful(None) and not break the for-comprehension
  // by returning Fox.empty.
  private def getAnnotation(annotation: Option[ObjectId])(implicit ctx: DBAccessContext): Fox[Option[AnnotationSQL]] = {
    annotation match {
      case Some(annotationId) =>
        AnnotationSQLDAO.findOne(annotationId).map(Some(_))
      case _ =>
        Fox.successful(None)
    }
  }

  private def flushToDb(timespansToInsert: List[TimeSpanSQL], timespansToUpdate: List[(TimeSpanSQL, Long)])(implicit ctx: DBAccessContext) = {
    val updateResult = for {
      _ <- Fox.serialCombined(timespansToInsert)(t => TimeSpanSQLDAO.insertOne(t))
      _ <- Fox.serialCombined(timespansToUpdate)(t => updateTimeSpanInDb(t._1, t._2))
    } yield ()

    updateResult.onComplete { x =>
      if(x.isFailure || x.get.isEmpty)
        logger.warn(s"Failed to save all time updates: $x")
    }

    updateResult
  }

  private def updateTimeSpanInDb(timeSpan: TimeSpanSQL, timestamp: Long)(implicit ctx: DBAccessContext) = {
    val duration = timestamp - timeSpan.lastUpdate
    val updated = timeSpan.addTime(duration, timestamp)

    for {
      _ <- TimeSpanSQLDAO.updateOne(updated)(ctx) ?~> "FAILED: TimeSpanDAO.update"
      _ <- logTimeToAnnotation(duration, updated._annotation) ?~> "FAILED: TimeSpanService.logTimeToAnnotation"
      annotation <- getAnnotation(updated._annotation)
      _ <- logTimeToTask(duration, annotation) ?~> "FAILED: TimeSpanService.logTimeToTask"
    } yield {}
  }


}
