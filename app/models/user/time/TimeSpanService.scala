package models.user.time

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.annotation._
import models.organization.OrganizationDAO
import models.project.ProjectDAO
import models.task.TaskDAO
import models.user.{User, UserService}
import net.liftweb.common.Full
import oxalis.mail.{DefaultMails, Send}
import oxalis.thirdparty.BrainTracing
import utils.{ObjectId, WkConf}

import scala.collection.mutable
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class TimeSpanService @Inject()(annotationDAO: AnnotationDAO,
                                userService: UserService,
                                taskDAO: TaskDAO,
                                brainTracing: BrainTracing,
                                annotationService: AnnotationService,
                                projectDAO: ProjectDAO,
                                organizationDAO: OrganizationDAO,
                                timeSpanDAO: TimeSpanDAO,
                                defaultMails: DefaultMails,
                                conf: WkConf)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {
  private val MaxTracingPauseMillis =
    conf.WebKnossos.User.timeTrackingPause.toMillis

  def logUserInteraction(timestamp: Long, user: User, annotation: Annotation)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    logUserInteraction(Seq(timestamp), user, annotation)

  def logUserInteraction(timestamps: Seq[Long], user: User, annotation: Annotation)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    trackTime(timestamps, user._id, annotation)

  def loggedTimeOfUser[T](user: User,
                          groupingF: TimeSpan => T,
                          start: Option[Long] = None,
                          end: Option[Long] = None): Fox[Map[T, Duration]] =
    for {
      timeTrackingOpt <- timeSpanDAO.findAllByUser(user._id, start, end).futureBox
    } yield {
      timeTrackingOpt match {
        case Full(timeSpans) =>
          timeSpans.groupBy(groupingF).mapValues(_.foldLeft(0L)(_ + _.time).millis)
        case _ =>
          Map.empty[T, Duration]
      }
    }

  def loggedTimeOfAnnotation[T](annotationId: ObjectId,
                                groupingF: TimeSpan => T,
                                start: Option[Long] = None,
                                end: Option[Long] = None): Fox[Map[T, Duration]] =
    for {
      timeTrackingOpt <- timeSpanDAO.findAllByAnnotation(annotationId, start, end).futureBox
    } yield {
      timeTrackingOpt match {
        case Full(timeSpans) =>
          timeSpans.groupBy(groupingF).mapValues(_.foldLeft(0L)(_ + _.time).millis)
        case _ =>
          Map.empty[T, Duration]
      }
    }

  def loggedTimePerInterval[T](groupingF: TimeSpan => T,
                               start: Option[Long] = None,
                               end: Option[Long] = None,
                               organizationId: ObjectId): Fox[Map[T, Duration]] =
    for {
      timeTrackingOpt <- timeSpanDAO.findAll(start, end, organizationId).futureBox
    } yield {
      timeTrackingOpt match {
        case Full(timeSpans) =>
          timeSpans.groupBy(groupingF).mapValues(_.foldLeft(0L)(_ + _.time).millis)
        case _ =>
          Map.empty[T, Duration]
      }
    }

  private val lastUserActivities = mutable.HashMap.empty[ObjectId, TimeSpan]

  @SuppressWarnings(Array("TraversableHead", "TraversableLast")) // Only functions call this which put at least one timestamp in the seq
  private def trackTime(timestamps: Seq[Long], _user: ObjectId, _annotation: Annotation)(
      implicit ctx: DBAccessContext) = {
    // Only if the annotation belongs to the user, we are going to log the time on the annotation
    val annotation = if (_annotation._user == _user) Some(_annotation) else None
    val start = timestamps.head

    var timeSpansToInsert: List[TimeSpan] = List()
    var timeSpansToUpdate: List[(TimeSpan, Long)] = List()

    def createNewTimeSpan(timestamp: Long, _user: ObjectId, annotation: Option[Annotation]) = {
      val timeSpan = TimeSpan.createFrom(timestamp, timestamp, _user, annotation.map(_._id))
      timeSpansToInsert = timeSpan :: timeSpansToInsert
      timeSpan
    }

    def updateTimeSpan(timeSpan: TimeSpan, timestamp: Long) = {
      val duration = timestamp - timeSpan.lastUpdate
      if (duration >= 0) {
        timeSpansToUpdate = (timeSpan, timestamp) :: timeSpansToUpdate
        timeSpan.addTime(duration, timestamp)
      } else {
        logger.info(
          s"Not updating previous timespan due to negative duration $duration ms. (user ${timeSpan._user}, last timespan id ${timeSpan._id}, this=$this)")
        timeSpan
      }
    }

    var current = lastUserActivities
      .get(_user)
      .flatMap(lastActivity => {
        if (isNotInterrupted(start, lastActivity)) {
          if (belongsToSameTracing(lastActivity, annotation)) {
            Some(lastActivity)
          } else {
            updateTimeSpan(lastActivity, start)
            None
          }
        } else None
      })
      .getOrElse(createNewTimeSpan(start, _user, annotation))

    timestamps.sliding(2).foreach { pair =>
      val start = pair.head
      val end = pair.last
      val duration = end - start
      if (duration >= MaxTracingPauseMillis) {
        updateTimeSpan(current, start)
        current = createNewTimeSpan(end, _user, annotation)
      }
    }
    current = updateTimeSpan(current, timestamps.last)
    lastUserActivities.update(_user, current)

    flushToDb(timeSpansToInsert, timeSpansToUpdate)(ctx)
  }

  private def isNotInterrupted(current: Long, last: TimeSpan) = {
    val duration = current - last.lastUpdate
    if (duration < 0) {
      logger.info(
        s"Negative timespan duration $duration ms to previous entry. (user ${last._user}, last timespan id ${last._id}, this=$this)")
    }
    duration < MaxTracingPauseMillis
  }

  private def belongsToSameTracing(last: TimeSpan, annotation: Option[Annotation]) =
    last._annotation.map(_.id) == annotation.map(_.id)

  private def logTimeToAnnotation(duration: Long, annotation: Option[ObjectId]): Fox[Unit] =
    // Log time to annotation
    annotation match {
      case Some(a: ObjectId) =>
        annotationDAO.logTime(a, duration)(GlobalAccessContext) ?~> "FAILED: AnnotationService.logTime"
      case _ =>
        Fox.successful(())
      // do nothing, this is not a stored annotation
    }

  def signalOverTime(time: Long, annotationOpt: Option[Annotation])(implicit ctx: DBAccessContext): Fox[_] =
    for {
      annotation <- annotationOpt.toFox
      user <- userService.findOneById(annotation._user, useCache = true)(GlobalAccessContext)
      task <- annotationService.taskFor(annotation)(GlobalAccessContext)
      project <- projectDAO.findOne(task._project)
      annotationTime <- annotation.tracingTime ?~> "no annotation.tracingTime"
      timeLimit <- project.expectedTime ?~> "no project.expectedTime"
      organization <- organizationDAO.findOne(user._organization)(GlobalAccessContext)
    } yield {
      if (annotationTime >= timeLimit && annotationTime - time < timeLimit) {
        brainTracing.Mailer ! Send(
          defaultMails.overLimitMail(user, project.name, task._id.toString, annotation.id, organization))
      }
    }

  private def logTimeToTask(duration: Long, annotation: Option[Annotation]) =
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
  private def flushToDb(timespansToInsert: List[TimeSpan], timespansToUpdate: List[(TimeSpan, Long)])(
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

  private def updateTimeSpanInDb(timeSpan: TimeSpan, timestamp: Long)(implicit ctx: DBAccessContext) = {
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
