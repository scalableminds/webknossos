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
    findOneByValue(value)(GlobalAccessContext).toFutureOption

  override def add(authenticator: BearerTokenAuthenticator): Future[BearerTokenAuthenticator] =
    add(authenticator, TokenType.Authentication)(GlobalAccessContext)

  override def update(newAuthenticator: BearerTokenAuthenticator): Future[BearerTokenAuthenticator] = {
    implicit val ctx = GlobalAccessContext
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
      _ <- tokenDAO.deleteOneByValue(value)(GlobalAccessContext).futureBox
    } yield ()

  def findOneByValue(value: String)(implicit ctx: DBAccessContext): Fox[BearerTokenAuthenticator] =
    for {
      tokenSQL <- tokenDAO.findOneByValue(value)
      tokenAuthenticator <- tokenSQL.toBearerTokenAuthenticator
    } yield tokenAuthenticator

  def findOneByLoginInfo(loginInfo: LoginInfo, tokenType: TokenType)(
      implicit ctx: DBAccessContext): Future[Option[BearerTokenAuthenticator]] =
    (for {
      tokenSQL <- tokenDAO.findOneByLoginInfo(loginInfo.providerID, loginInfo.providerKey, tokenType)
      tokenAuthenticator <- tokenSQL.toBearerTokenAuthenticator
    } yield tokenAuthenticator).toFutureOption

  def add(authenticator: BearerTokenAuthenticator, tokenType: TokenType, deleteOld: Boolean = true)(
      implicit ctx: DBAccessContext): Future[BearerTokenAuthenticator] =
    for {
      oldAuthenticatorOpt <- findOneByLoginInfo(authenticator.loginInfo, tokenType)
      _ <- insert(authenticator, tokenType)(GlobalAccessContext).futureBox
    } yield {
      if (deleteOld) {
        oldAuthenticatorOpt.map(a => remove(a.id))
      }
      authenticator
    }

  private def insert(authenticator: BearerTokenAuthenticator, tokenType: TokenType)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      tokenSQL <- Token.fromBearerTokenAuthenticator(authenticator, tokenType)
      _ <- tokenDAO.insertOne(tokenSQL)
    } yield ()

  def deleteAllExpired(implicit ctx: DBAccessContext): Fox[Unit] =
    tokenDAO.deleteAllExpired

  def updateEmail(oldEmail: String, newEmail: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- tokenDAO.updateEmail(oldEmail, newEmail)
    } yield ()
}
