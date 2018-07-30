package oxalis.security

import play.api.i18n._
import play.api.Play
import com.scalableminds.util.tools.FoxImplicits
import models.user.{User}
import play.api.Play.current
import play.api.libs.concurrent.Execution.Implicits._
import com.mohiva.play.silhouette.api.{Environment, Silhouette}


object WebknossosSilhouette extends Silhouette[User, CombinedAuthenticator] with FoxImplicits{

  val config = Play.configuration
  val lang = new DefaultLangs(config)
  val messagesAPIEnvironment  = play.api.Environment.simple()

  val environment = new WebknossosEnvironment(config)

  override protected def env: Environment[User, CombinedAuthenticator] = environment

  override def messagesApi: MessagesApi = new DefaultMessagesApi(messagesAPIEnvironment, config, lang)
}

