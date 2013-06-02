package oxalis.tracing.handler

import net.liftweb.common.Box
import models.tracing.CompoundAnnotation
import models.task.TaskType
import play.api.i18n.Messages
import models.annotation.{AnnotationRestrictions, TemporaryAnnotation}
import models.user.User
import models.security.Role

object TaskTypeInformationHandler extends AnnotationInformationHandler {

  import braingames.mvc.BoxImplicits._

  type AType = TemporaryAnnotation

  def taskTypeAnnotationRestrictions(taskType: TaskType) =
    new AnnotationRestrictions {
      override def allowAccess(user: User) =
        Role.Admin.map(user.hasRole) getOrElse false
    }

  def provideAnnotation(taskTypeId: String): Box[TemporaryAnnotation] = {
    for {
      taskType <- TaskType.findOneById(taskTypeId) ?~ Messages("taskType.notFound")
      annotation <- CompoundAnnotation.createFromTaskType(taskType) ?~ Messages("taskType.noAnnotations")
    } yield {
      annotation.copy(restrictions = taskTypeAnnotationRestrictions(taskType))
    }
  }
}