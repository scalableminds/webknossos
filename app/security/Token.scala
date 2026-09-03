package security

import play.silhouette.impl.authenticators.BearerTokenAuthenticator
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.schema.Tables.{Tokens, TokensRow, GetResultTokensRow}
import TokenType.TokenType
import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{FiniteDuration, MILLISECONDS}
import scala.concurrent.duration.DurationInt

case class Token(
    _id: ObjectId,
    value: String,
    _user: ObjectId,
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
        LoginInfoAdapter.loginInfoFromUserId(_user),
        lastUsedDateTime.toZonedDateTime,
        expirationDateTime.toZonedDateTime,
        idleTimeout
      )
    )
}

object Token {
  def fromBearerTokenAuthenticator(b: BearerTokenAuthenticator, tokenType: TokenType)(implicit
      ec: ExecutionContext
  ): Fox[Token] =
    Fox.successful(
      Token(
        ObjectId.generate,
        b.id,
        LoginInfoAdapter.userIdFromLoginInfo(b.loginInfo),
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
      ObjectId(r._user),
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

  def findOneByUserIdAndType(userId: ObjectId, tokenType: TokenType): Fox[Token] =
    for {
      r <- run(q"""SELECT $columns from $existingCollectionName
            WHERE _user = $userId
            AND tokenType = $tokenType""".as[TokensRow])
      parsed <- parseFirst(r, "userIdAndType")
    } yield parsed

  def insertOne(t: Token): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.tokens(
                         _id, value,
                         _user, lastUsedDateTime,
                         expirationDateTime, idleTimeout,
                         tokenType, created, isDeleted)
                   VALUES(${t._id}, ${t.value},
                          ${t._user}, ${t.lastUsedDateTime},
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

  private val hardDeleteGracePeriod: FiniteDuration = 7.days

  def hardDeleteOldTokens(): Fox[Unit] =
    for {
      _ <- run(
        q"DELETE FROM $collectionName WHERE isDeleted AND expirationDateTime <= ${Instant.now - hardDeleteGracePeriod}".asUpdate
      )
    } yield ()

  def deleteDataStoreTokensForMultiUser(multiUserId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.tokens
                   SET isDeleted = ${true}
                   WHERE tokenType = ${TokenType.DataStore}
                   AND _user IN (
                     SELECT _id
                     FROM webknossos.users_
                     WHERE _multiUser = $multiUserId
                   )""".asUpdate)
    } yield ()

}
