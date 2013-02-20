package controllers

import braingames.mvc.Controller
import brainflight.security.Secured
import models.security.Role
import models.Assertion
import views.html

object AssertionController extends Controller with Secured{

  val DefaultAccessRole = Role.User
  
  def log = Authenticated(parser = parse.urlFormEncoded){ implicit request =>
    for{
      assertion <- postParameter("assertion") ?~ "Assertion is missing"
    } yield {
      val a = Assertion(request.user._id, 0)
      Assertion.insert(a)
      Ok
    }
  }
  
  def list = Authenticated(role = Role.Admin){ implicit request =>
    Ok(html.admin.assertion.assertionList(Assertion.findAll.sortBy(_.timestamp)))
  }
  
  def view(assertionId: String) = Authenticated(role = Role.Admin){ implicit request =>
    for{
      assertion <- Assertion.findOneById(assertionId) ?~ "Assertion not found."
    } yield {
      Ok(html.admin.assertion.assertion(assertion))
    }
  }
}