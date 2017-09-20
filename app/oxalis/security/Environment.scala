package oxalis.security
import com.google.inject.Inject
import com.mohiva.play.silhouette.api.services.{AuthenticatorService, IdentityService}
import com.mohiva.play.silhouette.api.util.Clock
import com.mohiva.play.silhouette.api.{Authenticator, Environment, EventBus, RequestProvider}
import com.mohiva.play.silhouette.impl.authenticators.{CookieAuthenticator, CookieAuthenticatorService, CookieAuthenticatorSettings}
import com.mohiva.play.silhouette.impl.util.{DefaultFingerprintGenerator, SecureRandomIDGenerator}
import models.user.{User, UserService}
import play.api.Configuration
import net.ceedubs.ficus.Ficus._
import net.ceedubs.ficus.readers.ArbitraryTypeReader._

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration


class EnvironmentOxalis @Inject()(configuration: Configuration) extends Environment[User ,CookieAuthenticator]{
  val fingerprintGenerator = new DefaultFingerprintGenerator(false)
  val idGenerator = new SecureRandomIDGenerator()
  val eventBusObject = EventBus()
  //val configuration = new Configuration(...)
  val config = configuration.underlying.as[CookieAuthenticatorSettings]("silhouette.authenticator")
  //just to test it here; later should be done using silhouette.conf
  //val cookieAuthenticatorSettings = CookieAuthenticatorSettings("authenticator", "/",None, false, true, true, true, None, Some(FiniteDuration.apply(30, "minute")), FiniteDuration.apply(12, "hours"))
  val authenticatorServiceObject = new CookieAuthenticatorService(config, None, fingerprintGenerator, idGenerator, Clock())

  override def identityService: IdentityService[User] = UserService

  override def authenticatorService: AuthenticatorService[CookieAuthenticator] = authenticatorServiceObject

  override def requestProviders: Seq[RequestProvider] = Seq()

  override def eventBus: EventBus = eventBusObject

  override implicit val executionContext: ExecutionContext = executionContext
}
