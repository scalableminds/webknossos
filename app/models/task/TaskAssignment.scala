package models.task

import play.api.Play._
import scala.Some
import akka.util.Timeout
import play.api.libs.concurrent.Akka
import akka.actor.Props
import braingames.js.{JS, JsExecutionActor}
import models.user.User
import models.annotation.{AnnotationType, AnnotationDAO}
import scala.concurrent.Future
import braingames.reactivemongo.{DBAccessContext, GlobalAccessContext}
import scala.util.{Success, Failure, Try}
import play.api.Logger
import akka.pattern.AskTimeoutException
import play.api.libs.concurrent.Execution.Implicits._
import akka.pattern.ask
import scala.concurrent.duration._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 19.11.13
 * Time: 14:57
 */
trait TaskAssignment {
  def findAllTrainings(implicit ctx: DBAccessContext): Future[List[Task]]

  def findAllAssignableNonTrainings(implicit ctx: DBAccessContext): Future[List[Task]]

  val conf = current.configuration

  implicit val timeout = Timeout((conf.getInt("js.defaultTimeout") getOrElse 5) seconds) // needed for `?` below

  val jsExecutionActor = Akka.system.actorOf(Props[JsExecutionActor])

  def findAssignableTasksFor(user: User)(implicit ctx: DBAccessContext) = {
    findAssignableFor(user, shouldBeTraining = false)
  }

  def findAssignableFor(user: User, shouldBeTraining: Boolean)(implicit ctx: DBAccessContext) = {
    val finishedTasks = AnnotationDAO.findFor(user._id, AnnotationType.Task).map(_.flatMap(_._task))
    val availableTasks =
      if (shouldBeTraining)
        findAllTrainings
      else
        findAllAssignableNonTrainings

    for {
      available <- availableTasks
      finished <- finishedTasks
    } yield {
      available.filter(t =>
        !finished.contains(t._id) && t.hasEnoughExperience(user))
    }
  }

  import scala.async.Async._

  protected def nextTaskForUser(user: User, futureTasks: Future[List[Task]]): Future[Option[Task]] = async {
    val tasks = await(futureTasks)
    if (tasks.isEmpty) {
      None
    } else {
      val params = Map("user" -> user, "tasks" -> tasks.toArray)
      val current = await(TaskSelectionAlgorithmDAO.current(GlobalAccessContext))
      val assignment = (jsExecutionActor ? JS(current.js, params))
                       .mapTo[Future[Try[Task]]].flatMap(_.map {
        case Failure(f) =>
          Logger.error("JS Execution error: " + f)
          None
        case Success(s) =>
          Some(s)
      }.recover {
        case e: AskTimeoutException =>
          Logger.warn("JS Execution actor didn't return in time!")
          None
        case e: Exception =>
          Logger.error("JS Execution catched exception: " + e.toString())
          e.printStackTrace()
          None
      })
      await(assignment)
    }
  }

  def nextTaskForUser(user: User)(implicit ctx: DBAccessContext): Future[Option[Task]] = {
    nextTaskForUser(
      user,
      findAssignableTasksFor(user))
  }
}