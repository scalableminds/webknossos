package oxalis.security

import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.impl.daos.AuthenticatorDAO
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.JsonHelper._
import com.scalableminds.util.tools.{Fox, JsonHelper}
import models.basics.SecuredBaseDAO
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json._
import play.api.libs.json.Reads._
import play.api.libs.json.Writes._
import play.api.libs.json.{Json, _}

import scala.concurrent.Future
/**
  * Created by robert on 14.11.17.
  */
class CombinedAuthenticatorDAO extends AuthenticatorDAO[CombinedAuthenticator] with SecuredBaseDAO[CombinedAuthenticator] {
  override def collectionName: String = "combinedAuthenticators"

  override protected implicit def formatter: OFormat[CombinedAuthenticator] = JsonHelper.oFormat(Json.format[CombinedAuthenticator])

  override def findOne[V](attribute: String, value: V)(implicit w: Writes[V], ctx: DBAccessContext): Fox[CombinedAuthenticator] = findOne(Json.obj(attribute -> w.writes(value)))

  override def find(id: String): Future[Option[CombinedAuthenticator]] = findOne("id", id)(implicitly[Writes[String]],GlobalAccessContext).futureBox.map(box => box.toOption)

  //adds the new token (and removes the old one)
  override def add(authenticator: CombinedAuthenticator): Future[CombinedAuthenticator] = for{
    maybeOldAuthenticator <- findByLoginInfo(authenticator.loginInfo)
    _ <- insert(authenticator)(GlobalAccessContext).futureBox
  }yield{
    maybeOldAuthenticator.map(a => remove(a.id))
    authenticator
  }

  override def update(authenticator: CombinedAuthenticator): Future[CombinedAuthenticator] =
    findAndModify(Json.obj("loginInfoParameter" -> LoginInfo(CredentialsProvider.ID, authenticator.loginInfo.providerKey)), Json.obj("$set" -> Json.obj(
      "id" -> authenticator.id,
      "lastUsedDateTime" -> authenticator.lastUsedDateTime,
      "expirationDateTime" -> authenticator.expirationDateTime,
      "idleTimeout" -> authenticator.idleTimeout)), returnNew = true)(GlobalAccessContext).futureBox.map(_.get)

  override def remove(id: String): Future[Unit] = for{
    _ <- remove("id", id)(implicitly[Writes[String]], GlobalAccessContext).futureBox
  }yield{
    ()
  }

  def findByLoginInfo(loginInfo: LoginInfo): Future[Option[CombinedAuthenticator]] =
    findOne("loginInfoParameter", loginInfo)(implicitly[Writes[LoginInfo]],GlobalAccessContext).futureBox.map(box => box.toOption)
}

