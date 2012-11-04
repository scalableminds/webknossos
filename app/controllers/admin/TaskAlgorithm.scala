package controllers.admin

import play.api.mvc.Controller
import play.api.mvc.Action
import brainflight.security.Secured
import views.html
import models.user.User
import models.security.Role
import models.task._
import play.api.libs.json.Json

object TaskAlgorithm extends Controller with Secured {
  // TODO remove comment in production
  override val DefaultAccessRole = Role( "admin" )

  def testAlgorithm = Authenticated(parser = parse.urlFormEncoded){ implicit request =>
    request.body.get("code").flatMap(_.headOption) match {
      case Some(code) =>
        if (TaskSelectionAlgorithm.isValidAlgorithm(code))
          Ok
        else
          (new Status(422))("Invalid task selection algorithm code.")
      case _ =>
        BadRequest("Missing parameters.")
    }
  }

  def index = Authenticated { implicit request =>
    Ok(html.admin.task.taskSelectionAlgorithm(request.user, TaskSelectionAlgorithm.findAll, TaskSelectionAlgorithm.current))
  }

  def submitAlgorithm = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    (for {
      code <- request.body.get("code").flatMap(_.headOption)
      use <- request.body.get("use").flatMap(_.headOption)
    } yield {
      if (TaskSelectionAlgorithm.isValidAlgorithm(code)) {
        val alg = TaskSelectionAlgorithm(code)
        TaskSelectionAlgorithm.insert(alg)
        if (use == "1")
          TaskSelectionAlgorithm.use(alg)
        Ok
      } else
        (new Status(422))("Invalid task selection algorithm code.")
    }) getOrElse BadRequest("Missing parameters.")

  }

  def useAlgorithm(id: String) = Authenticated { implicit request =>
    TaskSelectionAlgorithm.findOneById(id) match {
      case Some(alg) => 
        TaskSelectionAlgorithm.use(alg)
        Ok
      case _ =>
        BadRequest("Algorithm not found.")
    }
  }

  def listAlgorithms = Authenticated { implicit request =>
    Ok(Json.toJson(TaskSelectionAlgorithm.findAll))
  }
}