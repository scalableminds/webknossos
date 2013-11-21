package controllers

import oxalis.security.Secured
import models.security.{RoleDAO, Role}
import models.assertion.{AssertionDAO, Assertion}
import views.html
import play.api.libs.json.Json
import oxalis.security._
import org.bson.types.ObjectId
import play.api.libs.concurrent.Execution.Implicits._

object AssertionController extends Controller with Secured {

  val DefaultAccessRole = RoleDAO.User

  def log = UserAwareAction(parse.urlFormEncoded) { implicit request =>
    for {
      value <- postParameter("value") ?~ "Value is missing"
      globalContext <- postParameter("globalContext") ?~ "globalContext is missing"
      localContext <- postParameter("localContext") ?~ "localContext is missing"
      message <- postParameter("message") ?~ "message is missing"
      stacktrace <- postParameter("stacktrace") ?~ "stacktrace is missing"
      title <- postParameter("title") ?~ "title is missing"
    } yield {
      val a = Assertion(request.userOpt.map(u => new ObjectId(u._id.stringify)), System.currentTimeMillis(), value, title, message, stacktrace, globalContext, localContext)
      AssertionDAO.insert(a)
      Ok
    }
  }

  def list = Authenticated(role = RoleDAO.Admin).async { implicit request =>
    for {
      assertions <- AssertionDAO.findAllSortedByTimestamp()
    } yield {
      Ok(html.admin.assertion.assertionList(assertions))
    }
  }

  def view(assertionId: String) = Authenticated(role = RoleDAO.Admin).async { implicit request =>
    for {
      assertion <- AssertionDAO.findOneById(assertionId) ?~> "Assertion not found."
    } yield {
      Ok(html.admin.assertion.assertion(assertion))
    }
  }
}