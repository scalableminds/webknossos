package controllers.tracing.handler

import net.liftweb.common.Box
import models.tracing.TemporaryTracing
import brainflight.security.AuthenticatedRequest
import models.task.Project
import play.api.i18n.Messages
import controllers.TracingRights
import models.tracing.CompoundTracing
import models.user.User

object ProjectInformationHandler extends TracingInformationHandler with TracingRights{
  import braingames.mvc.BoxImplicits._
  
  def provideTracing(projectName: String): Box[TemporaryTracing] = {
    (for {
      project <- Project.findOneByName(projectName) ?~ Messages("project.notFound")
      tracing <- CompoundTracing.createFromProject(project)
    } yield {
      tracing.copy(accessFkt = isAllowedToViewProject(project, _))
    }) ?~ Messages("notAllowed") ~> 403
  }

}