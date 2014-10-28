package models.task

import play.api.Play._
import scala.Some
import akka.util.Timeout
import play.api.libs.concurrent.Akka
import akka.actor.Props
import com.scalableminds.util.js.{JS, JsExecutionActor}
import models.user.{UserService, User}
import models.annotation.{AnnotationType, AnnotationDAO}
import scala.concurrent.Future
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import play.api.Logger
import akka.pattern.AskTimeoutException
import play.api.libs.concurrent.Execution.Implicits._
import akka.pattern.ask
import scala.concurrent.duration._
import com.scalableminds.util.tools.Fox
import net.liftweb.common.{Failure, Empty, Full}

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
      available.filter(task => !finished.contains(task._id) && task.hasEnoughExperience(user))
    }
  }

  protected def nextTaskForUser(user: User, futureTasks: Fox[List[Task]]): Fox[Task] =
    futureTasks.flatMap(_.headOption)

  def nextTaskForUser(user: User)(implicit ctx: DBAccessContext): Fox[Task] =
    nextTaskForUser(user, findAssignableFor(user))
}
