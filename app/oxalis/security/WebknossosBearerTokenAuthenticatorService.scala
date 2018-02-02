package oxalis.security

import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.api.exceptions.{AuthenticatorCreationException, AuthenticatorInitializationException}
import com.mohiva.play.silhouette.api.services.AuthenticatorService.{CreateError, InitError}
import com.mohiva.play.silhouette.api.util.{Clock, IDGenerator}
import com.mohiva.play.silhouette.impl.authenticators.BearerTokenAuthenticatorService.ID
import com.mohiva.play.silhouette.impl.authenticators.{BearerTokenAuthenticator, BearerTokenAuthenticatorService, BearerTokenAuthenticatorSettings}
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.{User, UserService}
import oxalis.security.TokenType.TokenType
import play.api.Play.current
import play.api.i18n.Messages
import play.api.i18n.Messages.Implicits._
import play.api.mvc.RequestHeader

import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}

class WebknossosBearerTokenAuthenticatorService(settings: BearerTokenAuthenticatorSettings,
                                                dao: BearerTokenAuthenticatorDAO,
                                                idGenerator: IDGenerator,
                                                clock: Clock)(implicit override val executionContext: ExecutionContext)
                                            extends BearerTokenAuthenticatorService(settings, dao, idGenerator, clock) with FoxImplicits{

  val config = play.api.Play.configuration.underlying

  val resetPasswordExpiry = config.getDuration("silhouette.tokenAuthenticator.resetPasswordExpiry").toMillis millis
  val dataStoreExpiry = config.getDuration("silhouette.tokenAuthenticator.dataStoreExpiry").toMillis millis

  def create(loginInfo: LoginInfo, tokenType: TokenType)(implicit request: RequestHeader): Future[BearerTokenAuthenticator] = {
    val expiry: Duration = tokenType match {
      case TokenType.Authentication => settings.authenticatorExpiry
      case TokenType.ResetPassword => resetPasswordExpiry
      case TokenType.DataStore => dataStoreExpiry
      case _ => throw new Exception("Cannot create an authenticator without a valid TokenType")
    }
    idGenerator.generate.map { id =>
      val now = clock.now
      BearerTokenAuthenticator(
        id = id,
        loginInfo = loginInfo,
        lastUsedDateTime = now,
        expirationDateTime = now.plus(expiry.toMillis),
        idleTimeout = settings.authenticatorIdleTimeout)
    }.recover {
      case e => throw new AuthenticatorCreationException(CreateError.format(ID, loginInfo), e)
    }
  }

  def init(authenticator: BearerTokenAuthenticator, tokenType: TokenType)(implicit request: RequestHeader): Future[String] = {
    dao.replaceOrInsert(authenticator, tokenType)(GlobalAccessContext).map { a =>
      a.id
    }.recover {
      case e => throw new AuthenticatorInitializationException(InitError.format(ID, authenticator), e)
    }
  }

  def createAndInit(loginInfo: LoginInfo, tokenType: TokenType)(implicit request: RequestHeader): Future[String] =
    for {
      tokenAuthenticator <- create(loginInfo, tokenType)
      tokenId <- init(tokenAuthenticator, tokenType)
    } yield {
      tokenId
    }

  def userForToken(tokenValue: String)(implicit ctx: DBAccessContext): Fox[User] =
    for {
      tokenAuthenticator <- dao.findOneByValue(tokenValue) ?~> Messages("auth.invalidToken")
      _ <- (tokenAuthenticator.isValid) ?~> Messages("auth.invalidToken")
      user <- UserService.findOneByEmail(tokenAuthenticator.loginInfo.providerKey)
    } yield user

  def userForTokenOpt(tokenOpt: Option[String])(implicit ctx: DBAccessContext): Fox[User] = tokenOpt match {
    case Some(token) => userForToken(token)
    case _ => Fox.empty
  }

  def remove(tokenValue: String): Fox[Unit] =
    dao.remove(tokenValue)

  def removeExpiredTokens(implicit ctx: DBAccessContext) =
    dao.deleteAllExpired
}
