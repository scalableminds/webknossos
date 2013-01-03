package controllers.admin

import brainflight.security.Secured
import models.security.Role
import models.task.TaskSelectionAlgorithm
import play.api.libs.json.Json
import views.html
import controllers.Controller
import play.api.i18n.Messages

object TaskAlgorithm extends Controller with Secured {
  //finished localization
  override val DefaultAccessRole = Role.Admin

  def testAlgorithm = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    (for {
      code <- postParameter("code") ?~ Messages("taskAlgorithm.notSupplied")
      if (TaskSelectionAlgorithm.isValidAlgorithm(code))
    } yield {
      Ok
    }) ?~ Messages("taskAlgorithm.invalid") ~> 422
  }

  def index = Authenticated { implicit request =>
    Ok(html.admin.task.taskSelectionAlgorithm(TaskSelectionAlgorithm.findAll, TaskSelectionAlgorithm.current))
  }

  def submitAlgorithm = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    (for {
      code <- postParameter("code") ?~ Messages("taskAlgorithm.notSupplied")
      use <- postParameter("use") ?~ Messages("taskAlgorithm.use.notSupplied")
      if (TaskSelectionAlgorithm.isValidAlgorithm(code))
    } yield {
      val alg = TaskSelectionAlgorithm(code)
      TaskSelectionAlgorithm.insertOne(alg)
      if (use == "1")
        TaskSelectionAlgorithm.use(alg)
      Ok
    }) ?~ Messages("taskAlgorithm.invalid") ~> 422
  }

  def useAlgorithm(id: String) = Authenticated { implicit request =>
    for {
      algorithm <- TaskSelectionAlgorithm.findOneById(id) ?~ Messages("taskAlgorithm.notFound")
    } yield {
      TaskSelectionAlgorithm.use(algorithm)
      Ok
    }
  }

  def listAlgorithms = Authenticated { implicit request =>
    Ok(Json.toJson(TaskSelectionAlgorithm.findAll))
  }
}