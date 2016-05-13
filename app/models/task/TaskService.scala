package models.task

import models.annotation.{AnnotationService, Annotation, AnnotationType, AnnotationDAO}
import com.scalableminds.util.reactivemongo.DBAccessContext
import models.task.TaskDAO._
import reactivemongo.bson.BSONObjectID

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.concurrent.Execution.Implicits._
import models.user.{User, Experience}
import scala.concurrent.Future
import play.api.Logger
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

  def findAllAdministratable(user: User)(implicit ctx: DBAccessContext) =
    TaskDAO.findAllAdministratable(user)

  def remove(_task: BSONObjectID)(implicit ctx: DBAccessContext) = {
    for{
      _ <- AnnotationDAO.finishAllWithTaskId(_task)
      _ <- OpenAssignmentService.removeByTask(_task)
      _ <- TaskDAO.removeById(_task)
    } yield true
  }

  def logTime(time: Long, _task: BSONObjectID)(implicit ctx: DBAccessContext) =
    TaskDAO.logTime(time, _task)

  def removeAllWithProject(project: Project)(implicit ctx: DBAccessContext) = {
    for{
      tasks <- project.tasks
      result <- Fox.combined(tasks.map(task => remove(task._id)))
    } yield result.forall(identity)
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
}
