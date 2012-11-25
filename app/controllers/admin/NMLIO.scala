package controllers.admin

import controllers.Controller
import play.api.mvc.Action
import brainflight.security.Secured
import views.html
import models.user._
import nml._
import models.security.Role
import nml.NMLParser
import xml.Xml
import play.api.Logger
import scala.xml.PrettyPrinter
import models.tracing._

object NMLIO extends Controller with Secured {
  val prettyPrinter = new PrettyPrinter(100, 2)
  // TODO remove comment in production
  // override val DefaultAccessRole = Role( "admin" )

  def uploadForm = Authenticated { implicit request =>
    Ok(html.admin.nml.nmlupload())
  }

  def upload = Authenticated(parse.multipartFormData) { implicit request =>
    request.body.file("nmlFile").flatMap { nmlFile =>
      implicit val ctx = NMLContext(request.user)
      (new NMLParser(nmlFile.ref.file).parse)
        .map { tracing =>
          Logger.debug("Successfully parsed nmlFile")
          Tracing.save(tracing.copy(
            tracingType = TracingType.Explorational))
          UsedTracings.use(request.user, tracing)
          tracing
        }
        .headOption
        .map { tracing =>
          Redirect(controllers.routes.Game.trace(tracing.id)).flashing(
            "success" -> "NML upload successful")
        }
    }.getOrElse {
      Redirect(controllers.routes.UserController.dashboard).flashing(
        "error" -> "Missing file")
    }
  }

  def download(tracingId: String) = Authenticated { implicit request =>
    (for {
      tracing <- Tracing.findOneById(tracingId)
    } yield {
      Ok(prettyPrinter.format(Xml.toXML(tracing))).withHeaders(
        CONTENT_TYPE -> "application/octet-stream",
        CONTENT_DISPOSITION -> ("attachment; filename=%s.nml".format(tracing.dataSetName)))
    }) getOrElse BadRequest
  }

}