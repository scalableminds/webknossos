package security

import play.silhouette.api.LoginInfo
import play.silhouette.impl.authenticators.BearerTokenAuthenticator
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import TokenType.TokenType
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{FiniteDuration, MILLISECONDS}

case class Token(_id: ObjectId,
                 value: String,
                 loginInfo: LoginInfo,
                 lastUsedDateTime: Instant,
                 expirationDateTime: Instant,
                 idleTimeout: Option[FiniteDuration],
                 tokenType: TokenType,
                 created: Instant = Instant.now,
                 isDeleted: Boolean = false) {

  def toBearerTokenAuthenticator(implicit ec: ExecutionContext): Fox[BearerTokenAuthenticator] =
    Fox.successful(
      BearerTokenAuthenticator(
        value,
        loginInfo,
        lastUsedDateTime.toZonedDateTime,
        expirationDateTime.toZonedDateTime,
        idleTimeout
      ))
}

object LoginInfoProvider extends ExtendedEnumeration {
  type PasswordHasher = Value

  val credentials: LoginInfoProvider.Value = Value
}

object Token {
  def fromBearerTokenAuthenticator(b: BearerTokenAuthenticator, tokenType: TokenType)(
      implicit ec: ExecutionContext): Fox[Token] =
    Fox.successful(
      Token(
        ObjectId.generate,
        b.id,
        b.loginInfo,
        Instant.fromZonedDateTime(b.lastUsedDateTime),
        Instant.fromZonedDateTime(b.expirationDateTime),
        b.idleTimeout,
        tokenType,
        Instant.now
      ))
}

class TokenDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Token, TokensRow, Tokens](sqlClient) {
  protected val collection = Tokens

  protected def idColumn(x: Tokens): Rep[String] = x._Id
  protected def isDeletedColumn(x: Tokens): Rep[Boolean] = x.isdeleted

  protected def parse(r: TokensRow): Fox[Token] =
    for {
      tokenType <- TokenType.fromString(r.tokentype).toFox
    } yield {
      Token(
        ObjectId(r._Id),
        r.value,
        LoginInfo(r.logininfoProviderid, r.logininfoProviderkey),
        Instant.fromSql(r.lastuseddatetime),
        Instant.fromSql(r.expirationdatetime),
        r.idletimeout.map(FiniteDuration(_, MILLISECONDS)),
        tokenType,
        Instant.fromSql(r.created),
        r.isdeleted
      )
    }

  def findOneByValue(value: String): Fox[Token] =
    for {
      rOpt <- run(Tokens.filter(r => notdel(r) && r.value === value).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield parsed

  def findOneByLoginInfo(providerID: String, providerKey: String, tokenType: TokenType): Fox[Token] =
    for {
      rOpt <- run(Tokens
        .filter(r =>
          notdel(r) && r.logininfoProviderid === providerID && r.logininfoProviderkey === providerKey && r.tokentype === tokenType.toString)
        .result
        .headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield parsed

  def insertOne(t: Token): Fox[Unit] =
    for {
      loginInfoProvider <- LoginInfoProvider.fromString(t.loginInfo.providerID).toFox
      _ <- run(q"""INSERT INTO webknossos.tokens(
                         _id, value, loginInfo_providerID,
                         loginInfo_providerKey, lastUsedDateTime,
                         expirationDateTime, idleTimeout,
                         tokenType, created, isDeleted)
                   VALUES(${t._id}, ${t.value}, $loginInfoProvider,
                          ${t.loginInfo.providerKey}, ${t.lastUsedDateTime},
                          ${t.expirationDateTime}, ${t.idleTimeout.map(_.toMillis)},
                          ${t.tokenType}, ${t.created}, ${t.isDeleted})""".asUpdate)
    } yield ()

  def updateLastUsedDateTime(value: String, lastUsedDateTime: Instant): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.tokens
                   SET lastUsedDateTime = $lastUsedDateTime
                   WHERE value = $value""".asUpdate)
    } yield ()

  def deleteOneByValue(value: String): Fox[Unit] = {
    val query = for { row <- collection if notdel(row) && row.value === value } yield isDeletedColumn(row)
    for { _ <- run(query.update(true)) } yield ()
  }

  def deleteAllExpired(): Fox[Unit] = {
    val query = for {
      row <- collection if notdel(row) && row.expirationdatetime <= Instant.now.toSql
    } yield isDeletedColumn(row)
    for { _ <- run(query.update(true)) } yield ()
  }

  def updateEmail(oldEmail: String, newEmail: String): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.tokens
                   SET logininfo_providerkey = $newEmail
                   WHERE logininfo_providerkey = $oldEmail""".asUpdate)
    } yield ()
}
