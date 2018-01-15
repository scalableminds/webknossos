package oxalis.security

import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.api.exceptions.{AuthenticatorCreationException, AuthenticatorInitializationException}
import com.mohiva.play.silhouette.api.services.AuthenticatorService.{CreateError, InitError}
import com.mohiva.play.silhouette.api.util.{Clock, IDGenerator}
import com.mohiva.play.silhouette.impl.authenticators.BearerTokenAuthenticatorService.ID
import com.mohiva.play.silhouette.impl.authenticators.{BearerTokenAuthenticator, BearerTokenAuthenticatorService, BearerTokenAuthenticatorSettings}
import com.mohiva.play.silhouette.impl.daos.AuthenticatorDAO
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.{User, UserService, UserTokenDAO}
import org.joda.time.DateTime
import play.api.i18n.Messages
import play.api.libs.json.Writes
import play.api.mvc.RequestHeader

import scala.concurrent.duration.FiniteDuration
import scala.concurrent.{Await, ExecutionContext, Future}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import play.api.i18n.Messages
import play.api.Play.current
import play.api.i18n.Messages.Implicits._

class OxalisBearerTokenAuthenticatorService(settings: BearerTokenAuthenticatorSettings,
                                            dao: BearerTokenAuthenticatorDAO,
                                            idGenerator: IDGenerator,
                                            clock: Clock)(implicit override val executionContext: ExecutionContext)
                                            extends BearerTokenAuthenticatorService(settings, dao, idGenerator, clock) with FoxImplicits{

  // TODO: maybe write the constants into a setting (but it can't be in the BearerTokenSettings)
  val ResetPasswordExpiry = FiniteDuration(1, "h")
  val DataStoreExpiry = FiniteDuration(1, "d")

  def create(loginInfo: LoginInfo, tokenType: TokenType.TokenTypeValue)(implicit request: RequestHeader): Future[BearerTokenAuthenticator] = {
    var expiry: FiniteDuration = FiniteDuration(0, "sec")
    tokenType match {
      case TokenType.Authentication => expiry = settings.authenticatorExpiry
      case TokenType.ResetPassword => expiry = ResetPasswordExpiry
      case TokenType.DataStore => expiry = DataStoreExpiry // TODO: how long are tokens for the Datastore valid?
      case _ => expiry = DataStoreExpiry // TODO: what should the default case?
    }
    idGenerator.generate.map { id =>
      val now = clock.now
      BearerTokenAuthenticator(
        id = id,
        loginInfo = loginInfo,
        lastUsedDateTime = now,
        expirationDateTime = now.plus(expiry.toSeconds), // TODO: check if the dates work as expected
        idleTimeout = settings.authenticatorIdleTimeout)
    }.recover {
      case e => throw new AuthenticatorCreationException(CreateError.format(ID, loginInfo), e)
    }
  }

  def init(authenticator: BearerTokenAuthenticator, tokenType: TokenType.TokenTypeValue)(implicit request: RequestHeader): Future[String] = {
    dao.add(authenticator, tokenType).map { a =>
      a.id
    }.recover {
      case e => throw new AuthenticatorInitializationException(InitError.format(ID, authenticator), e)
    }
  }

  def addNewToken(loginInfo: LoginInfo, tokenType: TokenType.TokenTypeValue)(implicit request: RequestHeader): Future[BearerTokenAuthenticator] =
    for {
      tokenAuthenticator <- create(loginInfo, tokenType)
      tokenId <- dao.add(tokenAuthenticator, tokenType)
    } yield {
      tokenId
    }

  def remove(tokenId: String): Fox[Unit] =
    dao.remove(tokenId)

  def userForToken(token: String, tokenType: TokenType.TokenTypeValue)(implicit ctx: DBAccessContext): Fox[User] =
    (for {
      tokenAuthenticator <- dao.findOne("id", token, tokenType) ?~> Messages("auth.invalidToken")
      _ <- (tokenAuthenticator.isValid) ?~> Messages("auth.invalidToken")
    } yield {
      UserService.findOneByEmail(tokenAuthenticator.loginInfo.providerKey)
    }).flatten

  def userForTokenOpt(tokenOpt: Option[String], tokenType: TokenType.TokenTypeValue)(implicit ctx: DBAccessContext): Fox[User] = tokenOpt match {
    case Some(token) => userForToken(token, tokenType)
    case _ => Fox.empty
  }

  // convenient methods
  // TODO: which methods should be visible from outside? (to avoid mishandling of init create and add)
  def createTokenForAuthentication(loginInfo: LoginInfo)(implicit request: RequestHeader): Future[BearerTokenAuthenticator] =
    create(loginInfo, TokenType.Authentication)

  def createTokenForResetPassword(loginInfo: LoginInfo)(implicit request: RequestHeader): Future[BearerTokenAuthenticator] =
    create(loginInfo, TokenType.ResetPassword)

  def createTokenForDataStore(loginInfo: LoginInfo)(implicit request: RequestHeader): Future[BearerTokenAuthenticator] =
    create(loginInfo, TokenType.DataStore)

  def addNewTokenForAuthentication(loginInfo: LoginInfo)(implicit request: RequestHeader): Future[BearerTokenAuthenticator] =
    addNewToken(loginInfo, TokenType.Authentication)

  def addNewTokenForResetPassword(loginInfo: LoginInfo)(implicit request: RequestHeader): Future[BearerTokenAuthenticator] =
    addNewToken(loginInfo, TokenType.ResetPassword)

  def addNewTokenForDataStore(loginInfo: LoginInfo)(implicit request: RequestHeader): Future[BearerTokenAuthenticator] =
    addNewToken(loginInfo, TokenType.DataStore)

}
