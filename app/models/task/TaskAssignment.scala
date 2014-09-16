package models.task

import play.api.Play._
import scala.Some
import akka.util.Timeout
import play.api.libs.concurrent.Akka
import akka.actor.Props
import com.scalableminds.util.js.{JS, JsExecutionActor}
import models.user.User
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

  implicit val timeout = Timeout((conf.getInt("js.defaultTimeout") getOrElse 5) seconds) // needed for `?` below

  val jsExecutionActor = Akka.system.actorOf(Props[JsExecutionActor])

  def findAssignableFor(user: User)(implicit ctx: DBAccessContext) = {
    val finishedTasks = AnnotationDAO.findFor(user._id, AnnotationType.Task).map(_.flatMap(_._task))
    val availableTasks = findAllAssignable

    for {
      available <- availableTasks
      finished <- finishedTasks
    } yield {
      available.filter(t =>
        !finished.contains(t._id) && t.hasEnoughExperience(user))
    }
  }

  protected def nextTaskForUser(user: User, futureTasks: Fox[List[Task]]): Fox[Task] = futureTasks.flatMap {
    case Nil =>
      Fox.empty
    case tasks =>
      val params = Map("user" -> user, "tasks" -> tasks.toArray)
      TaskSelectionAlgorithmDAO.current(GlobalAccessContext).flatMap {
      current =>
        (jsExecutionActor ? JS(current.js, params))
          .mapTo[Future[Task]].flatMap(f => f.map(t => Full(t))).recover {
          case e: Exception =>
            Logger.error("JS Execution error: " + e.getMessage)
            Failure("JS Execution error", Full(e), Empty)
        }
    }
  }

  def nextTaskForUser(user: User)(implicit ctx: DBAccessContext): Fox[Task] = {
    nextTaskForUser(
      user,
      findAssignableFor(user))
  }
}
