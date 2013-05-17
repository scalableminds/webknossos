package oxalis.tracing.handler

import oxalis.security.AuthenticatedRequest
import net.liftweb.common.Box
import models.tracing.Tracing
import play.api.i18n.Messages
import controllers.TracingRights
import controllers.admin.NMLIO
import models.tracing.TracingLike
import braingames.util.TextUtils._
import models.user.User

object SavedTracingInformationHandler extends TracingInformationHandler with TracingRights {
  import braingames.mvc.BoxImplicits._

  override def nameForTracing(t: TracingLike): String = {
    normalize("%s__%s__%s__%s".format(
      t.dataSetName,
      t.task.map(_.id) getOrElse ("explorational"),
      t.user.map(_.abreviatedName) getOrElse "",
      oxalis.view.helpers.formatHash(t.id)))
  }

  def provideTracing(tracingId: String): Box[Tracing] = {
    (for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
    } yield {
        tracing
    }) ?~ Messages("notAllowed") ~> 403
  }
  
  override def cache = false
}