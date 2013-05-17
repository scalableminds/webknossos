package oxalis.tracing.handler

import controllers.TracingRights
import net.liftweb.common.Box
import models.tracing.TemporaryTracing
import oxalis.security.AuthenticatedRequest
import models.task.TaskType
import play.api.i18n.Messages
import models.tracing.CompoundTracing

object TaskTypeInformationHandler extends TracingInformationHandler with TracingRights{
  import braingames.mvc.BoxImplicits._
  
  def provideTracing(taskTypeId: String): Box[TemporaryTracing] = {
    (for {
      taskType <- TaskType.findOneById(taskTypeId) ?~ Messages("taskType.notFound")
      tracing <- CompoundTracing.createFromTaskType(taskType)
    } yield {
      tracing.copy(accessFkt = isAllowedToViewTaskType(taskType, _))
    }) ?~ Messages("notAllowed") ~> 403
  }
}