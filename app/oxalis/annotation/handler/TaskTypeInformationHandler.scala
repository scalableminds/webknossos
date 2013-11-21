package oxalis.annotation.handler

import net.liftweb.common.Box
import models.task.{TaskTypeDAO, TaskType}
import play.api.i18n.Messages
import models.annotation.{AnnotationRestrictions, TemporaryAnnotation}
import models.user.User
import models.security.{RoleDAO, Role}
import models.tracing.skeleton.CompoundAnnotation
import braingames.reactivemongo.DBAccessContext
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import braingames.util.{FoxImplicits, Fox}

object TaskTypeInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  import braingames.mvc.BoxImplicits._

  type AType = TemporaryAnnotation

  def taskTypeAnnotationRestrictions(taskType: TaskType) =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) =
        user.flatMap {
          user =>
            RoleDAO.Admin.map(user.hasRole)
        } getOrElse false
    }

  def provideAnnotation(taskTypeId: String)(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation] = {
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      annotation <- CompoundAnnotation.createFromTaskType(taskType) ?~> Messages("taskType.noAnnotations")
    } yield {
      annotation.copy(restrictions = taskTypeAnnotationRestrictions(taskType))
    }
  }
}