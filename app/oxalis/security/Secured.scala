package oxalis.security

import play.api.i18n._
import play.api.{Configuration, Play}
import com.scalableminds.util.tools.FoxImplicits
import models.user.{User, UserService}
import play.api.libs.concurrent.Execution.Implicits._
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext}
import javax.inject.Inject
import utils.WkConf

class WebknossosSilhouette @Inject()(config: WkConf,
                                     tokenDAO: TokenDAO,
                                     userService: UserService,
                                     val messagesApi: MessagesApi) extends Silhouette[User, CombinedAuthenticator] with FoxImplicits {

  val environment = new WebknossosEnvironment(config, tokenDAO, userService)

  override protected def env: Environment[User, CombinedAuthenticator] = environment

  implicit def userToDBAccess(user: User): DBAccessContext = {
    AuthorizedAccessContext(user)
  }
}
