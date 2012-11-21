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
    request.body.file("nmlFile").map { nmlFile =>
      implicit val ctx = NMLContext(request.user)
      (new NMLParser(nmlFile.ref.file).parse).foreach { tracing =>
        Logger.debug("Successfully parsed nmlFile")
        Tracing.save(tracing.copy(
          tracingType = TracingType.Explorational))
        UsedTracings.use(request.user, tracing)
      }
      Ok("File uploaded")
    }.getOrElse {
      BadRequest("Missing file")
    }
  }

  def downloadList = Authenticated { implicit request =>
    val userTracings = Tracing.findAll.groupBy(_._user).flatMap {
      case (userId, tracings) =>
        User.findOneById(userId).map(_ -> tracings)
    }
    Ok(html.admin.nml.nmldownload(userTracings))
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