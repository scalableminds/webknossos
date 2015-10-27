package models.task

import play.api.Play._
import models.user.{UserService, User}
import com.scalableminds.util.reactivemongo.DBAccessContext
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.tools.Fox

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 19.11.13
 * Time: 14:57
 */
trait TaskAssignment {

  def findAllAssignable(implicit ctx: DBAccessContext): Fox[List[Task]]

  val conf = current.configuration

  def findAssignableFor(user: User)(implicit ctx: DBAccessContext) = {
    for {
      available <- findAllAssignable(ctx)
      finished <- UserService.findFinishedTasksOf(user)
    } yield {
      available.filter(task => !finished.contains(task._id) && task.hasEnoughExperience(user)).sortBy(-_.priority)
    }
  }

  protected def nextTaskForUser(user: User, futureTasks: Fox[List[Task]]): Fox[Task] =
    futureTasks.flatMap(_.headOption)

  def nextTaskForUser(user: User)(implicit ctx: DBAccessContext): Fox[Task] =
    nextTaskForUser(user, findAssignableFor(user))
}
