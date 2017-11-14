/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.user

import java.math.BigInteger
import java.security.SecureRandom
import java.util.UUID

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import models.basics.{SecuredBaseDAO, UnsecuredBaseDAO}
import org.joda.time.DateTime
import play.api.libs.json.Json
import reactivemongo.api.indexes.{Index, IndexType}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future
import scala.concurrent.duration._

case class UserToken(_user: BSONObjectID,
                     token: String = UserToken.generateRandomToken,
                     expirationTime: Long = System.currentTimeMillis + UserToken.expirationTime.toMillis) {

  def user(implicit ctx: DBAccessContext) = UserDAO.findOneById(_user)
}

object UserToken {
  val expirationTime = 24.hours

  private val generator = new SecureRandom()
  implicit val jsonFormat = Json.format[UserToken]

  def generateRandomToken =
    new BigInteger(130, generator).toString(32)
}


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

// Silhouette Branch:

case class UserToken2(id:UUID, userId:BSONObjectID, email:String, expirationTime:DateTime, isLogin:Boolean) {
  def isExpired = expirationTime.isBeforeNow
}

object UserToken2 {
  implicit val jsonFormat = Json.format[UserToken2]

  def create(userId:BSONObjectID, email:String, isLogin:Boolean) =
    UserToken2(UUID.randomUUID(), userId, email, new DateTime().plusHours(12), isLogin)

  def createLoginToken(userId:BSONObjectID, email:String) =
    UserToken2(UUID.randomUUID(), userId, email, new DateTime().plusYears(1), true)
}

class MongoUserTokenDao extends UnsecuredBaseDAO[UserToken2] {
  //lazy val reactiveMongoApi = current.injector.instanceOf[ReactiveMongoApi]
//  val tokens = reactiveMongoApi.db.collection[JSONCollection]("tokens")

  val collectionName = "tokens"

  val formatter = UserToken2.jsonFormat

  def find(id:UUID):Future[Option[UserToken2]] =
    find(Json.obj("id" -> id)).one[UserToken2]

  def find(email: String): Future[List[UserToken2]] =
    find(Json.obj("email" -> email)).cursor[UserToken2]().collect[List]()

  def save(token:UserToken2):Fox[UserToken2] = for {
    _ <- insert(token)
  } yield token

  def remove(id:UUID):Fox[Unit] = for {
    _ <- remove(Json.obj("id" -> id))
  } yield ()
}
