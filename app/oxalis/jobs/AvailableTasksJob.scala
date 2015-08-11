package oxalis.jobs

import akka.actor.Actor
import com.scalableminds.util.mail.Send
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import controllers.{Application, TaskController}
import models.task.Project
import models.user.User
import oxalis.mail.DefaultMails
import scala.concurrent.duration._
import akka.actor.Actor.Receive

/**
 * Created by nico on 11/08/15.
 */
class AvailableTasksJob extends Actor {
  import context.dispatcher
  val tick =
    context.system.scheduler.schedule(10 seconds, 0 millis, self, "checkAvailableTasks")

  override def postStop() = tick.cancel()

  override def receive: Receive = {
    case "checkAvailableTasks" =>
      val availableTasksFox = TaskController.getAllAvailableTaskCountsAndProjects()(GlobalAccessContext)

      availableTasksFox foreach { availableTasks: Map[User, (Int, List[Project])] =>
        if (availableTasks.exists { case (_ ,(count, _)) => count == 0 }) {
          val rows = (availableTasks map { case (user, (count, projects)) =>
            (user.name, count, projects.map(_.name).mkString(" "))
          }).toList
          Application.Mailer ! Send(DefaultMails.availableTaskCountMail(rows))
        }
      }
  }
}
