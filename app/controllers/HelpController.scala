package controllers

import javax.inject.Inject

import oxalis.security.Secured
import play.api.i18n.MessagesApi
import views.html


class HelpController @Inject() (val messagesApi: MessagesApi) extends Controller with Secured {

  def faq = Authenticated { implicit request =>
    Ok(html.help.faq())
  }

  def keyboardShortcuts = Authenticated { implicit request =>
    Ok(html.help.keyboardshortcuts())
  }

}
