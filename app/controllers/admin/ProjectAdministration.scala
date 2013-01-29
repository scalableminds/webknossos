package controllers.admin;

import braingames.mvc.Controller
import brainflight.security.Secured
import models.security.Role
import views._
import models.task.Project

object ProjectAdministration extends Controller with Secured {

  override val DefaultAccessRole = Role.Admin

  def list = Authenticated { implicit request =>
    Ok(html.admin.project.projectList(Project.findAll))
  }
  
  def delete(projectName: String ) = Authenticated{ implicit reuqest =>
    Ok
  }
}
