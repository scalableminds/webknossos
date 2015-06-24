/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.user.time

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.task.TaskService
import play.api.Play
import play.api.libs.concurrent.Akka
import akka.actor.{Actor, Props}
import models.user.{UserDAO, User}
import models.annotation.AnnotationLike
import com.scalableminds.util.reactivemongo.{GlobalAccessContext, DBAccessContext}
import scala.concurrent.duration._
import net.liftweb.common.Full
import reactivemongo.bson.BSONObjectID
import akka.agent.Agent
import play.api.Play.current
import play.api.libs.concurrent.Execution.Implicits._
import oxalis.thirdparty.BrainTracing

object TimeSpanService extends FoxImplicits{
  val MaxTracingPause = (Play.current.configuration.getInt("oxalis.user.time.tracingPauseInMinutes") getOrElse (5) minutes).toMillis

  lazy val timeSpanTracker = Akka.system.actorOf(Props[TimeSpanTracker])

  def logUserInteraction(user: User, annotation: Option[AnnotationLike])(implicit ctx: DBAccessContext) = {
    val timestamp = System.currentTimeMillis

    timeSpanTracker ! TrackTime(timestamp, user._id, annotation, ctx)
  }

  def loggedTimeOfUser[T](user: User, groupingF: TimeSpan => T, start: Option[Long] = None, end: Option[Long] = None)(implicit ctx: DBAccessContext): Fox[Map[T, Duration]] =
    for {
      timeTrackingOpt <- TimeSpanDAO.findByUser(user, start, end).futureBox
    } yield {
      timeTrackingOpt match {
        case Full(timeSpans) =>
          timeSpans.groupBy(groupingF).mapValues(_.foldLeft(0L)(_ + _.time) millis)
        case _ =>
          Map.empty[T, Duration]
      }
    }

  def loggedTimePerInterval[T](groupingF: TimeSpan => T, start: Option[Long] = None, end: Option[Long] = None): Fox[Map[T, Duration]] =
    for {
      timeTrackingOpt <- TimeSpanDAO.findAllBetween(start, end)(GlobalAccessContext).futureBox
    } yield {
      timeTrackingOpt match {
        case Full(timeSpans) =>
          timeSpans.groupBy(groupingF).mapValues(_.foldLeft(0L)(_ + _.time) millis)
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

    private def isNotInterrupted(current: Long, annotation: Option[AnnotationLike], last: TimeSpan) =
      current - last.lastUpdate < MaxTracingPause && last.annotationEquals(annotation.map(_.id))

    def receive = {
      case TrackTime(timestamp, _user, annotation, ctx) =>
        val timeSpan = lastUserActivity().get(_user) match {
          case Some(last) if isNotInterrupted(timestamp, annotation, last) =>
            val duration = timestamp - last.lastUpdate
            val updated = last.copy(lastUpdate = timestamp, time = last.time + duration)
            // Log time to task
            annotation.flatMap(_._task).foreach{ taskId =>
              TaskService.logTime(duration, taskId)(GlobalAccessContext)
            }
            // Log time to user
            UserDAO.findOneById(_user)(GlobalAccessContext).map{ user =>
              BrainTracing.logTime(user, duration, annotation)(GlobalAccessContext)
            }
            TimeSpanDAO.update(updated._id, updated)(ctx)
            updated
          case _ =>
            val timeSpan = TimeSpan.create(timestamp, _user, annotation)
            TimeSpanDAO.insert(timeSpan)(ctx)
            timeSpan
        }
        lastUserActivity.send( _ + (_user -> timeSpan))
    }
  }
}
