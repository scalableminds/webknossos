package oxalis.security

import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.impl.authenticators.BearerTokenAuthenticator
import com.mohiva.play.silhouette.impl.daos.AuthenticatorDAO
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import javax.inject.Inject
import org.joda.time.DateTime
import oxalis.security.TokenType.TokenType
import play.api.libs.concurrent.Execution.Implicits._
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import play.api.i18n.{Messages, MessagesApi}
import utils.{ObjectId, SQLClient, SQLDAO}

import scala.concurrent.Future
import scala.concurrent.duration._

case class Token(_id: ObjectId,
                 value: String,
                 loginInfo: LoginInfo,
                 lastUsedDateTime: DateTime,
                 expirationDateTime: DateTime,
                 idleTimeout: Option[FiniteDuration],
                 tokenType: TokenType,
                 created: Long = System.currentTimeMillis(),
                 isDeleted: Boolean = false) {

  def toBearerTokenAuthenticator: Fox[BearerTokenAuthenticator] = {
    Fox.successful(BearerTokenAuthenticator(
      value,
      loginInfo,
      lastUsedDateTime,
      expirationDateTime,
      idleTimeout
    ))
  }
}

object Token {
  def fromBearerTokenAuthenticator(b: BearerTokenAuthenticator, tokenType: TokenType): Fox[Token] = {
    Fox.successful(Token(
      ObjectId.generate,
      b.id,
      b.loginInfo,
      b.lastUsedDateTime,
      b.expirationDateTime,
      b.idleTimeout,
      tokenType,
      System.currentTimeMillis(),
      false
    ))
  }
}

class TokenDAO @Inject()(sqlClient: SQLClient) extends SQLDAO[Token, TokensRow, Tokens](sqlClient) {
  val collection = Tokens

  def idColumn(x: Tokens): Rep[String] = x._Id
  def isDeletedColumn(x: Tokens): Rep[Boolean] = x.isdeleted

  def parse(r: TokensRow): Fox[Token] =
    for {
      tokenType <- TokenType.fromString(r.tokentype).toFox
    } yield {
      Token(
        ObjectId(r._Id),
        r.value,
        LoginInfo(r.logininfoProviderid, r.logininfoProviderkey),
        new DateTime(r.lastuseddatetime.getTime),
        new DateTime(r.expirationdatetime.getTime),
        r.idletimeout.map(FiniteDuration(_, MILLISECONDS)),
        tokenType,
        r.created.getTime,
        r.isdeleted
      )
    }

  def findOneByValue(value: String)(implicit ctx: DBAccessContext): Fox[Token] =
    for {
      rOpt <- run(Tokens.filter(r => notdel(r) && r.value === value).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield parsed

  def findOneByLoginInfo(providerID: String, providerKey: String, tokenType: TokenType)(implicit ctx: DBAccessContext): Fox[Token] =
    for {
      rOpt <- run(Tokens.filter(r => notdel(r) && r.logininfoProviderid === providerID && r.logininfoProviderkey === providerKey && r.tokentype === tokenType.toString).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield parsed


  def insertOne(t: Token)(implicit ctx: DBAccessContext) =
    for {
      _ <- run(sqlu"""insert into webknossos.tokens(_id, value, loginInfo_providerID, loginInfo_providerKey, lastUsedDateTime, expirationDateTime, idleTimeout, tokenType, created, isDeleted)
                    values(${t._id.id}, ${t.value}, '#${t.loginInfo.providerID}', ${t.loginInfo.providerKey}, ${new java.sql.Timestamp(t.lastUsedDateTime.getMillis)},
                          ${new java.sql.Timestamp(t.expirationDateTime.getMillis)}, ${t.idleTimeout.map(_.toMillis)}, '#${t.tokenType}', ${new java.sql.Timestamp(t.created)}, ${t.isDeleted})""")
    } yield ()

  def updateValues(id: ObjectId, value: String, lastUsedDateTime: DateTime, expirationDateTime: DateTime, idleTimeout: Option[FiniteDuration])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"""update webknossos.tokens
                      set
                        value = ${value},
                        lastUsedDateTime = ${new java.sql.Timestamp(lastUsedDateTime.getMillis)},
                        expirationDateTime = ${new java.sql.Timestamp(expirationDateTime.getMillis)},
                        idleTimeout = ${idleTimeout.map(_.toMillis)}
                      where _id = ${id.id}""")
    } yield ()

  def deleteOneByValue(value: String)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for {row <- collection if (notdel(row) && row.value === value)} yield isDeletedColumn(row)
    for {_ <- run(q.update(true))} yield ()
  }

  def deleteAllExpired(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for {row <- collection if (notdel(row) && row.expirationdatetime <= new java.sql.Timestamp(System.currentTimeMillis))} yield isDeletedColumn(row)
    for {_ <- run(q.update(true))} yield ()
  }

  def updateEmail(oldEmail: String, newEmail: String)(implicit ctx: DBAccessContext) = {
    for {
      _ <- run(sqlu"""update webknossos.tokens set
        logininfo_providerkey = ${newEmail}
        where logininfo_providerkey = ${oldEmail}""")
    } yield ()
  }
}

class BearerTokenAuthenticatorDAO(tokenDAO: TokenDAO) extends AuthenticatorDAO[BearerTokenAuthenticator] {

