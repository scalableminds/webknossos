package controllers

import oxalis.security.Secured
import views.html


object HelpController extends Controller with Secured {

  def faq = Authenticated { implicit request =>
    Ok(html.help.faq())
  }

  def keyboardShortcuts = Authenticated { implicit request =>
    Ok(html.help.keyboardshortcuts())
  }

}
