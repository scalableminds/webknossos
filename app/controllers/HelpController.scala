package controllers

import javax.inject.Inject

import oxalis.security.silhouetteOxalis._
import play.api.i18n.MessagesApi
import views.html


class HelpController @Inject() (val messagesApi: MessagesApi) extends Controller{

  def faq = SecuredAction { implicit request =>
    Ok(html.help.faq())
  }

  def keyboardShortcuts = SecuredAction { implicit request =>
    Ok(html.help.keyboardshortcuts())
  }

}
