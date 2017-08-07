package models.task

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationDAO
import models.mturk.MTurkAssignmentConfig
import models.project.{Project, WebknossosAssignmentConfig}
import models.task.TaskDAO._
import models.user.{User, UserDAO}
import net.liftweb.common.Full
import oxalis.mturk.MTurkService
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

import scala.concurrent.Future

object TaskService
  extends TaskAssignmentSimulation
    with TaskAssignment
    with FoxImplicits
    with LazyLogging{

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
    TaskDAO.findAndModify(Json.obj("_id" -> _task), Json.obj("$set" -> Json.obj("isActive" -> false)), returnNew = true)
    .futureBox.flatMap {
      case Full(result) =>
        for {
          _ <- AnnotationDAO.removeAllWithTaskId(_task)
          _ <- OpenAssignmentService.removeByTask(_task)
          _ <- MTurkService.removeByTask(result)
        } yield true
      case _ =>
        logger.warn("Tried to remove task without permission.")
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
    def insertAssignmentsIfNeeded() =
      project.assignmentConfiguration match {
        case WebknossosAssignmentConfig =>
          OpenAssignmentService.insertInstancesFor(task, project, task.instances).toFox
        case _: MTurkAssignmentConfig =>
          MTurkService.createHITs(project, task)
        case _ =>
          Fox.successful(true)
      }

    for {
      _ <- TaskDAO.insert(task)
      _ <- insertAssignmentsIfNeeded()
    } yield task
  }

  def getProjectsFor(tasks: List[Task])(implicit ctx: DBAccessContext): Future[List[Project]] =
    Fox.serialSequence(tasks)(_.project).map(_.flatten).map(_.distinct)

  def getAllAvailableTaskCountsAndProjects()(implicit ctx: DBAccessContext): Fox[Map[User, (Int, List[Project])]] = {
    UserDAO.findAllNonAnonymous
    .flatMap { users =>
      Fox.serialSequence(users){ user =>
        for{
          tasks <- TaskService.allNextTasksForUser(user).getOrElse(Nil)
          taskCount = tasks.size
          projects <- TaskService.getProjectsFor(tasks)
        } yield (user, (taskCount, projects))
      }
    }
    .map(_.toMap[User, (Int, List[Project])])
  }

  //TODO: RocksDB
/*  def dataSetNamesForTasks(tasks: List[Task])(implicit ctx: DBAccessContext) =
    Future.traverse(tasks)(_.annotationBase.flatMap(_.dataSetName getOrElse "").futureBox.map(_.toOption))*/
}
