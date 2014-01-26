package models.user.time

import models.user.User
import oxalis.thirdparty.BrainTracing
import models.annotation.AnnotationLike
import models.task.{TaskService, Task}
import braingames.reactivemongo.DBAccessContext
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.duration.Duration
import braingames.util.Fox

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
        logTimeToTask(time, annotation.toFox.flatMap(_.task))
    }
  }

  private def logTimeToTask(time: Long, taskOpt: Fox[Task])(implicit ctx: DBAccessContext) = {
    taskOpt.map(task => TaskService.logTime(time, task))
  }
}