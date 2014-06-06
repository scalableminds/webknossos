package controllers

import play.api.libs.json.Json._
import play.api.libs.json._
import oxalis.security.Secured
import play.api.mvc._
import play.api.Logger
import models.user.User
import views.html
import play.api.Play
import play.api.Play.current
import play.api.i18n.Messages
import oxalis.mail.DefaultMails
import com.scalableminds.util.mail.Send
import play.api.libs.ws.WS
import com.ning.http.client.Realm
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future


object HelpController extends Controller with Secured {

  def faq = Authenticated{ implicit request =>
    Ok(html.help.faq())
  }


  def keyboardShortcuts = Authenticated{ implicit request =>
    Ok(html.help.keyboardshortcuts())
  }

}
