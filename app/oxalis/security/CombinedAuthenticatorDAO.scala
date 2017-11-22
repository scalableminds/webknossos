package oxalis.security

import javax.inject.Inject

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import controllers.routes
import models.user.{MongoUserTokenDao, User, UserService}
import net.liftweb.common.{Empty, Full}
import play.api.Play.current
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json._
import com.mohiva.play.silhouette.api.{Environment, LoginInfo, SecuredErrorHandler, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.{BearerTokenAuthenticator, _}
import com.mohiva.play.silhouette.impl.daos.AuthenticatorDAO
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import models.basics.SecuredBaseDAO
import org.joda.time.DateTime
import play.api.libs.json._
import play.modules.reactivemongo.ReactiveMongoApi
import reactivemongo.play.json.collection.JSONCollection
import play.api.libs.functional.syntax._

import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._
import play.api.libs.json._
import play.api.libs.json.Reads._
import play.api.libs.json.Writes._
import reactivemongo.api.commands.WriteResult
import reactivemongo.bson.BSONObjectID
import net.ceedubs.ficus.Ficus._
import net.ceedubs.ficus.readers.ArbitraryTypeReader._
import play.api.libs.json.Json
/**
  * Created by robert on 14.11.17.
  */
class CombinedAuthenticatorDAO extends AuthenticatorDAO[CombinedAuthenticator] with SecuredBaseDAO[CombinedAuthenticator]{
  override def collectionName: String = "combinedAuthenticators"

  implicit object FiniteDurationFormat extends Format[FiniteDuration] {
    def reads(json: JsValue): JsResult[FiniteDuration] = LongReads.reads(json).map(_.seconds)
    def writes(o: FiniteDuration): JsValue = LongWrites.writes(o.toSeconds)
  }

  implicit def optionFormat[T: Format]: Format[Option[T]] = new Format[Option[T]]{
    override def reads(json: JsValue): JsResult[Option[T]] = json.validateOpt[T]

    override def writes(o: Option[T]): JsValue = o match {
      case Some(t) ⇒ implicitly[Writes[T]].writes(t)
      case None ⇒ JsNull
    }
  }

  override protected implicit def formatter: OFormat[CombinedAuthenticator] = JsonUtil.oFormat(Json.format[CombinedAuthenticator])

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

object JsonUtil {
  def oFormat[T](format:Format[T]) : OFormat[T] = {
    val oFormat: OFormat[T] = new OFormat[T](){
      override def writes(o: T): JsObject = format.writes(o).as[JsObject]
      override def reads(json: JsValue): JsResult[T] = format.reads(json)
    }
    oFormat
  }
}
