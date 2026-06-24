package security

import play.silhouette.api.LoginInfo
import play.silhouette.impl.authenticators.BearerTokenAuthenticator
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{Tokens, TokensRow, GetResultTokensRow}
import TokenType.TokenType
import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{FiniteDuration, MILLISECONDS}

case class Token(
    _id: ObjectId,
    value: String,
    loginInfo: LoginInfo,
    lastUsedDateTime: Instant,
    expirationDateTime: Instant,
    idleTimeout: Option[FiniteDuration],
    tokenType: TokenType,
    created: Instant = Instant.now,
    isDeleted: Boolean = false
) {

  def toBearerTokenAuthenticator(implicit ec: ExecutionContext): Fox[BearerTokenAuthenticator] =
    Fox.successful(
      BearerTokenAuthenticator(
        value,
        loginInfo,
        lastUsedDateTime.toZonedDateTime,
        expirationDateTime.toZonedDateTime,
        idleTimeout
      )
    )
}

object LoginInfoProvider extends ExtendedEnumeration {
  type PasswordHasher = Value

  val credentials: LoginInfoProvider.Value = Value
}

object Token {
  def fromBearerTokenAuthenticator(b: BearerTokenAuthenticator, tokenType: TokenType)(implicit
      ec: ExecutionContext
  ): Fox[Token] =
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
      )
    )
}

class TokenDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Token, TokensRow, Tokens](sqlClient) {
  protected val collection = Tokens
  protected def resultConverter = GetResultTokensRow

  protected def parse(r: TokensRow): Fox[Token] =
    for {
      tokenType <- TokenType.fromString(r.tokentype).toFox
    } yield Token(
      ObjectId(r._id),
      r.value,
      LoginInfo(r.logininfo_providerid, r.logininfo_providerkey),
      Instant.fromSql(r.lastuseddatetime),
      Instant.fromSql(r.expirationdatetime),
      r.idletimeout.map(FiniteDuration(_, MILLISECONDS)),
      tokenType,
      Instant.fromSql(r.created),
      r.isdeleted
    )

  def findOneByValue(value: String): Fox[Token] =
    for {
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE value = $value".as[TokensRow])
      parsed <- parseFirst(r, "value")
    } yield parsed

  def findOneByLoginInfo(providerID: String, providerKey: String, tokenType: TokenType): Fox[Token] =
    for {
      r <- run(q"""SELECT $columns from $existingCollectionName
            WHERE loginInfo_providerID::TEXT = $providerID
            AND loginInfo_providerKey = $providerKey
            AND tokenType = $tokenType""".as[TokensRow])
      parsed <- parseFirst(r, "loginInfo")
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

  def deleteOneByValue(value: String): Fox[Unit] =
    for {
      _ <- run(q"UPDATE $collectionName SET isDeleted = TRUE WHERE value = $value".asUpdate)
    } yield ()

  def deleteAllExpired(): Fox[Unit] =
    for {
      _ <- run(q"UPDATE $collectionName SET isDeleted = TRUE WHERE expirationDateTime <= ${Instant.now}".asUpdate)
    } yield ()

  def deleteDataStoreTokensForMultiUser(multiUserId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.tokens
                   SET isDeleted = ${true}
                   WHERE tokenType = ${TokenType.DataStore}
                   AND loginInfo_providerKey IN (
                     SELECT _id
                     FROM webknossos.users_
                     WHERE _multiUser = $multiUserId
                   )""".asUpdate)
    } yield ()

  def updateEmail(oldEmail: String, newEmail: String): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.tokens
                   SET logininfo_providerkey = $newEmail
                   WHERE logininfo_providerkey = $oldEmail""".asUpdate)
    } yield ()
}
