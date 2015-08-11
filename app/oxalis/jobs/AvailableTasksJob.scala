package oxalis.jobs

import akka.actor.Actor
import com.scalableminds.util.mail.Send
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import controllers.{Application, TaskController}
import models.task.Project
import models.user.User
import oxalis.mail.DefaultMails
import scala.concurrent.duration._

/**
 * Created by nico on 11/08/15.
 */
class AvailableTasksJob extends Actor {
  import context.dispatcher
  val tick =
    context.system.scheduler.schedule(0 millis, 10 seconds, self, "checkAvailableTasks")

  override def postStop() = tick.cancel()

  override def receive: Receive = {
    case "checkAvailableTasks" =>
      val availableTasksCountsFox = TaskController.getAllAvailableTaskCountsAndProjects()(GlobalAccessContext)

      availableTasksCountsFox foreach { availableTasks: Map[User, (Int, List[Project])] =>
        println(availableTasks.exists { case (_, (count, _)) => count == 0 })
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
