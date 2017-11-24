package oxalis.security
import com.google.inject.Inject
import com.mohiva.play.silhouette.api.services.{AuthenticatorService, IdentityService}
import com.mohiva.play.silhouette.api.util.Clock
import com.mohiva.play.silhouette.api.{Environment, EventBus, RequestProvider}
import com.mohiva.play.silhouette.impl.authenticators.{BearerTokenAuthenticatorSettings, CookieAuthenticatorSettings}
import com.mohiva.play.silhouette.impl.util.{DefaultFingerprintGenerator, SecureRandomIDGenerator}
import models.user.{User, UserService}
import net.ceedubs.ficus.Ficus._
import net.ceedubs.ficus.readers.ArbitraryTypeReader._
import play.api.Configuration

import scala.concurrent.ExecutionContext
import scala.concurrent.ExecutionContext.Implicits.global


class WebknossosEnvironment @Inject()(configuration: Configuration)(implicit val executionContext: ExecutionContext) extends Environment[User, CombinedAuthenticator] {
  val eventBusObject = EventBus()
  val cookieSettings = configuration.underlying.as[CookieAuthenticatorSettings]("silhouette.cookieAuthenticator")
  val tokenSettings = configuration.underlying.as[BearerTokenAuthenticatorSettings]("silhouette.tokenAuthenticator")
  val fingerprintGenerator = new DefaultFingerprintGenerator(false)
  val idGenerator = new SecureRandomIDGenerator()
  val tokenDAO = new BearerTokenAuthenticatorDAO

  val combinedAuthenticatorService = CombinedAuthenticatorService(cookieSettings, tokenSettings, tokenDAO, fingerprintGenerator, idGenerator, Clock())

  override def identityService: IdentityService[User] = UserService

  override def authenticatorService: AuthenticatorService[CombinedAuthenticator] = combinedAuthenticatorService

  override def requestProviders: Seq[RequestProvider] = Seq()

  override def eventBus: EventBus = eventBusObject
}
