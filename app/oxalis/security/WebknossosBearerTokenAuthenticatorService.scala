package oxalis.security

import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.api.exceptions.{AuthenticatorCreationException, AuthenticatorInitializationException, AuthenticatorRetrievalException}
import com.mohiva.play.silhouette.api.services.AuthenticatorService.{CreateError, InitError, RetrieveError}
import com.mohiva.play.silhouette.api.util.{Clock, IDGenerator}
import com.mohiva.play.silhouette.impl.authenticators.BearerTokenAuthenticatorService.ID
import com.mohiva.play.silhouette.impl.authenticators.{BearerTokenAuthenticator, BearerTokenAuthenticatorService, BearerTokenAuthenticatorSettings}
import com.mohiva.play.silhouette.impl.daos.AuthenticatorDAO
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.{User, UserService}
import org.joda.time.DateTime
import play.api.i18n.Messages
import play.api.libs.json.{Json, Writes}
import play.api.mvc.RequestHeader

import scala.concurrent.duration.FiniteDuration
import scala.concurrent.{Await, ExecutionContext, Future}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import play.api.i18n.Messages
import play.api.Play.current
import play.api.i18n.Messages.Implicits._
import com.mohiva.play.silhouette._

import scala.util.Try

class WebknossosBearerTokenAuthenticatorService(settings: BearerTokenAuthenticatorSettings,
                                                dao: BearerTokenAuthenticatorDAO,
                                                idGenerator: IDGenerator,
                                                clock: Clock)(implicit override val executionContext: ExecutionContext)
                                            extends BearerTokenAuthenticatorService(settings, dao, idGenerator, clock) with FoxImplicits{

  val ResetPasswordExpiry = FiniteDuration(play.api.Play.configuration.underlying.getDuration("silhouette.tokenAuthenticator.resetPasswordExpiry").toHours, "hour")
  val DataStoreExpiry = FiniteDuration(play.api.Play.configuration.underlying.getDuration("silhouette.tokenAuthenticator.dataStoreExpiry").toHours, "hour")

  def create(loginInfo: LoginInfo, tokenType: TokenType.TokenTypeValue)(implicit request: RequestHeader): Future[BearerTokenAuthenticator] = {
    var expiry: FiniteDuration = FiniteDuration(0, "sec")
    tokenType match {
      case TokenType.Authentication => expiry = settings.authenticatorExpiry
      case TokenType.ResetPassword => expiry = ResetPasswordExpiry
      case TokenType.DataStore => expiry = DataStoreExpiry
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

  def init(authenticator: BearerTokenAuthenticator, tokenType: TokenType.TokenTypeValue)(implicit request: RequestHeader): Future[String] = {
    dao.add(authenticator, tokenType).map { a =>
      a.id
    }.recover {
      case e => throw new AuthenticatorInitializationException(InitError.format(ID, authenticator), e)
    }
  }

  def createAndInit(loginInfo: LoginInfo, tokenType: TokenType.TokenTypeValue)(implicit request: RequestHeader): Future[String] =
    for {
      tokenAuthenticator <- create(loginInfo, tokenType)
      tokenId <- init(tokenAuthenticator, tokenType)
    } yield {
      tokenId
    }

  def userForToken(token: String)(implicit ctx: DBAccessContext): Fox[User] =
    (for {
      tokenAuthenticator <- dao.findOne("id", token) ?~> Messages("auth.invalidToken")
      _ <- (tokenAuthenticator.isValid) ?~> Messages("auth.invalidToken")
    } yield {
      UserService.findOneByEmail(tokenAuthenticator.loginInfo.providerKey)
    }).flatten

  def userForTokenOpt(tokenOpt: Option[String])(implicit ctx: DBAccessContext): Fox[User] = tokenOpt match {
    case Some(token) => userForToken(token)
    case _ => Fox.empty
  }

  def remove(tokenId: String): Fox[Unit] =
    dao.remove(tokenId)

  def removeExpiredTokens()(implicit ctx: DBAccessContext) = {
    dao.remove(Json.obj("expirationDateTime" -> Json.obj("$lte" -> System.currentTimeMillis)))
  }
}
