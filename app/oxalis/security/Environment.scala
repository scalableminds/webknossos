package oxalis.security
import com.google.inject.Inject
import com.mohiva.play.silhouette.api.services.{AuthenticatorService, IdentityService}
import com.mohiva.play.silhouette.api.util.Clock
import com.mohiva.play.silhouette.api.{Environment, EventBus, RequestProvider}
import com.mohiva.play.silhouette.impl.authenticators.{BearerTokenAuthenticatorSettings, CookieAuthenticatorSettings}
import com.mohiva.play.silhouette.impl.util.DefaultFingerprintGenerator
import models.user.{User, UserService}
import net.ceedubs.ficus.Ficus._
import net.ceedubs.ficus.readers.ArbitraryTypeReader._
import play.api.Configuration
import utils.WkConfInjected

import scala.concurrent.ExecutionContext
import scala.concurrent.ExecutionContext.Implicits.global


class WebknossosEnvironment @Inject()(conf: WkConfInjected,
                                      tokenDAO: TokenDAO,
                                      userService: UserService)(implicit val executionContext: ExecutionContext) extends Environment[User, CombinedAuthenticator] {
  val eventBusObject = EventBus()
  val cookieSettings = conf.raw.underlying.as[CookieAuthenticatorSettings]("silhouette.cookieAuthenticator")
  val tokenSettings = conf.raw.underlying.as[BearerTokenAuthenticatorSettings]("silhouette.tokenAuthenticator")
  val fingerprintGenerator = new DefaultFingerprintGenerator(false)
  val idGenerator = new CompactRandomIDGenerator
  val bearerTokenAuthenticatorDAO = new BearerTokenAuthenticatorDAO(tokenDAO)

  val combinedAuthenticatorService = CombinedAuthenticatorService(cookieSettings,
    tokenSettings, bearerTokenAuthenticatorDAO, fingerprintGenerator, idGenerator, Clock(), userService, conf)

  override def identityService: IdentityService[User] = userService

  override def authenticatorService: AuthenticatorService[CombinedAuthenticator] = combinedAuthenticatorService

  override def requestProviders: Seq[RequestProvider] = Seq()

  override def eventBus: EventBus = eventBusObject
}