  /* functions as defined in Silhouette trait Authenticator DAO */
  override def find(value: String): Future[Option[BearerTokenAuthenticator]] =
    findOneByValue(value)(GlobalAccessContext).toFutureOption

  override def add(authenticator: BearerTokenAuthenticator): Future[BearerTokenAuthenticator] =
    add(authenticator, TokenType.Authentication)(GlobalAccessContext)

  override def update(newAuthenticator: BearerTokenAuthenticator): Future[BearerTokenAuthenticator] = {
    implicit val ctx = GlobalAccessContext
    (for {
      oldAuthenticatorSQL <- tokenDAO.findOneByLoginInfo(newAuthenticator.loginInfo.providerID, newAuthenticator.loginInfo.providerKey, TokenType.Authentication)
      _ <- tokenDAO.updateValues(oldAuthenticatorSQL._id, newAuthenticator.id, newAuthenticator.lastUsedDateTime, newAuthenticator.expirationDateTime, newAuthenticator.idleTimeout)
      updated <- findOneByValue(newAuthenticator.id)
    } yield updated).toFutureOrThrowException("Could not update Token. Throwing exception because update cannot return a box, as defined by Silhouette trait AuthenticatorDAO")
  }

  override def remove(value: String): Future[Unit] =
    for {
    _ <- tokenDAO.deleteOneByValue(value)(GlobalAccessContext).futureBox
    } yield ()

  /* custom functions */

  def findOneByValue(value: String)(implicit ctx: DBAccessContext): Fox[BearerTokenAuthenticator] = {
    for {
      tokenSQL <- tokenDAO.findOneByValue(value)
      tokenAuthenticator <- tokenSQL.toBearerTokenAuthenticator
    } yield tokenAuthenticator
  }

  def findOneByLoginInfo(loginInfo: LoginInfo, tokenType: TokenType)(implicit ctx: DBAccessContext): Future[Option[BearerTokenAuthenticator]] =
    (for {
      tokenSQL <- tokenDAO.findOneByLoginInfo(loginInfo.providerID, loginInfo.providerKey, tokenType)
      tokenAuthenticator <- tokenSQL.toBearerTokenAuthenticator
    } yield tokenAuthenticator).toFutureOption

  def add(authenticator: BearerTokenAuthenticator, tokenType: TokenType, deleteOld: Boolean = true)(implicit ctx: DBAccessContext): Future[BearerTokenAuthenticator] = for {
    oldAuthenticatorOpt <- findOneByLoginInfo(authenticator.loginInfo, tokenType)
    _ <- insert(authenticator, tokenType)(GlobalAccessContext).futureBox
  } yield {
    if (deleteOld) {
      oldAuthenticatorOpt.map(a => remove(a.id))
    }
    authenticator
  }

  private def insert(authenticator: BearerTokenAuthenticator, tokenType: TokenType)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      tokenSQL <- Token.fromBearerTokenAuthenticator(authenticator, tokenType)
      _ <- tokenDAO.insertOne(tokenSQL)
    } yield ()

  def deleteAllExpired(implicit ctx: DBAccessContext): Fox[Unit] =
    tokenDAO.deleteAllExpired

  def updateEmail(oldEmail: String, newEmail: String)(implicit ctx: DBAccessContext): Fox[Unit] = {
    for {
      _ <- tokenDAO.updateEmail(oldEmail, newEmail)
    } yield ()
  }
}

