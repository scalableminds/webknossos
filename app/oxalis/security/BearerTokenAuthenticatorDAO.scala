package oxalis.security

import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.impl.authenticators.BearerTokenAuthenticator
import com.mohiva.play.silhouette.impl.daos.AuthenticatorDAO
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.JsonHelper._
import com.scalableminds.util.tools.{Fox, JsonHelper}
import models.basics.SecuredBaseDAO
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json._
import play.api.libs.json.Writes._
import play.api.libs.json.{Json, _}
import reactivemongo.api.commands.WriteResult

import scala.concurrent.Future



class BearerTokenAuthenticatorDAO extends AuthenticatorDAO[BearerTokenAuthenticator] with SecuredBaseDAO[BearerTokenAuthenticator] {
  override def collectionName: String = "bearerTokenAuthenticators"

  override protected implicit def formatter: OFormat[BearerTokenAuthenticator] = JsonHelper.oFormat(Json.format[BearerTokenAuthenticator])

  override def findOne[V](attribute: String, value: V)(implicit w: Writes[V], ctx: DBAccessContext): Fox[BearerTokenAuthenticator] = findOne(Json.obj(attribute -> w.writes(value)))

  override def find(id: String): Future[Option[BearerTokenAuthenticator]] = findOne("id", id)(implicitly[Writes[String]],GlobalAccessContext).futureBox.map(box => box.toOption)

  //adds the new token with tokenType = Authentication (and removes the old one)
  override def add(authenticator: BearerTokenAuthenticator): Future[BearerTokenAuthenticator] = {
    add(authenticator, TokenType.Authentication)
  }

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

  override def remove(id: String): Future[Unit] = for {
    _ <- remove("id", id)(implicitly[Writes[String]], GlobalAccessContext).futureBox
  } yield {
    ()
  }

  def findOne[V](attribute: String, value: V, tokenType: TokenType.Value)(implicit w: Writes[V], ctx: DBAccessContext): Fox[BearerTokenAuthenticator] =
    findOne(Json.obj(attribute -> w.writes(value), "tokenType" -> tokenType))

  def findByLoginInfo(loginInfo: LoginInfo, tokenType: TokenType.Value): Future[Option[BearerTokenAuthenticator]] =
    findOne("loginInfo", loginInfo, tokenType)(implicitly[Writes[LoginInfo]], GlobalAccessContext).futureBox.map(box => box.toOption)

  def insert(authenticator: BearerTokenAuthenticator, tokenType: TokenType.TokenTypeValue)(implicit ctx: DBAccessContext): Fox[WriteResult] =
    insert(formatter.writes(authenticator)+("tokenType" -> Json.toJson(tokenType)))

  //adds the new token with the specified tokenType (and removes the old one)
  def add(authenticator: BearerTokenAuthenticator, tokenType: TokenType.TokenTypeValue): Future[BearerTokenAuthenticator] = for {
    maybeOldAuthenticator <- findByLoginInfo(authenticator.loginInfo, tokenType)
    _ <- insert(authenticator, tokenType)(GlobalAccessContext).futureBox
  } yield {
    maybeOldAuthenticator.map(a => remove(a.id))
    authenticator
  }
}

