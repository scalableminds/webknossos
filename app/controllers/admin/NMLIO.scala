package controllers.admin

import play.api.mvc.Controller
import play.api.mvc.Action
import brainflight.security.Secured
import views.html
import models.User
import nml._
import models.graph.Experiment
import models.Role
import nml.NMLParser
import xml.Xml

object NMLIO extends Controller with Secured {
  // TODO remove comment in production
  // override val DefaultAccessRole = Role( "admin" )

  def uploadForm = Authenticated { implicit request =>
    Ok(html.admin.nmlupload(request.user))
  }

  def upload = Action(parse.multipartFormData) { implicit request =>
    request.body.file("nmlFile").map { nmlFile =>
      (new NMLParser(nmlFile.ref.file).parse).foreach { e =>
        User.save(User.default.copy(tasks = List(e._id)))
        Experiment.save(e)
      }
      Ok("File uploaded")
    }.getOrElse {
      BadRequest("Missing file")
    }
  }

  def downloadList = Authenticated { implicit request =>
    Ok(html.admin.index(request.user, User.findAll))
  }

  def download(taskId: String) = Authenticated { implicit request =>
    (for {
      task <- Experiment.findOneById(taskId)
    } yield {
      Ok(Xml.toXML(task)).withHeaders(
        CONTENT_TYPE -> "application/octet-stream",
        CONTENT_DISPOSITION -> ("attachment; filename=%s.nml".format(task.dataSetId)))
    }) getOrElse BadRequest
  }

}