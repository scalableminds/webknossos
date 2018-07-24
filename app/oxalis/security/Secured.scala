package oxalis.security

import play.api.i18n._
import play.api.Play
import com.scalableminds.util.tools.FoxImplicits
import models.user.{UserSQL}
import play.api.Play.current
import play.api.libs.concurrent.Execution.Implicits._
import com.mohiva.play.silhouette.api.{Environment, Silhouette}


object WebknossosSilhouette extends Silhouette[UserSQL, CombinedAuthenticator] with FoxImplicits{

  val config = Play.configuration
  val lang = new DefaultLangs(config)
  val messagesAPIEnvironment  = play.api.Environment.simple()

  val environment = new WebknossosEnvironment(config)

  override protected def env: Environment[UserSQL, CombinedAuthenticator] = environment

  override def messagesApi: MessagesApi = new DefaultMessagesApi(messagesAPIEnvironment, config, lang)
}

