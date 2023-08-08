package oxalis.security

import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.api.exceptions.{AuthenticatorCreationException, AuthenticatorInitializationException}
import com.mohiva.play.silhouette.api.services.AuthenticatorService.{CreateError, InitError}
import com.mohiva.play.silhouette.api.util.{Clock, IDGenerator}
import com.mohiva.play.silhouette.impl.authenticators.BearerTokenAuthenticatorService.ID
import com.mohiva.play.silhouette.impl.authenticators.{
  BearerTokenAuthenticator,
  BearerTokenAuthenticatorService,
  BearerTokenAuthenticatorSettings
}
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.{User, UserService}
import oxalis.security.TokenType.TokenType
import utils.{ObjectId, WkConf}

import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}

class WebknossosBearerTokenAuthenticatorService(settings: BearerTokenAuthenticatorSettings,
                                                repository: BearerTokenAuthenticatorRepository,
                                                idGenerator: IDGenerator,
                                                clock: Clock,
                                                userService: UserService,
                                                conf: WkConf)(implicit override val executionContext: ExecutionContext)
    extends BearerTokenAuthenticatorService(settings, repository, idGenerator, clock)
    with FoxImplicits {

  private val resetPasswordExpiry: FiniteDuration =
    conf.Silhouette.TokenAuthenticator.resetPasswordExpiry.toMillis millis
  val dataStoreExpiry: FiniteDuration = conf.Silhouette.TokenAuthenticator.dataStoreExpiry.toMillis millis

  def create(loginInfo: LoginInfo, tokenType: TokenType): Future[BearerTokenAuthenticator] = {
    val expiry: Duration = tokenType match {
      case TokenType.Authentication => settings.authenticatorExpiry
      case TokenType.ResetPassword  => resetPasswordExpiry
      case TokenType.DataStore      => dataStoreExpiry
      case _                        => throw new Exception("Cannot create an authenticator without a valid TokenType")
    }
    idGenerator.generate.map { id =>
      val now = clock.now
      BearerTokenAuthenticator(id = id,
                               loginInfo = loginInfo,
                               lastUsedDateTime = now,
                               expirationDateTime = now.plus(expiry.toMillis),
                               idleTimeout = settings.authenticatorIdleTimeout)
    }.recover {
      case e => throw new AuthenticatorCreationException(CreateError.format(ID, loginInfo), e)
    }
  }

  def init(authenticator: BearerTokenAuthenticator, tokenType: TokenType, deleteOld: Boolean = true): Future[String] =
    repository
      .add(authenticator, tokenType, deleteOld)
      .map { a =>
        a.id
      }
      .recover {
        case e => throw new AuthenticatorInitializationException(InitError.format(ID, authenticator), e)
      }

  def createAndInitDataStoreTokenForUser(user: User): Fox[String] =
    createAndInit(user.loginInfo, TokenType.DataStore, deleteOld = false)

  def createAndInit(loginInfo: LoginInfo, tokenType: TokenType, deleteOld: Boolean = true): Future[String] =
    for {
      tokenAuthenticator <- create(loginInfo, tokenType)
      tokenId <- init(tokenAuthenticator, tokenType, deleteOld)
    } yield tokenId

  def userForToken(tokenValue: String): Fox[User] =
    for {
      tokenAuthenticator <- repository.findOneByValue(tokenValue) ?~> "auth.invalidToken"
      _ <- bool2Fox(tokenAuthenticator.isValid) ?~> "auth.invalidToken"
      idValidated <- ObjectId.fromString(tokenAuthenticator.loginInfo.providerKey) ?~> "auth.invalidToken"
      user <- userService.findOneCached(idValidated)(GlobalAccessContext)
    } yield user

  def userForTokenOpt(tokenOpt: Option[String]): Fox[User] = tokenOpt match {
    case Some(token) => userForToken(token)
    case _           => Fox.empty
  }

  def remove(tokenValue: String): Fox[Unit] =
    repository.remove(tokenValue)

  def removeExpiredTokens(): Fox[Unit] =
    repository.deleteAllExpired()
}
