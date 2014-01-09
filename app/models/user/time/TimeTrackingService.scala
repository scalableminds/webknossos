package models.user.time

import models.user.User
import oxalis.thirdparty.BrainTracing
import models.annotation.AnnotationLike
import models.task.Task
import braingames.reactivemongo.DBAccessContext
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.duration.Duration

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 28.10.13
 * Time: 14:41
 */
object TimeTrackingService {

  def loggedTime(user: User)(implicit ctx: DBAccessContext) =
    for {
      timeTrackingOpt <- TimeTrackingDAO.findOneByUser(user)
    } yield {
      timeTrackingOpt match {
        case Some(tracking) => tracking.splitIntoPaymentIntervals
        case None => Map.empty[PaymentInterval, Duration]
      }
    }

  def logTime(user: User, time: Long, note: String)(implicit ctx: DBAccessContext) = {
    TimeTrackingDAO.logTime(user, time, Some(note))
    BrainTracing.logTime(user, time, None)
  }

  def logUserAction(user: User, annotation: AnnotationLike)(implicit ctx: DBAccessContext): Unit =
    logUserAction(user, Some(annotation))

  def logUserAction(user: User, annotation: Option[AnnotationLike])(implicit ctx: DBAccessContext): Unit = {
    TimeTrackingDAO.logTime(user, annotation).map {
      time =>
        BrainTracing.logTime(user, time, annotation)
        logTimeToTask(time, annotation.flatMap(_.task))
    }
  }

  private def logTimeToTask(time: Long, taskOpt: Option[Task]) = {
    taskOpt.map(task => Task.logTime(time, task))
  }
}