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
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.FiniteDuration


class EnvironmentOxalis @Inject()(configuration: Configuration)(implicit val executionContext: ExecutionContext) extends Environment[User ,CookieAuthenticator]{
  val fingerprintGenerator = new DefaultFingerprintGenerator(false)
  val idGenerator = new SecureRandomIDGenerator()
  val eventBusObject = EventBus()
  val config = configuration.underlying.as[CookieAuthenticatorSettings]("silhouette.authenticator")
  val authenticatorServiceObject = new CookieAuthenticatorService(config, None, fingerprintGenerator, idGenerator, Clock())

  override def identityService: IdentityService[User] = UserService

  override def authenticatorService: AuthenticatorService[CookieAuthenticator] = authenticatorServiceObject

  override def requestProviders: Seq[RequestProvider] = Seq()

  override def eventBus: EventBus = eventBusObject
}
