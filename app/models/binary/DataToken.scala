/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.binary

import java.math.BigInteger
import java.security.SecureRandom

import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.basics.SecuredBaseDAO
import models.user.{User, UserService}
import net.liftweb.common.Full
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import reactivemongo.api.indexes.{Index, IndexType}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

import scala.concurrent.Future
import scala.concurrent.duration._

case class DataToken(
                      _user: Option[BSONObjectID],
                      dataSetName: Option[String],
                      dataLayerName: Option[String],
                      token: String = DataToken.generateRandomToken,
                      expiration: Long = System.currentTimeMillis + DataToken.expirationTime.toMillis) {
  def isValidFor(dataSetName: String, dataLayerName: String): Boolean =
    !isExpired && this.dataSetName.contains(dataSetName) && this.dataLayerName.contains(dataLayerName)

  def isExpired: Boolean =
    expiration < System.currentTimeMillis
}

object DataToken {

  private val generator = new SecureRandom()
  implicit val dataTokenFormat = Json.format[DataToken]

  val expirationTime = 24.hours

  def generateRandomToken =
    new BigInteger(130, generator).toString(32)
}

object DataTokenService extends FoxImplicits {

  val webKnossosToken = DataToken.generateRandomToken

  def generate(
    user: Option[User],
    dataSetName: Option[String],
    dataLayerName: Option[String])(implicit ctx: DBAccessContext) = {

    val token = DataToken(user.map(_._id), dataSetName, dataLayerName)
    DataTokenDAO.insert(token).map(_ => token)
  }

  def validate(token: String, dataSetName: String, dataLayerName: String) = {
    DataTokenDAO.findByToken(token)(GlobalAccessContext).futureBox.map {
      case Full(dataToken) if dataToken.isValidFor(dataSetName, dataLayerName) =>
        true
      case _ if token == webKnossosToken =>
        true
      case _ =>
        false
    }
  }

  def userFromToken(token: String): Fox[User] = {
    DataTokenDAO.findByToken(token)(GlobalAccessContext).filter(!_.isExpired).flatMap { dataToken =>
      dataToken._user.toFox.flatMap(id => UserService.findOneById(id.stringify, useCache = true)(GlobalAccessContext))
    }
  }

  def validateDataSetToken(token: String, dataSetName: String): Future[Boolean] = {
    DataSetDAO.findOneBySourceName(dataSetName)(GlobalAccessContext).map{ dataSet =>
      dataSet.dataStoreInfo.accessToken.contains(token)
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
