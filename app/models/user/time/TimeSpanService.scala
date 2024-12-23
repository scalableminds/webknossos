package models.user.time

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import mail.{DefaultMails, Send}

import javax.inject.Inject
import models.annotation._
import models.project.ProjectDAO
import models.task.TaskDAO
import models.user.{User, UserService}
import net.liftweb.common.{Box, Full}
import org.apache.pekko.actor.{ActorSelection, ActorSystem}
import utils.WkConf

import scala.collection.mutable
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class TimeSpanService @Inject()(annotationDAO: AnnotationDAO,
                                userService: UserService,
                                taskDAO: TaskDAO,
                                annotationService: AnnotationService,
                                projectDAO: ProjectDAO,
                                timeSpanDAO: TimeSpanDAO,
                                defaultMails: DefaultMails,
                                conf: WkConf,
                                actorSystem: ActorSystem)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  private lazy val Mailer: ActorSelection =
    actorSystem.actorSelection("/user/mailActor")

  def logUserInteractionIfTheyArePotentialContributor(timestamp: Instant, user: User, annotation: Annotation)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    if (user._id == annotation._user || annotation.othersMayEdit) {
      logUserInteraction(Seq(timestamp), user, annotation)
    } else Fox.successful(())

  def logUserInteraction(timestamps: Seq[Instant], user: User, annotation: Annotation)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    trackTime(timestamps, user._id, annotation)

  def sumTimespansPerInterval[T](groupingF: TimeSpan => T, timeSpansBox: Box[List[TimeSpan]]): Map[T, Duration] =
    timeSpansBox match {
      case Full(timeSpans) =>
        timeSpans.groupBy(groupingF).view.mapValues(_.foldLeft(0L)(_ + _.time).millis).toMap
      case _ =>
        Map.empty[T, Duration]
    }

  private val lastUserActivities = mutable.HashMap.empty[ObjectId, TimeSpan]

  @SuppressWarnings(Array("TraversableHead", "TraversableLast")) // Only functions call this which put at least one timestamp in the seq
  private def trackTime(timestamps: Seq[Instant], userId: ObjectId, annotation: Annotation)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    if (timestamps.isEmpty) {
      logger.warn("Timetracking called with empty timestamps list.")
      Fox.successful(())
    } else {
      val start = timestamps.head

      var timeSpansToInsert: List[TimeSpan] = List()
      var timeSpansToUpdate: List[(TimeSpan, Instant)] = List()

      def createNewTimeSpan(timestamp: Instant, _user: ObjectId, annotation: Annotation) = {
        val timeSpan = TimeSpan.fromInstant(timestamp, _user, annotation._id)
        timeSpansToInsert = timeSpan :: timeSpansToInsert
        timeSpan
      }

      def updateTimeSpan(timeSpan: TimeSpan, timestamp: Instant) = {
        val duration: FiniteDuration = timestamp - timeSpan.lastUpdate
        if (duration.toMillis >= 0) {
          timeSpansToUpdate = (timeSpan, timestamp) :: timeSpansToUpdate
          timeSpan.addTime(duration, timestamp)
        } else {
          // Negative duration. This is expected when updating an annotation with multiple layers.
          // Each layer reports updates that can overlap time-wise. We do not update the timespan with the negative duration.
          timeSpan
        }
      }

      var current = lastUserActivities
        .get(userId)
        .flatMap(lastActivity => {
          if (isNotInterrupted(start, lastActivity)) {
            if (belongsToSameAnnotation(lastActivity, annotation)) {
              Some(lastActivity)
            } else {
              updateTimeSpan(lastActivity, start)
              None
            }
          } else None
        })
        .getOrElse(createNewTimeSpan(start, userId, annotation))

      timestamps.sliding(2).foreach { pair =>
        val start = pair.head
        val end = pair.last
        val duration = end - start
        if (duration >= conf.WebKnossos.User.timeTrackingPause) {
          updateTimeSpan(current, start)
          current = createNewTimeSpan(end, userId, annotation)
        }
      }
      current = updateTimeSpan(current, timestamps.last)
      lastUserActivities.update(userId, current)

      flushToDb(timeSpansToInsert, timeSpansToUpdate)(ctx)
    }

  private def isNotInterrupted(current: Instant, last: TimeSpan) =
    current - last.lastUpdate < conf.WebKnossos.User.timeTrackingPause

  private def belongsToSameAnnotation(last: TimeSpan, annotation: Annotation) =
    last._annotation.contains(annotation._id)

  private def logTimeToAnnotation(duration: FiniteDuration, annotation: Option[ObjectId]): Fox[Unit] =
    // Log time to annotation
    annotation match {
      case Some(a: ObjectId) =>
        annotationDAO.logTime(a, duration)(GlobalAccessContext) ?~> "FAILED: AnnotationService.logTime"
      case _ =>
        Fox.successful(())
      // do nothing, this is not a stored annotation
    }

  private def signalOverTime(time: FiniteDuration, annotationOpt: Option[Annotation])(
      implicit ctx: DBAccessContext): Fox[_] =
    for {
      annotation <- annotationOpt.toFox
      user <- userService.findOneCached(annotation._user)(GlobalAccessContext)
      task <- annotationService.taskFor(annotation)(GlobalAccessContext)
      project <- projectDAO.findOne(task._project)
      annotationTime <- annotation.tracingTime ?~> "no annotation.tracingTime"
      timeLimit <- project.expectedTime ?~> "no project.expectedTime"
      projectOwner <- userService.findOneCached(project._owner)(GlobalAccessContext)
      projectOwnerEmail <- userService.emailFor(projectOwner)(GlobalAccessContext)
    } yield {
      if (annotationTime >= timeLimit && annotationTime - time.toMillis < timeLimit) {
        Mailer ! Send(
          defaultMails.overLimitMail(user, project.name, task._id.toString, annotation.id, projectOwnerEmail))
      }
    }

  private def logTimeToTask(duration: FiniteDuration, annotation: Option[Annotation]) =
    annotation.flatMap(_._task) match {
      case Some(taskId) =>
        for {
          _ <- taskDAO.logTime(taskId, duration)(GlobalAccessContext) ?~> "FAILED: TaskSQLDAO.logTime"
          _ <- signalOverTime(duration, annotation)(GlobalAccessContext).futureBox //signalOverTime is expected to fail in some cases, hence the .futureBox
        } yield {}
      case _ =>
        Fox.successful(())
    }

  // We intentionally return a Fox[Option] here, since the calling for-comprehension expects an Option[Annotation]. In case
  // None is passed in as "annotation", we want to pass this None on as Fox.successful(None) and not break the for-comprehension
  // by returning Fox.empty.
  private def getAnnotation(annotation: Option[ObjectId])(implicit ctx: DBAccessContext): Fox[Option[Annotation]] =
    annotation match {
      case Some(annotationId) =>
        annotationDAO.findOne(annotationId).map(Some(_))
      case _ =>
        Fox.successful(None)
    }

  @SuppressWarnings(Array("TryGet")) // This is okay because we check the failure case before using the try
  private def flushToDb(timespansToInsert: List[TimeSpan], timespansToUpdate: List[(TimeSpan, Instant)])(
      implicit ctx: DBAccessContext) = {
    val updateResult = for {
      _ <- Fox.serialCombined(timespansToInsert)(t => timeSpanDAO.insertOne(t))
      _ <- Fox.serialCombined(timespansToUpdate)(t => updateTimeSpanInDb(t._1, t._2))
    } yield ()

    updateResult.onComplete { x =>
      if (x.isFailure || x.get.isEmpty)
        logger.warn(s"Failed to save all time updates: $x")
    }

    updateResult
  }

  private def updateTimeSpanInDb(timeSpan: TimeSpan, timestamp: Instant)(implicit ctx: DBAccessContext) = {
    val duration = timestamp - timeSpan.lastUpdate
    val updated = timeSpan.addTime(duration, timestamp)

    for {
      _ <- timeSpanDAO.updateOne(updated) ?~> "FAILED: TimeSpanDAO.updateOne"
      _ <- logTimeToAnnotation(duration, updated._annotation) ?~> "FAILED: TimeSpanService.logTimeToAnnotation"
      annotation <- getAnnotation(updated._annotation)
      _ <- logTimeToTask(duration, annotation) ?~> "FAILED: TimeSpanService.logTimeToTask"
    } yield {}
  }

}
