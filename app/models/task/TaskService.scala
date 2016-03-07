package models.task

import scala.async.Async._

import models.annotation.{AnnotationService, Annotation, AnnotationType, AnnotationDAO}
import com.scalableminds.util.reactivemongo.DBAccessContext
import models.task.TaskDAO._
import reactivemongo.bson.BSONObjectID

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.concurrent.Execution.Implicits._
import models.user.{UserDAO, User, Experience}
import scala.concurrent.Future
import play.api.Logger
import play.api.libs.json.Json
import play.modules.reactivemongo.json.BSONFormats._
import reactivemongo.core.commands.LastError

object TaskService extends TaskAssignmentSimulation with TaskAssignment with FoxImplicits {

  def findOneById(id: String)(implicit ctx: DBAccessContext) =
    TaskDAO.findOneById(id)

  def findNextAssignment(implicit ctx: DBAccessContext) =
    OpenAssignmentService.findNextOpenAssignments

  def findAll(implicit ctx: DBAccessContext) =
    TaskDAO.findAll

  def findAllAdministratable(user: User)(implicit ctx: DBAccessContext) =
    TaskDAO.findAllAdministratable(user)

  def remove(_task: BSONObjectID)(implicit ctx: DBAccessContext) = {
<<<<<<< HEAD
    TaskDAO.update(Json.obj("_id" -> _task), Json.obj("$set" -> Json.obj("isActive" -> false))).flatMap{
      case result if result.n > 0 =>
        AnnotationDAO.removeAllWithTaskId(_task)
      case _ =>
        Logger.warn("Tried to remove task without permission.")
        Future.successful(LastError(false ,None, None, None, None, 0, false))
    }
  }

  def findAllByTaskType(_taskType: String)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    withValidId(_taskType)(TaskDAO.findAllByTaskType)
  }

  def deleteAllWithTaskType(taskType: TaskType)(implicit ctx: DBAccessContext) =
    TaskDAO.deleteAllWithTaskType(taskType)

  def assignOnce(t: Task)(implicit ctx: DBAccessContext) =
    TaskDAO.assignOnce(t._id)
=======
    for{
      _ <- TaskDAO.removeById(_task)
      _ <- AnnotationDAO.removeAllWithTaskId(_task)
      _ <- OpenAssignmentService.removeByTask(_task)
    } yield true
  }

  def logTime(time: Long, _task: BSONObjectID)(implicit ctx: DBAccessContext) =
    TaskDAO.logTime(time, _task)
>>>>>>> 777b966dea8460009c7c78dfd25fd855a0f7da08

  def removeAllWithProject(project: Project)(implicit ctx: DBAccessContext) = {
    for{
      _ <- TaskDAO.removeAllWithProject(project)
      _ <- OpenAssignmentService.removeByProject(project)
    } yield true
  }

  def insert(task: Task, insertAssignments: Boolean)(implicit ctx: DBAccessContext) = {
    def insertAssignmentsIfRequested() =
      if(insertAssignments) {
        OpenAssignmentService.insertInstancesFor(task, task.instances)
      } else
        Future.successful(true)

    for {
      _ <- TaskDAO.insert(task)
      _ <- insertAssignmentsIfRequested()
    } yield task
  }

  def getProjectsFor(tasks: List[Task])(implicit ctx: DBAccessContext): Future[List[Project]] =
    Fox.sequenceOfFulls(tasks.map(_.project)).map(_.distinct)

  def getAllAvailableTaskCountsAndProjects()(implicit ctx: DBAccessContext): Fox[Map[User, (Int, List[Project])]] = {
    UserDAO.findAll
    .flatMap { users =>
      Future.sequence( users.map { user =>
        async {
          val tasks = await(TaskService.findAssignableFor(user).futureBox) openOr List()
          val taskCount = tasks.size
          val projects = await(TaskService.getProjectsFor(tasks))
          user -> (taskCount, projects)
        }
      })
    }
    .map(_.toMap[User, (Int, List[Project])])
  }

  def dataSetNamesForTasks(tasks: List[Task])(implicit ctx: DBAccessContext) =
    Future.traverse(tasks)(_.annotationBase.flatMap(_.dataSetName getOrElse "").futureBox.map(_.toOption))
}
