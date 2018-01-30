package models.task

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationDAO
import models.project.{Project}
import models.task.TaskDAO._
import models.user.{User, UserDAO}
import net.liftweb.common.Full
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

import scala.concurrent.Future

object TaskService
  extends FoxImplicits
    with LazyLogging {

  def findOneById(id: String)(implicit ctx: DBAccessContext) =
    TaskDAO.findOneById(id)

  def findAll(implicit ctx: DBAccessContext) =
    TaskDAO.findAll

  def findAllAdministratable(user: User, limit: Int)(implicit ctx: DBAccessContext) =
    TaskDAO.findAllAdministratable(user, limit)

  def remove(_task: BSONObjectID)(implicit ctx: DBAccessContext) = {
    TaskDAO.findAndModify(Json.obj("_id" -> _task), Json.obj("$set" -> Json.obj("isActive" -> false)), returnNew = true)
    .futureBox.flatMap {
      case Full(result) =>
        for {
          _ <- AnnotationDAO.removeAllWithTaskId(_task)
        } yield true
      case _ =>
        logger.warn("Tried to remove task without permission.")
        Fox.successful(false)
    }
  }

  def findAllByTaskType(_taskType: String)(implicit ctx: DBAccessContext) = withExceptionCatcher {
    withValidId(_taskType)(TaskDAO.findAllByTaskType)
  }

  def logTime(time: Long, _task: BSONObjectID)(implicit ctx: DBAccessContext) =
    TaskDAO.logTime(time, _task)

  def removeAllWithTaskType(taskType: TaskType)(implicit ctx: DBAccessContext) = {
    for {
      tasks <- TaskDAO.findAllByTaskType(taskType._id)
      resultBox <- Fox.serialSequence(tasks)(task => remove(task._id)).toFox
      results <- resultBox.toSingleBox("task.single.delete.failed").toFox
    } yield results.forall(identity)
  }

  def removeScriptFromTasks(_script: String)(implicit ctx: DBAccessContext) = {
    TaskDAO.removeScriptFromTasks(_script)
  }

  def removeAllWithProject(project: Project)(implicit ctx: DBAccessContext) = {
    for{
      tasks <- project.tasks
      resultBox <- Fox.serialSequence(tasks)(task => remove(task._id)).toFox
      results <- resultBox.toSingleBox("task.single.delete.failed").toFox
    } yield results.forall(identity)
  }

  def insert(task: Task, project: Project)(implicit ctx: DBAccessContext) = {
    for {
      _ <- TaskDAO.insert(task)
    } yield task
  }

  def getProjectsFor(tasks: List[Task])(implicit ctx: DBAccessContext): Future[List[Project]] =
    Fox.serialSequence(tasks)(_.project).map(_.flatten).map(_.distinct)

  def getAllAvailableTaskCountsAndProjects()(implicit ctx: DBAccessContext): Fox[Map[User, (Int, List[Project])]] = {
    UserDAO.findAllNonAnonymous
    .flatMap { users =>
      Fox.serialSequence(users){ user =>
        for{
          tasks <- TaskAssignmentService.findAllAssignableFor(user, user.teamNames).getOrElse(Nil)
          taskCount = tasks.size
          projects <- TaskService.getProjectsFor(tasks)
        } yield (user, (taskCount, projects))
      }
    }
    .map(_.toMap[User, (Int, List[Project])])
  }
}
