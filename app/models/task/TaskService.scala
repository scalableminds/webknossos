package models.task

import scala.async.Async._

import models.annotation.{Annotation, AnnotationDAO, AnnotationService, AnnotationType}
import com.scalableminds.util.reactivemongo.DBAccessContext
import models.task.TaskDAO._
import reactivemongo.bson.BSONObjectID
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.concurrent.Execution.Implicits._
import models.user.{Experience, User, UserDAO}
import scala.concurrent.Future

import net.liftweb.common.Box
import play.api.Logger
import play.api.libs.json.Json
import reactivemongo.play.json.BSONFormats._
import reactivemongo.core.commands.LastError

object TaskService extends TaskAssignmentSimulation with TaskAssignment with FoxImplicits {

  def findOneById(id: String)(implicit ctx: DBAccessContext) =
    TaskDAO.findOneById(id)

  def findNextAssignment(user: User)(implicit ctx: DBAccessContext) =
    OpenAssignmentService.findNextOpenAssignments(user)

  def findAllAssignments(implicit ctx: DBAccessContext) =
    OpenAssignmentService.findAllOpenAssignments

  def findAll(implicit ctx: DBAccessContext) =
    TaskDAO.findAll

  def findAllAdministratable(user: User, limit: Int)(implicit ctx: DBAccessContext) =
    TaskDAO.findAllAdministratable(user, limit)

  def remove(_task: BSONObjectID)(implicit ctx: DBAccessContext) = {
    TaskDAO.update(Json.obj("_id" -> _task), Json.obj("$set" -> Json.obj("isActive" -> false))).flatMap {
      case result if result.n > 0 =>
        for {
          _ <- AnnotationDAO.removeAllWithTaskId(_task)
          _ <- OpenAssignmentService.removeByTask(_task)
        } yield true
      case _ =>
        Logger.warn("Tried to remove task without permission.")
        Fox.successful(false)
    }
  }

  def handleProjectUpdate(name: String, updated: Project)(implicit ctx: DBAccessContext) = {
    OpenAssignmentService.updateAllOfProject(name, updated)
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

  def removeAllWithProject(project: Project)(implicit ctx: DBAccessContext) = {
    for{
      tasks <- project.tasks
      resultBox <- Fox.serialSequence(tasks)(task => remove(task._id)).toFox
      results <- resultBox.toSingleBox("task.single.delete.failed").toFox
    } yield results.forall(identity)
  }

  def insert(task: Task,project: Project, insertAssignments: Boolean)(implicit ctx: DBAccessContext) = {
    def insertAssignmentsIfRequested() =
      if(insertAssignments) {
        OpenAssignmentService.insertInstancesFor(task, project, task.instances)
      } else
        Future.successful(true)

    for {
      _ <- TaskDAO.insert(task)
      _ <- insertAssignmentsIfRequested()
    } yield task
  }

  def getProjectsFor(tasks: List[Task])(implicit ctx: DBAccessContext): Future[List[Project]] =
    Fox.serialSequence(tasks)(_.project).map(_.flatten).map(_.distinct)

  def getAllAvailableTaskCountsAndProjects()(implicit ctx: DBAccessContext): Fox[Map[User, (Int, List[Project])]] = {
    UserDAO.findAllNonAnonymous
    .flatMap { users =>
      Fox.serialSequence(users){ user =>
        async {
          val tasks = await(TaskService.allNextTasksForUser(user).futureBox) openOr List()
          val taskCount = tasks.size
          val projects = await(TaskService.getProjectsFor(tasks))
          user -> (taskCount, projects)
        }
      }
    }
    .map(_.toMap[User, (Int, List[Project])])
  }

  def dataSetNamesForTasks(tasks: List[Task])(implicit ctx: DBAccessContext) =
    Future.traverse(tasks)(_.annotationBase.flatMap(_.dataSetName getOrElse "").futureBox.map(_.toOption))
}
