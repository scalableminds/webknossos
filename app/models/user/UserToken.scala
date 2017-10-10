package models.user

import org.joda.time.DateTime
import play.api.libs.json.{JsObject, Json}
import java.util.UUID

import com.scalableminds.util.reactivemongo.DBAccessContext

import scala.concurrent.Future
import play.api.Play.current
import play.api.libs.concurrent.Execution.Implicits.defaultContext
import play.modules.reactivemongo.ReactiveMongoApi
import play.modules.reactivemongo.json._
import play.modules.reactivemongo.json.collection.JSONCollection
import reactivemongo.bson.BSONObjectID


case class UserToken(id:UUID, userId:BSONObjectID, email:String, expirationTime:DateTime, isLogin:Boolean) {
  def isExpired = expirationTime.isBeforeNow
}

object UserToken {
  implicit val toJson = Json.format[UserToken]

  def create(userId:BSONObjectID, email:String, isLogin:Boolean) =
    UserToken(UUID.randomUUID(), userId, email, new DateTime().plusHours(12), isLogin)

  def createLoginToken(userId:BSONObjectID, email:String) =
    UserToken(UUID.randomUUID(), userId, email, new DateTime().plusYears(1), true)
}

trait UserTokenDao {
  def find(id:UUID):Future[Option[UserToken]]
  def save(token:UserToken):Future[UserToken]
  def remove(id:UUID):Future[Unit]
}

class MongoUserTokenDao extends UserTokenDao {
  lazy val reactiveMongoApi = current.injector.instanceOf[ReactiveMongoApi]
  val tokens = reactiveMongoApi.db.collection[JSONCollection]("tokens")

  def find(id:UUID):Future[Option[UserToken]] =
    tokens.find(Json.obj("id" -> id)).one[UserToken]

  def find(email: String): Future[List[UserToken]] =
    tokens.find(Json.obj("email" -> email)).cursor[UserToken]().collect[List]() // does this work ???

  def save(token:UserToken):Future[UserToken] = for {
    _ <- tokens.insert(token)
  } yield token

  def remove(id:UUID):Future[Unit] = for {
    _ <- tokens.remove(Json.obj("id" -> id))
  } yield ()
}
