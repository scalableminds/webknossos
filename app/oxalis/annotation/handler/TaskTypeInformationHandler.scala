package oxalis.annotation.handler

import net.liftweb.common.Box
import models.task.{TaskTypeDAO, TaskType}
import play.api.i18n.Messages
import models.annotation.{AnnotationRestrictions, TemporaryAnnotation}
import models.user.User
import models.tracing.skeleton.CompoundAnnotation
import braingames.reactivemongo.DBAccessContext
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import braingames.util.{FoxImplicits, Fox}
import models.team.Role

object TaskTypeInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  import braingames.mvc.BoxImplicits._

  type AType = TemporaryAnnotation

  def taskTypeAnnotationRestrictions(taskType: TaskType) =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) =
        user.flatMap(_.roleInTeam(taskType.team)) == Some(Role.Admin)
    }

  def provideAnnotation(taskTypeId: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation] = {
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      annotation <- CompoundAnnotation.createFromTaskType(taskType) ?~> Messages("taskType.noAnnotations")
    } yield {
      annotation.copy(restrictions = taskTypeAnnotationRestrictions(taskType))
    }
  }
}