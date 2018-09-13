package oxalis.security
import com.mohiva.play.silhouette.api.services.{AuthenticatorService, IdentityService}
import com.mohiva.play.silhouette.api.util.Clock
import com.mohiva.play.silhouette.api.{Env, Environment, EventBus, RequestProvider}
import com.mohiva.play.silhouette.impl.authenticators.{BearerTokenAuthenticatorSettings, CookieAuthenticatorSettings}
import com.mohiva.play.silhouette.impl.util.DefaultFingerprintGenerator
import javax.inject.Inject
import models.user.{User, UserService}
import net.ceedubs.ficus.Ficus._
import net.ceedubs.ficus.readers.ArbitraryTypeReader._
import play.api.i18n.MessagesApi
import play.api.mvc.{Cookie, CookieHeaderEncoding}
import utils.WkConf

import scala.concurrent.duration._
import scala.concurrent.ExecutionContext
import scala.concurrent.ExecutionContext.Implicits.global


trait WkEnv extends Env {
  type I = User
  type A = CombinedAuthenticator
}

class WkSilhouetteEnvironment @Inject()(conf: WkConf,
                                        tokenDAO: TokenDAO,
                                        userService: UserService,
                                        cookieHeaderEncoding: CookieHeaderEncoding
                                     )(implicit val executionContext: ExecutionContext) extends Environment[WkEnv] {
  val eventBusObject = EventBus()

  val cookieSettings = CookieAuthenticatorSettings(
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

  val tokenSettings = BearerTokenAuthenticatorSettings(
    authenticatorIdleTimeout = Some(conf.Silhouette.TokenAuthenticator.authenticatorIdleTimeout.toMillis millis),
    authenticatorExpiry = conf.Silhouette.TokenAuthenticator.authenticatorExpiry.toMillis millis
  )

  val fingerprintGenerator = new DefaultFingerprintGenerator(false)
  val idGenerator = new CompactRandomIDGenerator
  val bearerTokenAuthenticatorDAO = new BearerTokenAuthenticatorRepository(tokenDAO)

  val combinedAuthenticatorService = CombinedAuthenticatorService(cookieSettings,
    tokenSettings, bearerTokenAuthenticatorDAO, fingerprintGenerator, cookieHeaderEncoding, idGenerator, Clock(), userService, conf)

  override def identityService: IdentityService[User] = userService

  override def authenticatorService: AuthenticatorService[CombinedAuthenticator] = combinedAuthenticatorService

  override def requestProviders: Seq[RequestProvider] = Seq()

  override def eventBus: EventBus = eventBusObject
}
