package oxalis.security

import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.impl.authenticators.BearerTokenAuthenticator
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import oxalis.security.TokenType.TokenType
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.sql.{SqlClient, SQLDAO}
import utils.ObjectId

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
        lastUsedDateTime.toJodaDateTime,
        expirationDateTime.toJodaDateTime,
        idleTimeout
      ))
}

object Token {
  def fromBearerTokenAuthenticator(b: BearerTokenAuthenticator, tokenType: TokenType)(
      implicit ec: ExecutionContext): Fox[Token] =
    Fox.successful(
      Token(
        ObjectId.generate,
        b.id,
        b.loginInfo,
        Instant.fromJoda(b.lastUsedDateTime),
        Instant.fromJoda(b.expirationDateTime),
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
      _ <- run(
        sqlu"""insert into webknossos.tokens(_id, value, loginInfo_providerID, loginInfo_providerKey, lastUsedDateTime, expirationDateTime, idleTimeout, tokenType, created, isDeleted)
                    values(${t._id.id}, ${t.value}, '#${t.loginInfo.providerID}', ${t.loginInfo.providerKey}, ${t.lastUsedDateTime},
                          ${t.expirationDateTime}, ${t.idleTimeout
          .map(_.toMillis)}, '#${t.tokenType}', ${t.created}, ${t.isDeleted})""")
    } yield ()

  def updateValues(id: ObjectId,
                   value: String,
                   lastUsedDateTime: Instant,
                   expirationDateTime: Instant,
                   idleTimeout: Option[FiniteDuration])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"""update webknossos.tokens
                      set
                        value = $value,
                        lastUsedDateTime = $lastUsedDateTime,
                        expirationDateTime = $expirationDateTime,
                        idleTimeout = ${idleTimeout.map(_.toMillis)}
                      where _id = ${id.id}""")
    } yield ()

  def deleteOneByValue(value: String): Fox[Unit] = {
    val q = for { row <- collection if notdel(row) && row.value === value } yield isDeletedColumn(row)
    for { _ <- run(q.update(true)) } yield ()
  }

  def deleteAllExpired(): Fox[Unit] = {
    val q = for {
      row <- collection if notdel(row) && row.expirationdatetime <= Instant.now.toSql
    } yield isDeletedColumn(row)
    for { _ <- run(q.update(true)) } yield ()
  }

  def updateEmail(oldEmail: String, newEmail: String): Fox[Unit] =
    for {
      _ <- run(sqlu"""update webknossos.tokens set
        logininfo_providerkey = $newEmail
        where logininfo_providerkey = $oldEmail""")
    } yield ()
}
