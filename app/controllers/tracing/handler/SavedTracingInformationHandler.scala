package controllers.tracing.handler

import brainflight.security.AuthenticatedRequest
import net.liftweb.common.Box
import models.tracing.Tracing
import play.api.i18n.Messages
import controllers.TracingRights
import controllers.admin.NMLIO
import models.tracing.TracingLike
import braingames.util.TextUtils._

object SavedTracingInformationHandler extends TracingInformationHandler with TracingRights{
  import braingames.mvc.BoxImplicits._
  
  override def nameForTracing(t: TracingLike): String = {
    normalize("%s__%s__%s__%s".format(
        t.dataSetName,
        t.task.map(_.id) getOrElse ("explorational"),
        t.user.map(_.abreviatedName) getOrElse "",
        brainflight.view.helpers.formatHash(t.id)))
  }
  
  def provideTracing(tracingId: String)(implicit request: AuthenticatedRequest[_]): Box[Tracing] = {
    (for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      if (isAllowedToViewTracing(tracing, request.user))
    } yield {
      tracing
    }) ?~ Messages("notAllowed") ~> 403
  }
}