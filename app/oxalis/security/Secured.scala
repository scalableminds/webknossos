package oxalis.security

import play.api.i18n._
import play.api.mvc.Request
import play.api.{Configuration, Logger, Play}

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import controllers.routes
import models.user.{User, UserService}
import net.liftweb.common.{Empty, Full}
import play.api.Play.current
import play.api.libs.concurrent.Execution.Implicits._

import com.mohiva.play.silhouette.api.{Environment, SecuredErrorHandler, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.CookieAuthenticator


object WebknossosSilhouette extends Silhouette[User, CombinedAuthenticator] with FoxImplicits{

  val config = Play.configuration
  val lang = new DefaultLangs(config)
  val messagesAPIEnvironment  = play.api.Environment.simple()

  val environment = new WebknossosEnvironment(config)

  override protected def env: Environment[User, CombinedAuthenticator] = environment

  override def messagesApi: MessagesApi = new DefaultMessagesApi(messagesAPIEnvironment, config, lang)
}

