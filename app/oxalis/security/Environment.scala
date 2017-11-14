package oxalis.security
import com.google.inject.Inject
import com.mohiva.play.silhouette.api.services.{AuthenticatorService, IdentityService}
import com.mohiva.play.silhouette.api.util.Clock
import com.mohiva.play.silhouette.api.{Authenticator, Environment, EventBus, RequestProvider}
import com.mohiva.play.silhouette.impl.authenticators.{BearerTokenAuthenticatorSettings, CookieAuthenticator, CookieAuthenticatorService, CookieAuthenticatorSettings}
import com.mohiva.play.silhouette.impl.util.{DefaultFingerprintGenerator, SecureRandomIDGenerator}
import models.user.{User, UserService}
import play.api.Configuration
import net.ceedubs.ficus.Ficus._
import net.ceedubs.ficus.readers.ArbitraryTypeReader._

import scala.concurrent.ExecutionContext
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._
import scala.concurrent.duration.FiniteDuration
import org.joda.time.DateTime


class EnvironmentOxalis @Inject()(configuration: Configuration)(implicit val executionContext: ExecutionContext) extends Environment[User ,CombinedAuthenticator]{
  val eventBusObject = EventBus()
  val cookieSettings = configuration.underlying.as[CookieAuthenticatorSettings]("silhouette.authenticator")
  val tokenSettings = BearerTokenAuthenticatorSettings("X-Auth-Token", None, 365 days) //maybe change the authenticatorExpiry and write it in a .conf file
  val fingerprintGenerator = new DefaultFingerprintGenerator(false)
  val idGenerator = new SecureRandomIDGenerator()
  //val authenticatorServiceObject = new CookieAuthenticatorService(cookieSettings, None, fingerprintGenerator, idGenerator, Clock())

  val combinedAuthenticatorService = new CombinedAuthenticatorService(cookieSettings, tokenSettings, None, new CombinedAuthenticatorDAO, fingerprintGenerator, idGenerator, Clock())

  override def identityService: IdentityService[User] = UserService

  override def authenticatorService: AuthenticatorService[CombinedAuthenticator] = combinedAuthenticatorService

  override def requestProviders: Seq[RequestProvider] = Seq()

  override def eventBus: EventBus = eventBusObject
}
