package controllers.tracing.handler

import controllers.TracingRights
import net.liftweb.common.Box
import models.tracing.TemporaryTracing
import brainflight.security.AuthenticatedRequest
import models.task.TaskType
import play.api.i18n.Messages
import models.tracing.CompoundTracing
import models.task.Task

object TaskInformationHandler extends TracingInformationHandler with TracingRights{
  import braingames.mvc.BoxImplicits._
  
  def provideTracing(taskId: String)(implicit request: AuthenticatedRequest[_]): Box[TemporaryTracing] = {
    (for {
      task <- Task.findOneById(taskId) ?~ Messages("task.notFound")
      if (isAllowedToViewTask(task, request.user))
      tracing <- CompoundTracing.createFromTask(task)
    } yield {
      tracing
    }) ?~ Messages("notAllowed") ~> 403
  }
}