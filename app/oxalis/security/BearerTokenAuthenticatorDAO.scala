package oxalis.security

import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.impl.authenticators.BearerTokenAuthenticator
import com.mohiva.play.silhouette.impl.daos.AuthenticatorDAO
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox}
import com.scalableminds.webknossos.schema.Tables._
import org.joda.time.DateTime
import oxalis.security.TokenType.TokenType
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import slick.lifted.Rep
import slick.jdbc.PostgresProfile.api._
import utils.{ObjectId, SQLDAO}

import scala.concurrent.duration._
import scala.concurrent.Future

case class TokenSQL(_id: ObjectId,
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

object TokenSQL {
  def fromBearerTokenAuthenticator(b: BearerTokenAuthenticator, tokenType: TokenType): Fox[TokenSQL] = {
    Fox.successful(TokenSQL(
      ObjectId.fromBsonId(BSONObjectID.generate),
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

object TokenSQLDAO extends SQLDAO[TokenSQL, TokensRow, Tokens] {
  val collection = Tokens

  def idColumn(x: Tokens): Rep[String] = x._Id
  def isDeletedColumn(x: Tokens): Rep[Boolean] = x.isdeleted

  def parse(r: TokensRow): Fox[TokenSQL] =
    for {
      tokenType <- TokenType.fromString(r.tokentype).toFox
    } yield {
      TokenSQL(
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

  def findOneByValue(value: String)(implicit ctx: DBAccessContext): Fox[TokenSQL] =
    for {
      rOpt <- run(Tokens.filter(r => notdel(r) && r.value === value).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield parsed

  def findOneByLoginInfo(providerID: String, providerKey: String, tokenType: TokenType)(implicit ctx: DBAccessContext): Fox[TokenSQL] =
    for {
      rOpt <- run(Tokens.filter(r => notdel(r) && r.logininfoProviderid === providerID && r.logininfoProviderkey === providerKey && r.tokentype === tokenType.toString).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield parsed


  def insertOne(t: TokenSQL)(implicit ctx: DBAccessContext) =
    for {
      _ <- run(sqlu"""insert into webknossos.tokens(_id, value, loginInfo_providerID, loginInfo_providerKey, lastUsedDateTime, expirationDateTime, idleTimeout, tokenType, created, isDeleted)
                    values(${t._id.id}, ${t.value}, '#${t.loginInfo.providerID}', ${t.loginInfo.providerKey}, ${new java.sql.Timestamp(t.lastUsedDateTime.getMillis)},
                          ${new java.sql.Timestamp(t.expirationDateTime.getMillis)}, ${t.idleTimeout.map(_.toMillis)}, '#${t.tokenType}', ${new java.sql.Timestamp(t.created)}, ${t.isDeleted})""")
    } yield ()

  def setValues(_id: ObjectId, value: String, lastUsedDateTime: DateTime, expirationDateTime: DateTime, idleTimeout: Option[FiniteDuration])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- run(sqlu"""update webknossos.tokens
                      set
                        value = ${value},
                        lastUsedDateTime = ${new java.sql.Timestamp(lastUsedDateTime.getMillis)},
                        expirationDateTime = ${new java.sql.Timestamp(expirationDateTime.getMillis)},
                        idleTimeout = ${idleTimeout.map(_.toMillis)}""")
    } yield ()

  def deleteOneByValue(value: String)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for {row <- collection if (notdel(row) && row.value === value)} yield isDeletedColumn(row)
    for {_ <- run(q.update(true))} yield ()
  }

  def deleteAllExpired(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for {row <- collection if (notdel(row) && row.expirationdatetime <= new java.sql.Timestamp(System.currentTimeMillis))} yield isDeletedColumn(row)
    for {_ <- run(q.update(true))} yield ()
  }
}

class BearerTokenAuthenticatorDAO extends AuthenticatorDAO[BearerTokenAuthenticator] {

  /* functions as defined in Silhouette trait Authenticator DAO */
  override def find(value: String): Future[Option[BearerTokenAuthenticator]] =
    findOneByValue(value)(GlobalAccessContext).toFutureOption

  override def add(authenticator: BearerTokenAuthenticator): Future[BearerTokenAuthenticator] =
    replaceOrInsert(authenticator, TokenType.Authentication)(GlobalAccessContext)

  override def update(newAuthenticator: BearerTokenAuthenticator): Future[BearerTokenAuthenticator] = {
    implicit val ctx = GlobalAccessContext
    (for {
      oldAuthenticatorSQL <- TokenSQLDAO.findOneByLoginInfo(newAuthenticator.loginInfo.providerID, newAuthenticator.loginInfo.providerKey, TokenType.Authentication)
      _ <- TokenSQLDAO.setValues(oldAuthenticatorSQL._id, newAuthenticator.id, newAuthenticator.lastUsedDateTime, newAuthenticator.expirationDateTime, newAuthenticator.idleTimeout)
      updated <- findOneByValue(newAuthenticator.id)
    } yield updated).toFutureOrThrowException("Could not update Token. Throwing exception because update cannot return a box, as defined by Silhouette trait AuthenticatorDAO")
  }

  override def remove(value: String): Future[Unit] =
    for {
    _ <- TokenSQLDAO.deleteOneByValue(value)(GlobalAccessContext).futureBox
    } yield ()

  /* custom functions */

  def findOneByValue(value: String)(implicit ctx: DBAccessContext): Fox[BearerTokenAuthenticator] = {
    for {
      tokenSQL <- TokenSQLDAO.findOneByValue(value)
      tokenAuthenticator <- tokenSQL.toBearerTokenAuthenticator
    } yield tokenAuthenticator
  }

  def findOneByLoginInfo(loginInfo: LoginInfo, tokenType: TokenType)(implicit ctx: DBAccessContext): Future[Option[BearerTokenAuthenticator]] =
    (for {
      tokenSQL <- TokenSQLDAO.findOneByLoginInfo(loginInfo.providerID, loginInfo.providerKey, tokenType)
      tokenAuthenticator <- tokenSQL.toBearerTokenAuthenticator
    } yield tokenAuthenticator).toFutureOption

  def replaceOrInsert(authenticator: BearerTokenAuthenticator, tokenType: TokenType)(implicit ctx: DBAccessContext): Future[BearerTokenAuthenticator] = for {
    oldAuthenticatorOpt <- findOneByLoginInfo(authenticator.loginInfo, tokenType)
    _ <- insert(authenticator, tokenType)(GlobalAccessContext).futureBox
  } yield {
    oldAuthenticatorOpt.map(a => remove(a.id))
    authenticator
  }

  private def insert(authenticator: BearerTokenAuthenticator, tokenType: TokenType)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      tokenSQL <- TokenSQL.fromBearerTokenAuthenticator(authenticator, tokenType)
      _ <- TokenSQLDAO.insertOne(tokenSQL)
    } yield ()

  def deleteAllExpired(implicit ctx: DBAccessContext): Fox[Unit] =
    TokenSQLDAO.deleteAllExpired
}

