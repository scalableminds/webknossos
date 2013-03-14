package controllers.tracing.handler

import controllers.TracingRights
import net.liftweb.common.Box
import models.tracing.TemporaryTracing
import brainflight.security.AuthenticatedRequest
import models.task.TaskType
import play.api.i18n.Messages
import models.tracing.CompoundTracing

object TaskTypeInformationHandler extends TracingInformationHandler with TracingRights{
  import braingames.mvc.BoxImplicits._
  
  def provideTracing(taskTypeId: String)(implicit request: AuthenticatedRequest[_]): Box[TemporaryTracing] = {
    (for {
      taskType <- TaskType.findOneById(taskTypeId) ?~ Messages("taskType.notFound")
      if (isAllowedToViewTaskType(taskType, request.user))
      tracing <- CompoundTracing.createFromTaskType(taskType)
    } yield {
      tracing
    }) ?~ Messages("notAllowed") ~> 403
  }
}