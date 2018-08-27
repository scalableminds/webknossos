package oxalis.security

import javax.inject.Inject
import play.api.i18n._
import play.api.Play
import com.scalableminds.util.tools.FoxImplicits
import models.user.User
import play.api.Configuration
import play.api.Play.current
import play.api.libs.concurrent.Execution.Implicits._
import com.mohiva.play.silhouette.api.{Environment, Silhouette}

class WebknossosSilhouette @Inject() (config: Configuration)
  extends Silhouette[User, CombinedAuthenticator]
    with FoxImplicits{
  val lang = new DefaultLangs(config)
  val messagesAPIEnvironment  = play.api.Environment.simple()

  val environment = new WebknossosEnvironment(config)

  override protected def env: Environment[User, CombinedAuthenticator] = environment

  override def messagesApi: MessagesApi = new DefaultMessagesApi(messagesAPIEnvironment, config, lang)
}

