package oxalis.security

import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.api.repositories.AuthenticatorRepository
import com.mohiva.play.silhouette.impl.authenticators.BearerTokenAuthenticator
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import oxalis.security.TokenType.TokenType

import scala.concurrent.{ExecutionContext, Future}

class BearerTokenAuthenticatorRepository(tokenDAO: TokenDAO)(implicit ec: ExecutionContext)
    extends AuthenticatorRepository[BearerTokenAuthenticator] {

  override def find(value: String): Future[Option[BearerTokenAuthenticator]] =
    findOneByValue(value).toFutureOption

  override def add(authenticator: BearerTokenAuthenticator): Future[BearerTokenAuthenticator] =
    add(authenticator, TokenType.Authentication)

  override def update(newAuthenticator: BearerTokenAuthenticator): Future[BearerTokenAuthenticator] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    (for {
      oldAuthenticatorSQL <- tokenDAO.findOneByLoginInfo(newAuthenticator.loginInfo.providerID,
                                                         newAuthenticator.loginInfo.providerKey,
                                                         TokenType.Authentication)
      _ <- tokenDAO.updateValues(oldAuthenticatorSQL._id,
                                 newAuthenticator.id,
                                 newAuthenticator.lastUsedDateTime,
                                 newAuthenticator.expirationDateTime,
                                 newAuthenticator.idleTimeout)
      updated <- findOneByValue(newAuthenticator.id)
    } yield updated).toFutureOrThrowException(
      "Could not update Token. Throwing exception because update cannot return a box, as defined by Silhouette trait AuthenticatorDAO")
  }

  override def remove(value: String): Future[Unit] =
    for {
      _ <- tokenDAO.deleteOneByValue(value).futureBox
    } yield ()

  def findOneByValue(value: String): Fox[BearerTokenAuthenticator] =
    for {
      tokenSQL <- tokenDAO.findOneByValue(value)
      tokenAuthenticator <- tokenSQL.toBearerTokenAuthenticator
    } yield tokenAuthenticator

  def findOneByLoginInfo(loginInfo: LoginInfo, tokenType: TokenType): Future[Option[BearerTokenAuthenticator]] =
    (for {
      tokenSQL <- tokenDAO.findOneByLoginInfo(loginInfo.providerID, loginInfo.providerKey, tokenType)
      tokenAuthenticator <- tokenSQL.toBearerTokenAuthenticator
    } yield tokenAuthenticator).toFutureOption

  def add(authenticator: BearerTokenAuthenticator,
          tokenType: TokenType,
          deleteOld: Boolean = true): Future[BearerTokenAuthenticator] =
    for {
      oldAuthenticatorOpt <- findOneByLoginInfo(authenticator.loginInfo, tokenType)
      _ <- insert(authenticator, tokenType).futureBox
    } yield {
      if (deleteOld) {
        oldAuthenticatorOpt.map(a => remove(a.id))
      }
      authenticator
    }

  private def insert(authenticator: BearerTokenAuthenticator, tokenType: TokenType): Fox[Unit] =
    for {
      tokenSQL <- Token.fromBearerTokenAuthenticator(authenticator, tokenType)
      _ <- tokenDAO.insertOne(tokenSQL)
    } yield ()

  def deleteAllExpired(): Fox[Unit] =
    tokenDAO.deleteAllExpired()

}
