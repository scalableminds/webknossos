/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.binary

import reactivemongo.bson.BSONObjectID
import play.api.libs.json.Json
import java.security.SecureRandom
import java.math.BigInteger
import models.basics.SecuredBaseDAO
import scala.concurrent.Future
import scala.concurrent.duration._
import com.scalableminds.util.reactivemongo.{GlobalAccessContext, DBAccessContext}
import models.user.User
import reactivemongo.play.json.BSONFormats._
import reactivemongo.api.indexes.{IndexType, Index}
import play.api.libs.concurrent.Execution.Implicits._
import oxalis.cleanup.CleanUpService
import net.liftweb.common.Full
import play.api.Logger

case class DataToken(
                      _user: Option[BSONObjectID],
                      dataSetName: String,
                      dataLayerName: String,
                      token: String = DataToken.generateRandomToken,
                      expiration: Long = System.currentTimeMillis + DataToken.expirationTime.toMillis) {
  def isValidFor(dataSetName: String, dataLayerName: String) =
    !isExpired && dataSetName == this.dataSetName && dataLayerName == this.dataLayerName

  def isExpired =
    expiration < System.currentTimeMillis
}

object DataToken {
  private val generator = new SecureRandom()
  implicit val dataTokenFormat = Json.format[DataToken]

  val expirationTime = 24.hours

  def generateRandomToken =
    new BigInteger(130, generator).toString(32)
}

object DataTokenService {

  val oxalisToken = DataToken.generateRandomToken

  CleanUpService.register("deletion of expired dataTokens", DataToken.expirationTime){
    DataTokenDAO.removeExpiredTokens()(GlobalAccessContext).map(r => s"deleted ${r.n}")
  }

  def generate(user: Option[User], dataSetName: String, dataLayerName: String)(implicit ctx: DBAccessContext) = {
    val token = DataToken(user.map(_._id), dataSetName, dataLayerName)
    DataTokenDAO.insert(token).map(_ => token)
  }

  def validate(token: String, dataSetName: String, dataLayerName: String) = {
    DataTokenDAO.findByToken(token)(GlobalAccessContext).futureBox.map {
      case Full(dataToken) if dataToken.isValidFor(dataSetName, dataLayerName) =>
        true
      case _ if token == oxalisToken =>
        true
      case _ =>
        false
    }
  }

  def validateDataSetToken(token: String, dataSetName: String): Future[Boolean] = {
    DataSetDAO.findOneBySourceName(dataSetName)(GlobalAccessContext).map{ dataSource =>
      dataSource.accessToken.contains(token)
    } getOrElse false
  }
}

object DataTokenDAO extends SecuredBaseDAO[DataToken] {
  val collectionName = "dataTokens"

  val formatter = DataToken.dataTokenFormat

  underlying.indexesManager.ensure(Index(Seq("token" -> IndexType.Ascending)))

  def findByToken(token: String)(implicit ctx: DBAccessContext) = {
    findOne("token", token)
  }

  def removeExpiredTokens()(implicit ctx: DBAccessContext) = {
    remove(Json.obj("expiration" -> Json.obj("$lte" -> System.currentTimeMillis)))
  }
}
