package security

import play.silhouette.api.services.{AuthenticatorService, IdentityService}
import play.silhouette.api.util.Clock
import play.silhouette.api.{Env, Environment, EventBus, RequestProvider}
import play.silhouette.impl.authenticators.{BearerTokenAuthenticatorSettings, CookieAuthenticatorSettings}
import play.silhouette.impl.util.DefaultFingerprintGenerator
import models.user.{User, UserService}
import play.api.libs.json.JsResult
import play.api.libs.json.JsResult.Exception
import play.api.mvc.{Cookie, CookieHeaderEncoding}
import utils.WkConf

import java.lang
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

trait WkEnv extends Env {
  type I = User
  type A = CombinedAuthenticator
}

class WkSilhouetteEnvironment @Inject()(
    conf: WkConf,
    tokenDAO: TokenDAO,
    userService: UserService,
    cookieHeaderEncoding: CookieHeaderEncoding)(implicit val executionContext: ExecutionContext)
    extends Environment[WkEnv] {
  private val eventBusObject = EventBus()

  private val cookieSettings = CookieAuthenticatorSettings(
    conf.Silhouette.CookieAuthenticator.cookieName,
    conf.Silhouette.CookieAuthenticator.cookiePath,
    None,
    conf.Silhouette.CookieAuthenticator.secureCookie,
    conf.Silhouette.CookieAuthenticator.httpOnlyCookie,
    conf.Silhouette.CookieAuthenticator.sameSite match {
      case "Strict" => Some(Cookie.SameSite.Strict)
      case "Lax"    => Some(Cookie.SameSite.Lax)
      case "None"   => None
      case _ =>
        throw new RuntimeException(
          s"Invalid config setting silhouette.cookieAuthenticator.sameSite. Must be Strict, Lax, or None. Got ${conf.Silhouette.CookieAuthenticator.sameSite}")
    },
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
