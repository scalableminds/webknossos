package oxalis.jobs

import akka.actor.Actor
import controllers.TaskController
import models.task.Project
import models.user.User
import scala.concurrent.duration._
import akka.actor.Actor.Receive

/**
 * Created by nico on 11/08/15.
 */
class AvailableTasksJob extends Actor {
  import context.dispatcher
  val tick =
    context.system.scheduler.schedule(1 day, 0 millis, self, "checkAvailableTasks")

  override def postStop() = tick.cancel()

  override def receive: Receive = {
    case "checkAvailableTasks" =>
      val availableTasksFox = TaskController.getAllAvailableTaskCountsAndProjects()

      availableTasksFox foreach { availableTasks: Map[User, (Int, List[Project])] =>
        if (availableTasks.exists { case (_ ,(count, _)) => count == 0 }) {
          sendMail(availableTasks)
        }
      }
  }
}
