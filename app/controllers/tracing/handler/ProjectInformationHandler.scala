package controllers.tracing.handler

import net.liftweb.common.Box
import models.tracing.TemporaryTracing
import brainflight.security.AuthenticatedRequest
import models.task.Project
import play.api.i18n.Messages
import controllers.TracingRights
import models.tracing.CompoundTracing

object ProjectInformationHandler extends TracingInformationHandler with TracingRights{
  import braingames.mvc.BoxImplicits._
  
  def provideTracing(projectName: String)(implicit request: AuthenticatedRequest[_]): Box[TemporaryTracing] = {
    (for {
      project <- Project.findOneByName(projectName) ?~ Messages("project.notFound")
      if (isAllowedToViewProject(project, request.user))
      tracing <- CompoundTracing.createFromProject(project)
    } yield {
      tracing
    }) ?~ Messages("notAllowed") ~> 403
  }

}