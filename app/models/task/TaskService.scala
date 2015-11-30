package models.task

import models.annotation.{AnnotationService, Annotation, AnnotationType, AnnotationDAO}
import com.scalableminds.util.reactivemongo.DBAccessContext
import reactivemongo.bson.BSONObjectID

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.concurrent.Execution.Implicits._
import models.user.{User, Experience}
import scala.concurrent.Future
import play.api.Logger
import reactivemongo.core.commands.LastError

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 19.11.13
 * Time: 14:59
 */
object TaskService extends TaskAssignmentSimulation with TaskAssignment with FoxImplicits {

  def findAllAssignable(implicit ctx: DBAccessContext) = TaskDAO.findAllAssignable

  def findAll(implicit ctx: DBAccessContext) = TaskDAO.findAll

  def findAllAdministratable(user: User)(implicit ctx: DBAccessContext) =
    TaskDAO.findAllAdministratable(user)

  def remove(_task: BSONObjectID)(implicit ctx: DBAccessContext) = {
    TaskDAO.removeById(_task).flatMap{
      case result if result.n > 0 =>
        AnnotationDAO.removeAllWithTaskId(_task)
      case _ =>
        Logger.warn("Tried to remove task without permission.")
        Future.successful(LastError(false ,None, None, None, None, 0, false))
    }
  }

  def assignOnce(t: Task)(implicit ctx: DBAccessContext) =
    TaskDAO.assignOnce(t._id)

  def unassignOnce(t: Task)(implicit ctx: DBAccessContext) =
    TaskDAO.unassignOnce(t._id)

  def logTime(time: Long, _task: BSONObjectID)(implicit ctx: DBAccessContext) = {
    TaskDAO.logTime(time, _task)
  }
}
