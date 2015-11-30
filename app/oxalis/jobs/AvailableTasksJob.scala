package oxalis.jobs

import akka.actor.Actor
import com.scalableminds.util.mail.Send
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import controllers.{Application, TaskController}
import models.task.Project
import models.user.User
import oxalis.mail.DefaultMails
import scala.concurrent.duration._
import play.api.Logger


/**
 * Actor which checks every day if there are users without available tasks.
 * If this is the case it sends an email with an overview of the available task count of each user.
 */
class AvailableTasksJob extends Actor {
  import context.dispatcher

  case object CheckAvailableTasks

  val tick =
    context.system.scheduler.schedule(0 millis, 1 day, self, CheckAvailableTasks)

  override def postStop() = tick.cancel()

  override def receive: Receive = {
    case CheckAvailableTasks =>
      Logger.info("Daily check for users without any available tasks")
      val availableTasksCountsFox = TaskController.getAllAvailableTaskCountsAndProjects()(GlobalAccessContext)

      availableTasksCountsFox foreach { availableTasks: Map[User, (Int, List[Project])] =>
        Logger.info("Found users without available tasks. Sending email.")
        if (availableTasks.exists { case (_ ,(count, _)) => count == 0 }) {
          val rows = (availableTasks map { case (user, (count, projects)) =>
            (user.name, count, projects.map(_.name).mkString(" "))
          }).toList
          val sortedRows = rows.sortBy { case (_, count, _) => count }
          Application.Mailer ! Send(DefaultMails.availableTaskCountMail(rows))
        }
      }
  }
}
