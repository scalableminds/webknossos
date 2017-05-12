/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.user.time

import scala.collection.mutable
import scala.concurrent.Future

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.task.TaskService
import play.api.Play
import play.api.libs.concurrent.Akka
import akka.actor.{Actor, Props}
import models.user.{User, UserDAO}
import models.annotation.{Annotation, AnnotationLike, AnnotationService}
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import scala.concurrent.duration._

import net.liftweb.common.Full
import reactivemongo.bson.BSONObjectID
import akka.agent.Agent
import com.typesafe.scalalogging.LazyLogging
import play.api.Play.current
import play.api.libs.concurrent.Execution.Implicits._
import oxalis.thirdparty.BrainTracing

object TimeSpanService extends FoxImplicits with LazyLogging {
  private val MaxTracingPause =
    Play.current.configuration.getInt("oxalis.user.time.tracingPauseInSeconds").getOrElse(60).seconds.toMillis

  private lazy val timeSpanTracker = Akka.system.actorOf(Props[TimeSpanTracker])

  def logUserInteraction(user: User, annotation: Option[AnnotationLike])(implicit ctx: DBAccessContext): Unit = {
    val timestamp = System.currentTimeMillis
    logUserInteraction(timestamp, timestamp, user, annotation)
  }

  def logUserInteraction(start: Long, end: Long, user: User, annotation: Option[AnnotationLike])(implicit ctx: DBAccessContext): Unit = {
    timeSpanTracker ! TrackTime(start, end, user._id, annotation, ctx)
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


  protected case class TrackTime(start: Long, end: Long, _user: BSONObjectID, annotation: Option[AnnotationLike], ctx: DBAccessContext)

  protected class TimeSpanTracker extends Actor{
    private val lastUserActivity = mutable.HashMap.empty[BSONObjectID, TimeSpan]

    private def isNotInterrupted(current: Long, last: TimeSpan) = {
      val duration = current - last.lastUpdate
      duration >= 0 && duration < MaxTracingPause
    }

    private def belongsToSameTracing( last: TimeSpan, annotation: Option[AnnotationLike]) =
      last.annotationEquals(annotation.map(_.id))

    private def createNewTimeSpan(start: Long, end: Long, _user: BSONObjectID, annotation: Option[AnnotationLike], ctx: DBAccessContext) = {
      val timeSpan = TimeSpan.create(start, end, _user, annotation)
      TimeSpanDAO.insert(timeSpan)(ctx)
      timeSpan
    }

    private def logTimeToAnnotation(
      duration: Long,
      annotation: Option[AnnotationLike]) = {
      // Log time to annotation
      annotation match {
        case Some(a: Annotation) =>
          AnnotationService.logTime(duration, a._id)(GlobalAccessContext)
        case _ =>
          Fox.successful(true)
        // do nothing, this is not a stored annotation
      }
    }

    private def logTimeToTask(
      duration: Long,
      annotation: Option[AnnotationLike]) = {
      // Log time to task
      annotation.flatMap(_._task) match {
        case Some(taskId) =>
          TaskService.logTime(duration, taskId)(GlobalAccessContext)
        case _ =>
          Fox.successful(true)
      }
    }

    private def logTimeToUser(
      duration: Long,
      annotation: Option[AnnotationLike],
      _user: BSONObjectID) = {
      // Log time to user
      UserDAO.findOneById(_user)(GlobalAccessContext).flatMap{ user =>
        BrainTracing.logTime(user, duration, annotation)(GlobalAccessContext)
      }
    }

    def receive = {
      case TrackTime(start, end, _user, _annotation, ctx) =>
        // Only if the annotation belongs to the user, we are going to log the time on the annotation
        val annotation = _annotation.filter(_._user.contains(_user))
        lastUserActivity.get(_user) match {
          case Some(last) if isNotInterrupted(start, last) =>
            val duration = end - last.lastUpdate
            val updated = last.addTime(duration, end)

            val timeSpan =
              if (belongsToSameTracing(last, annotation))
                updated
              else
                createNewTimeSpan(start, end, _user, annotation, ctx)
            lastUserActivity.update(_user, timeSpan)

            val updateResult = for{
              _ <- TimeSpanDAO.update(updated._id, updated)(ctx)
              _ <- logTimeToTask(duration, annotation)
              _ <- logTimeToAnnotation(duration, annotation)
              _ <- logTimeToUser(duration, annotation, _user)
            } yield {
              true
            }

            updateResult.onComplete{ x =>
              if(x.isFailure || x.get.isEmpty)
                logger.warn(s"Failed to save all time updates. Annotation: ${annotation.map(_.id)} Error: $x")
            }
          case _ =>
            val timeSpan = createNewTimeSpan(start, end, _user, annotation, ctx)
            lastUserActivity.update(_user, timeSpan)
        }
    }
  }
}
