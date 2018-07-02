/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.user.time

import akka.actor.{Actor, Props}
import com.scalableminds.util.mail.Send
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.annotation._
import models.task.TaskSQLDAO
import models.user.User
import net.liftweb.common.Full
import oxalis.mail.DefaultMails
import oxalis.thirdparty.BrainTracing.Mailer
import play.api.Play
import play.api.Play.current
import play.api.libs.concurrent.Akka
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import utils.ObjectId

import scala.collection.mutable
import scala.concurrent.duration._


object TimeSpanService extends FoxImplicits with LazyLogging {
  private val MaxTracingPause =
    Play.current.configuration.getInt("oxalis.user.time.tracingPauseInSeconds").getOrElse(60).seconds.toMillis

  private lazy val timeSpanTracker = Akka.system.actorOf(Props[TimeSpanTracker])

  def logUserInteraction(user: User, annotation: AnnotationSQL)(implicit ctx: DBAccessContext): Unit = {
    val timestamp = System.currentTimeMillis
    logUserInteraction(Seq(timestamp), user, annotation)
  }

  def logUserInteraction(timestamps: Seq[Long], user: User, annotation: AnnotationSQL)(implicit ctx: DBAccessContext): Unit = {
    timeSpanTracker ! TrackTime(timestamps, user._id, annotation, ctx)
  }

  def loggedTimeOfUser[T](
    user: User,
    groupingF: TimeSpan => T,
    start: Option[Long] = None,
    end: Option[Long] = None)(implicit ctx: DBAccessContext): Fox[Map[T, Duration]] =

    for {
      timeTrackingOpt <- TimeSpanDAO.findByUser(user, start, end).futureBox
    } yield {
      timeTrackingOpt match {
        case Full(timeSpans) =>
          timeSpans.groupBy(groupingF).mapValues(_.foldLeft(0L)(_ + _.time).millis)
        case _ =>
          Map.empty[T, Duration]
      }
    }

  def loggedTimeOfAnnotation[T](
    annotation: String,
    groupingF: TimeSpan => T,
    start: Option[Long] = None,
    end: Option[Long] = None)(implicit ctx: DBAccessContext): Fox[Map[T, Duration]] =

    for {
      timeTrackingOpt <- TimeSpanDAO.findByAnnotation(annotation, start, end).futureBox
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
      timeTrackingOpt <- TimeSpanDAO.findByUser(user, start, end).futureBox
    } yield {
      timeTrackingOpt match {
        case Full(timeSpans) =>
          timeSpans.foldLeft(0L)(_ + _.time).millis
        case _ =>
          0.millis
      }
    }

  def loggedTimePerInterval[T](groupingF: TimeSpan => T, start: Option[Long] = None, end: Option[Long] = None): Fox[Map[T, Duration]] =
    for {
      timeTrackingOpt <- TimeSpanDAO.findAllBetween(start, end)(GlobalAccessContext).futureBox
    } yield {
      timeTrackingOpt match {
        case Full(timeSpans) =>
          timeSpans.groupBy(groupingF).mapValues(_.foldLeft(0L)(_ + _.time).millis)
        case _ =>
          Map.empty[T, Duration]
      }
    }

  def logTime(user: User, time: Long, note: Option[String])(implicit ctx: DBAccessContext) = {
    val current = System.currentTimeMillis
    val entry = TimeSpan(time, current, current, _user = user._id, note = note)
    TimeSpanDAO.insert(entry)
  }


  protected case class TrackTime(timestamps: Seq[Long], _user: BSONObjectID, annotation: AnnotationSQL, ctx: DBAccessContext)

  protected class TimeSpanTracker extends Actor {
    private val lastUserActivity = mutable.HashMap.empty[BSONObjectID, TimeSpan]

    private def isNotInterrupted(current: Long, last: TimeSpan) = {
      val duration = current - last.lastUpdate
      duration >= 0 && duration < MaxTracingPause
    }

    private def belongsToSameTracing( last: TimeSpan, annotation: Option[AnnotationSQL]) =
      last.annotationEquals(annotation.map(_.id))

    private def createNewTimeSpan(timestamp: Long, _user: BSONObjectID, annotation: Option[AnnotationSQL], ctx: DBAccessContext) = {
      val timeSpan = TimeSpan.create(timestamp, timestamp, _user, annotation)
      TimeSpanDAO.insert(timeSpan)(ctx)
      timeSpan
    }

    private def logTimeToAnnotation(
      duration: Long,
      annotation: Option[AnnotationSQL]): Fox[Unit] = {
      // Log time to annotation
      annotation match {
        case Some(a: AnnotationSQL) =>
          AnnotationSQLDAO.logTime(a._id, duration)(GlobalAccessContext) ?~> "FAILED: AnnotationService.logTime"
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
        annotationTime <- annotation.tracingTime
        timeLimit <- project.expectedTime
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
      // Log time to task
      annotation.flatMap(_._task) match {
        case Some(taskId) =>
          for {
            _ <- TaskSQLDAO.logTime(taskId, duration)(GlobalAccessContext) ?~> "FAILED: TaskSQLDAO.logTime"
            _ <- signalOverTime(duration, annotation)(GlobalAccessContext) ?~> "FAILED: TimeSpanService.signalOverTime"
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

    private def updateTimeSpan(timeSpan: TimeSpan, timestamp: Long)(implicit ctx: DBAccessContext) = {
      val duration = timestamp - timeSpan.lastUpdate
      val updated = timeSpan.addTime(duration, timestamp)

      val updateResult = for {
        annotation <- getAnnotation(updated.annotation.map(ObjectId(_)))
        _ <- TimeSpanDAO.update(updated)(ctx) ?~> "FAILED: TimeSpanDAO.update"
        _ <- logTimeToAnnotation(duration, annotation) ?~> "FAILED: TimeSpanService.logTimeToAnnotation"
        _ <- logTimeToTask(duration, annotation) ?~> "FAILED: TimeSpanService.logTimeToTask"
      } yield {}

      updateResult.onComplete{ x =>
        if(x.isFailure || x.get.isEmpty)
          logger.warn(s"Failed to save all time updates. Annotation: ${updated.annotation} Error: $x")
      }

      updated
    }

    def receive = {
      case TrackTime(timestamps, _user, _annotation, ctx) =>
        // Only if the annotation belongs to the user, we are going to log the time on the annotation
        val annotation = if (_annotation._user == ObjectId.fromBsonId(_user)) Some(_annotation) else None
        val start = timestamps.head

        var current = lastUserActivity.get(_user).flatMap(last => {
          if (isNotInterrupted(start, last)) {
            if (belongsToSameTracing(last, annotation)) {
              Some(last)
            } else {
              updateTimeSpan(last, start)(ctx)
              None
            }
          } else None
        }).getOrElse(createNewTimeSpan(start, _user, annotation, ctx))

        timestamps.sliding(2).foreach{ pair =>
          val start = pair.head
          val end = pair.last
          val duration = end - start
          if (duration >= MaxTracingPause) {
            updateTimeSpan(current, start)(ctx)
            current = createNewTimeSpan(end, _user, annotation, ctx)
          }
        }
        current = updateTimeSpan(current, timestamps.last)(ctx)
        lastUserActivity.update(_user, current)
    }
  }
}
