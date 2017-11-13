/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.user

import java.math.BigInteger
import java.security.SecureRandom

import com.scalableminds.util.reactivemongo.DBAccessContext
import models.basics.SecuredBaseDAO
import play.api.libs.json.Json
import reactivemongo.api.indexes.{Index, IndexType}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import java.util.UUID
import org.joda.time.DateTime
import play.api.Play.current
import play.api.libs.concurrent.Execution.Implicits.defaultContext
import play.modules.reactivemongo.ReactiveMongoApi
import play.modules.reactivemongo.json._
import play.api.libs.json._
import reactivemongo.play.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.collection.JSONCollection
import play.modules.reactivemongo.json.BSONFormats.BSONObjectIDFormat
import reactivemongo.bson._
import reactivemongo.bson.utils.Converters
import play.modules.reactivemongo.json.ImplicitBSONHandlers._

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._
import scala.concurrent.Future

case class UserToken(_user: BSONObjectID,
                     token: String = UserToken.generateRandomToken,
                     expirationTime: Long = System.currentTimeMillis + UserToken.expirationTime.toMillis) {

  def user(implicit ctx: DBAccessContext) = UserDAO.findOneById(_user)
}

object UserToken {
  val expirationTime = 24.hours

  private val generator = new SecureRandom()
  implicit val jsonFormat:Format[UserToken] = Json.format[UserToken]

  def generateRandomToken =
    new BigInteger(130, generator).toString(32)
}


// Silhouette Branch:
object UserTokenDAO extends SecuredBaseDAO[UserToken] {

  val collectionName = "userTokens"

  val formatter = UserToken.jsonFormat

  underlying.indexesManager.ensure(Index(Seq("token" -> IndexType.Ascending)))

  def findByToken(token: String)(implicit ctx: DBAccessContext) = {
    findOne("token", token)
  }

  def removeExpiredTokens()(implicit ctx: DBAccessContext) = {
    remove(Json.obj("expirationTime" -> Json.obj("$lte" -> System.currentTimeMillis)))
  }
}

case class UserToken2(id:UUID, userId:BSONObjectID, email:String, expirationTime:DateTime, isLogin:Boolean) {
  def isExpired = expirationTime.isBeforeNow
}

object UserToken2 {
  implicit val toJson: Format[UserToken2] = Json.format[UserToken2]

  def create(userId:BSONObjectID, email:String, isLogin:Boolean) =
    UserToken2(UUID.randomUUID(), userId, email, new DateTime().plusHours(12), isLogin)

  def createLoginToken(userId:BSONObjectID, email:String) =
    UserToken2(UUID.randomUUID(), userId, email, new DateTime().plusYears(1), true)
}

trait UserTokenDao {
  def find(id:UUID):Future[Option[UserToken2]]
  def save(token:UserToken2):Future[UserToken2]
  def remove(id:UUID):Future[Unit]
}

class MongoUserTokenDao extends UserTokenDao {
  lazy val reactiveMongoApi = current.injector.instanceOf[ReactiveMongoApi]
  val tokens = reactiveMongoApi.db.collection[JSONCollection]("tokens")

  def find(id:UUID):Future[Option[UserToken2]] =
    tokens.find(Json.obj("id" -> id)).one[UserToken2]

  def find(email: String): Future[List[UserToken2]] =
    tokens.find(Json.obj("email" -> email)).cursor[UserToken2]().collect[List]()

  def save(token:UserToken2):Future[UserToken2] = for {
    _ <- tokens.insert(token)
  } yield token

  def remove(id:UUID):Future[Unit] = for {
    _ <- tokens.remove(Json.obj("id" -> id))
  } yield ()
}
