package controllers.tracing.handler

import controllers.TracingRights
import net.liftweb.common.Box
import models.tracing.TemporaryTracing
import brainflight.security.AuthenticatedRequest
import models.task.TaskType
import play.api.i18n.Messages
import models.tracing.CompoundTracing
import models.task.Task
import models.user.User

object TaskInformationHandler extends TracingInformationHandler with TracingRights{
  import braingames.mvc.BoxImplicits._
  
  def provideTracing(taskId: String): Box[TemporaryTracing] = {
    (for {
      task <- Task.findOneById(taskId) ?~ Messages("task.notFound")
      tracing <- CompoundTracing.createFromTask(task)
    } yield {
      tracing.copy(accessFkt = isAllowedToViewTask(task, _))
    }) ?~ Messages("notAllowed") ~> 403
  }
}