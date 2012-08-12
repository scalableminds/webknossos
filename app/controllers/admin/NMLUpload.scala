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

object NMLUpload extends Controller with Secured{
  // TODO remove comment in production
  // override val DefaultAccessRole = Role( "admin" )
  
  def index = Authenticated{ implicit request =>
    Ok(html.admin.nmlupload(request.user))
  }
  
  def upload = Action(parse.multipartFormData){ implicit request =>
    println("mhm")
    request.body.file("nmlFile").map { nmlFile =>
      import java.io.File
      println("called")
      val filename = nmlFile.filename 
      val contentType = nmlFile.contentType
      val fileName = "/tmp/nmlFile"+System.currentTimeMillis
      (new NMLParser(nmlFile.ref.file).parse).foreach( Experiment.save )
      Ok("File uploaded")
    }.getOrElse {
      BadRequest("Missing file")
    }
  }
  
}