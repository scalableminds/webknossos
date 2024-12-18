package security

import play.silhouette.api.LoginInfo
import play.silhouette.api.exceptions.{AuthenticatorCreationException, AuthenticatorInitializationException}
import play.silhouette.api.services.AuthenticatorService.{CreateError, InitError}
import play.silhouette.api.util.{Clock, IDGenerator}
import play.silhouette.impl.authenticators.BearerTokenAuthenticatorService.ID
import play.silhouette.impl.authenticators.{
  BearerTokenAuthenticator,
  BearerTokenAuthenticatorService,
  BearerTokenAuthenticatorSettings
}
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.{User, UserService}
import TokenType.TokenType
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import utils.WkConf

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
    val expiry: FiniteDuration = tokenType match {
      case TokenType.Authentication => settings.authenticatorExpiry
      case TokenType.ResetPassword  => resetPasswordExpiry
      case TokenType.DataStore      => dataStoreExpiry
      case _                        => throw new Exception("Cannot create an authenticator without a valid TokenType")
    }
    idGenerator.generate.map { id =>
      BearerTokenAuthenticator(
        id = id,
        loginInfo = loginInfo,
        lastUsedDateTime = clock.now,
        expirationDateTime = Instant.in(expiry).toZonedDateTime,
        idleTimeout = settings.authenticatorIdleTimeout
      )
    }.recover {
      case e => throw new AuthenticatorCreationException(CreateError.format(ID, loginInfo), Some(e))
    }
  }

  def init(authenticator: BearerTokenAuthenticator, tokenType: TokenType, deleteOld: Boolean): Future[String] =
    repository
      .add(authenticator, tokenType, deleteOld)
      .map { a =>
        a.id
      }
      .recover {
        case e => throw new AuthenticatorInitializationException(InitError.format(ID, authenticator), Some(e))
      }

  def createAndInitDataStoreTokenForUser(user: User): Fox[String] = {
    val before = Instant.now
    for {
      res <- createAndInit(user.loginInfo, TokenType.DataStore, deleteOld = false)
      _ = Instant.logSince(before, "createAndInit")
    } yield res
  }

  def createAndInit(loginInfo: LoginInfo, tokenType: TokenType, deleteOld: Boolean): Future[String] =
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
