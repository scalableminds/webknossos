package models.binary

import models.basics._
import play.api.libs.json.Json
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.braingames.binary.models.UserDataLayer

object UserDataLayerDAO extends SecuredBaseDAO[UserDataLayer] {

  val collectionName = "userDataLayers"

  val formatter = UserDataLayer.userDataLayerFormat

  def updateNextSegmentationId(name: String, segmentationIdOpt: Option[Int])(implicit ctx: DBAccessContext) =
    update(
      Json.obj("dataLayer.name" -> name),
      segmentationIdOpt match {
        case Some(segmentationId) =>
          Json.obj("$set" -> Json.obj("dataLayer.nextSegmentationId" -> segmentationId))
        case _ =>
          Json.obj("$unset" -> Json.obj("dataLayer.nextSegmentationId" -> 0))
      })

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    findOne("dataLayer.name", name)
}
