package models.task

import com.scalableminds.util.reactivemongo.{DBAccessContext, MongoHelpers}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.project.Project
import models.user.{User, UserDAO}
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

import scala.concurrent.Future

object TaskService
  extends FoxImplicits
    with MongoHelpers
    with LazyLogging {

  def findOneById(id: String)(implicit ctx: DBAccessContext) =
    TaskDAO.findOneById(id)

  def findAllAdministratable(user: User, limit: Int)(implicit ctx: DBAccessContext) =
    TaskDAO.findAllAdministratable(user, limit)

  def removeOne(_task: BSONObjectID)(implicit ctx: DBAccessContext) =
    TaskDAO.removeOneAndItsAnnotations(_task)

  def findAllByTaskType(_taskType: String)(implicit ctx: DBAccessContext) = {
    withId(_taskType)(TaskDAO.findAllByTaskType)
  }

  def logTime(time: Long, _task: BSONObjectID)(implicit ctx: DBAccessContext) =
    TaskDAO.logTime(time, _task)

  def removeAllWithTaskType(taskType: TaskType)(implicit ctx: DBAccessContext) =
    TaskDAO.removeAllWithTaskTypeAndItsAnnotations(taskType)

  def removeAllWithProject(project: Project)(implicit ctx: DBAccessContext) =
    TaskDAO.removeAllWithProjectAndItsAnnotations(project)

  def removeScriptFromTasks(_script: String)(implicit ctx: DBAccessContext) = {
    TaskDAO.removeScriptFromTasks(_script)
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
