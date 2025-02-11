package security

import play.silhouette.api.services.{AuthenticatorService, IdentityService}
import play.silhouette.api.util.Clock
import play.silhouette.api.{Env, Environment, EventBus, RequestProvider}
import play.silhouette.impl.authenticators.{BearerTokenAuthenticatorSettings, CookieAuthenticatorSettings}
import play.silhouette.impl.util.DefaultFingerprintGenerator
import models.user.{User, UserService}
import play.api.mvc.{Cookie, CookieHeaderEncoding}
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

trait WkEnv extends Env {
  type I = User
  type A = CombinedAuthenticator
}

class WkSilhouetteEnvironment @Inject() (
    conf: WkConf,
    tokenDAO: TokenDAO,
    userService: UserService,
    cookieHeaderEncoding: CookieHeaderEncoding
)(implicit val executionContext: ExecutionContext)
    extends Environment[WkEnv] {
  private val eventBusObject = EventBus()

  private val cookieSettings = CookieAuthenticatorSettings(
    conf.Silhouette.CookieAuthenticator.cookieName,
    conf.Silhouette.CookieAuthenticator.cookiePath,
    None,
    conf.Silhouette.CookieAuthenticator.secureCookie,
    conf.Silhouette.CookieAuthenticator.httpOnlyCookie,
    Some(Cookie.SameSite.Lax),
    conf.Silhouette.CookieAuthenticator.useFingerprinting,
    Some(conf.Silhouette.CookieAuthenticator.cookieMaxAge.toMillis millis),
    None,
    conf.Silhouette.CookieAuthenticator.authenticatorExpiry.toMillis millis
  )

  private val tokenSettings = BearerTokenAuthenticatorSettings(
    authenticatorIdleTimeout = Some(conf.Silhouette.TokenAuthenticator.authenticatorIdleTimeout.toMillis millis),
    authenticatorExpiry = conf.Silhouette.TokenAuthenticator.authenticatorExpiry.toMillis millis
  )

  private val fingerprintGenerator = new DefaultFingerprintGenerator(false)
  private val idGenerator = new RandomIDGenerator
  private val bearerTokenAuthenticatorDAO = new BearerTokenAuthenticatorRepository(tokenDAO)

  val combinedAuthenticatorService: CombinedAuthenticatorService = CombinedAuthenticatorService(
    cookieSettings,
    tokenSettings,
    bearerTokenAuthenticatorDAO,
    fingerprintGenerator,
    cookieHeaderEncoding,
    idGenerator,
    Clock(),
    userService,
    conf
  )

  override def identityService: IdentityService[User] = userService

  override def authenticatorService: AuthenticatorService[CombinedAuthenticator] = combinedAuthenticatorService

  override def requestProviders: Seq[RequestProvider] = Seq.empty

  override def eventBus: EventBus = eventBusObject
}
