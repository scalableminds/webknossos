package oxalis.security

import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.impl.authenticators.BearerTokenAuthenticator
import com.mohiva.play.silhouette.impl.daos.AuthenticatorDAO
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.JsonHelper._
import com.scalableminds.util.tools.{Fox, JsonHelper}
import models.basics.SecuredBaseDAO
import org.joda.time.DateTime
import oxalis.security.TokenTypeSQL.TokenTypeSQL
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json._
import play.api.libs.json.Writes._
import play.api.libs.json.{Json, _}
import reactivemongo.api.commands.WriteResult

import scala.concurrent.Future
import scala.concurrent.duration.FiniteDuration

case class TokenSQL(id: String,
                    loginInfo: LoginInfo,
                    lastUsedDateTime: DateTime,
                    expirationDateTime: DateTime,
                    idleTimeout: Option[FiniteDuration],
                    tokenType: TokenTypeSQL) {
  def toBearerTokenAuthenticator = {

  }
}

object TokenSQL {
  def fromBearerTokenAuthenticator(b: BearerTokenAuthenticator, tokenType: TokenTypeSQL): Future[TokenSQL] = {

  }
}

class BearerTokenAuthenticatorDAO extends AuthenticatorDAO[BearerTokenAuthenticator] {
  override def find(id: String): Future[Option[BearerTokenAuthenticator]] =
    findOne("id", id)(implicitly[Writes[String]],GlobalAccessContext).futureBox.map(box => box.toOption)

  override def add(authenticator: BearerTokenAuthenticator): Future[BearerTokenAuthenticator] =
    add(authenticator, TokenTypeSQL.Authentication)

  override def update(authenticator: BearerTokenAuthenticator): Future[BearerTokenAuthenticator] =
    for {
      box <- findAndModify(Json.obj("loginInfo" -> LoginInfo(CredentialsProvider.ID, authenticator.loginInfo.providerKey)), Json.obj("$set" -> Json.obj(
      "id" -> authenticator.id,
      "lastUsedDateTime" -> authenticator.lastUsedDateTime,
      "expirationDateTime" -> authenticator.expirationDateTime,
      "idleTimeout" -> authenticator.idleTimeout)), returnNew = true)(GlobalAccessContext).futureBox
    } yield {
      box.openOrThrowException("update cannot return a box, as defined by trait AuthenticatorDAO")
    }

  override def remove(id: String): Future[Unit] =
    for {
    _ <- remove("id", id)(GlobalAccessContext).futureBox
    } yield ()

  def findOne[V](attribute: String, value: V, tokenType: TokenTypeSQL)(implicit w: Writes[V], ctx: DBAccessContext): Fox[BearerTokenAuthenticator] =
    findOne(Json.obj(attribute -> w.writes(value), "tokenType" -> tokenType))

  def findByLoginInfo(loginInfo: LoginInfo, tokenType: TokenTypeSQL): Future[Option[BearerTokenAuthenticator]] =
    findOne("loginInfo", loginInfo, tokenType)(implicitly[Writes[LoginInfo]], GlobalAccessContext).futureBox.map(box => box.toOption)

  def insert(authenticator: BearerTokenAuthenticator, tokenType: TokenTypeSQL)(implicit ctx: DBAccessContext): Fox[WriteResult] =
    insert(formatter.writes(authenticator)+("tokenType" -> Json.toJson(tokenType)))

  def add(authenticator: BearerTokenAuthenticator, tokenType: TokenTypeSQL): Future[BearerTokenAuthenticator] = for {
    maybeOldAuthenticator <- findByLoginInfo(authenticator.loginInfo, tokenType)
    _ <- insert(authenticator, tokenType)(GlobalAccessContext).futureBox
  } yield {
    maybeOldAuthenticator.map(a => remove(a.id))
    authenticator
  }
}

