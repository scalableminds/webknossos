/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.user.time

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
import play.api.Play.current
import play.api.libs.concurrent.Execution.Implicits._
import oxalis.thirdparty.BrainTracing

object TimeSpanService extends FoxImplicits{
  val MaxTracingPause =
    Play.current.configuration.getInt("oxalis.user.time.tracingPauseInSeconds").getOrElse(60).seconds.toMillis

  lazy val timeSpanTracker = Akka.system.actorOf(Props[TimeSpanTracker])

  def logUserInteraction(user: User, annotation: Option[AnnotationLike])(implicit ctx: DBAccessContext): Unit = {
    val timestamp = System.currentTimeMillis

    timeSpanTracker ! TrackTime(timestamp, user._id, annotation, ctx)
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


  protected case class TrackTime(timestamp: Long, _user: BSONObjectID, annotation: Option[AnnotationLike], ctx: DBAccessContext)

  protected class TimeSpanTracker extends Actor{
    val lastUserActivity = Agent[Map[BSONObjectID, TimeSpan]](Map.empty)

    private def isNotInterrupted(current: Long, last: TimeSpan) =
      current - last.lastUpdate < MaxTracingPause

    private def belongsToSameTracing( last: TimeSpan, annotation: Option[AnnotationLike]) =
      last.annotationEquals(annotation.map(_.id))

    private def createNewTimeSpan(timestamp: Long, _user: BSONObjectID, annotation: Option[AnnotationLike], ctx: DBAccessContext) = {
      val timeSpan = TimeSpan.create(timestamp, _user, annotation)
      TimeSpanDAO.insert(timeSpan)(ctx)
      timeSpan
    }

    private def logTimeToAnnotation(duration: Long, annotation: Option[AnnotationLike]) = {
      // Log time to annotation
      annotation.map {
        case a: Annotation =>
          AnnotationService.logTime(duration, a._id)(GlobalAccessContext)
        case _ =>
        // do nothing, this is not a stored annotation
      }
    }

    private def logTimeToTask(duration: Long, annotation: Option[AnnotationLike]) = {
      // Log time to task
      annotation.flatMap(_._task).foreach{ taskId =>
        TaskService.logTime(duration, taskId)(GlobalAccessContext)
      }
    }

    private def logTimeToUser(duration: Long, annotation: Option[AnnotationLike], _user: BSONObjectID) = {
      // Log time to user
      UserDAO.findOneById(_user)(GlobalAccessContext).map{ user =>
        BrainTracing.logTime(user, duration, annotation)(GlobalAccessContext)
      }
    }

    def receive = {
      case TrackTime(timestamp, _user, annotation, ctx) =>
        val timeSpan = lastUserActivity().get(_user) match {
          case Some(last) if isNotInterrupted(timestamp, last) =>
            val duration = timestamp - last.lastUpdate
            val updated = last.copy(lastUpdate = timestamp, time = last.time + duration)

            logTimeToTask(duration, annotation)
            logTimeToAnnotation(duration, annotation)
            logTimeToUser(duration, annotation, _user)

            TimeSpanDAO.update(updated._id, updated)(ctx)

            if(belongsToSameTracing(last, annotation))
              updated
            else
              createNewTimeSpan(timestamp, _user, annotation, ctx)
          case _ =>
            createNewTimeSpan(timestamp, _user, annotation, ctx)
        }
        lastUserActivity.send( _ + (_user -> timeSpan))
    }
  }
}
