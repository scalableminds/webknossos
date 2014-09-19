package models.annotation

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.FoxImplicits
import models.basics.SecuredBaseDAO
import models.user.User
import play.Play
import play.api.Logger
import play.api.libs.json.{Reads, OFormat, Json, JsObject}
import reactivemongo.bson.BSONObjectID
import play.api.libs.functional.syntax._
import play.api.libs.json._
import com.scalableminds.util.tools.{Fox, FoxImplicits}

/**
 * Company: scalableminds
 * User: speedcom
 * Date: 14.09.14
 * Time: 12:39
 */

object SharedLinkHandler {

  val httpUri = Play.application().configuration().getString("http.uri")

  def generateSharedData() = {
    val sharedId = java.util.UUID.randomUUID.toString
    val sharedLink = createLink(sharedId)

    SharedSendData(sharedId, sharedLink)
  }

  def createLink(sharedId: String) = s"$httpUri/sharedannotations/$sharedId/share"
}

case class SharedSendData(sharedId: String, sharedLink: String)

object SharedSendData {
  implicit val sharedDataFormat = Json.format[SharedSendData]

  implicit def sharedSendDataWrites: Writes[SharedSendData] = (
    (__ \ "sharedId").write[String] and
    (__ \ "sharedLink").write[String]
    )(unlift(SharedSendData.unapply))
}

case class SharedAnnotationData(val sharedId: String, val restrictions: SharedAnnotationRestriction)

object SharedAnnotationData {

  implicit val sharedAnnotationDataFormatter = Json.format[SharedAnnotationData]

  implicit def restrictionsWrites: Writes[SharedAnnotationData] = (
    (__ \ "sharedId").write[String] and
    (__ \ "restrictions").write[SharedAnnotationRestriction]
    )(unlift(SharedAnnotationData.unapply))



  implicit def restrictionsReads: Reads[SharedAnnotationData] = (
      (__ \ "sharedId").read[String] and
      (__ \ "restrictions").read[SharedAnnotationRestriction]
    )(SharedAnnotationData.apply _)
}

case class SharedAnnotationRestriction(val allowAccess: String,
                                  val allowUpdate: String,
                                  val allowDownload: String,
                                  val allowFinish: String) extends AnnotationBaseRestrictions {
  import scala.util.Try

  override def allowAccess(user: Option[User]): Boolean = Try(allowAccess.toBoolean).getOrElse(false)
  override def allowUpdate(user: Option[User]): Boolean = Try(allowUpdate.toBoolean).getOrElse(false)
  override def allowFinish(user: Option[User]): Boolean = Try(allowFinish.toBoolean).getOrElse(false)
  override def allowDownload(user: Option[User]): Boolean = Try(allowDownload.toBoolean).getOrElse(false)

  override def allowAccess(user: User): Boolean = Try(allowAccess.toBoolean).getOrElse(false)
  override def allowUpdate(user: User): Boolean = Try(allowUpdate.toBoolean).getOrElse(false)
  override def allowFinish(user: User): Boolean = Try(allowFinish.toBoolean).getOrElse(false)
  override def allowDownload(user: User): Boolean = Try(allowDownload.toBoolean).getOrElse(false)
}

object SharedAnnotationRestriction {

  implicit val sharedAnnotationResctrictionFormat = Json.format[SharedAnnotationRestriction]

  implicit def restrictionsWrites: Writes[SharedAnnotationRestriction] = (
      (__ \ "allowAccess").write[String] and
      (__ \ "allowUpdate").write[String] and
      (__ \ "allowDownload").write[String] and
      (__ \ "allowFinish").write[String]
    )(unlift(SharedAnnotationRestriction.unapply))

  implicit def restrictionsReads: Reads[SharedAnnotationRestriction] = (
     (__ \ "allowAccess").read[String] and
     (__ \ "allowUpdate").read[String] and
     (__ \ "allowDownload").read[String] and
     (__ \ "allowFinish").read[String]
  )(SharedAnnotationRestriction.apply _)

}

case class SharedAnnotation(val typ: String = AnnotationType.Explorational,
                       val id: String,
                       val sharedId: String,
                       val restrictions: SharedAnnotationRestriction)

object SharedAnnotation {

  implicit val sharedAnnotationFormat = Json.format[SharedAnnotation]

  implicit def sharedAnnotationWrites(sharedAnnotation: SharedAnnotation): JsObject = {
    Json.obj(
      "typ" -> sharedAnnotation.typ,
      "id" -> sharedAnnotation.id,
      "sharedId" -> sharedAnnotation.sharedId,
      "restrictions" -> sharedAnnotation.restrictions
    )
  }

  implicit def sharedAnnotationReads(): Reads[SharedAnnotation] = (
    (__ \ "typ").read[String] and
     (__ \ "id").read[String] and
     (__ \ "sharedId").read[String] and
     (__ \ "restrictions").read[SharedAnnotationRestriction]
    )(SharedAnnotation.apply _)

}

object SharedAnnotationDAO
  extends SecuredBaseDAO[SharedAnnotation]
  with FoxImplicits {

  import play.api.libs.concurrent.Execution.Implicits._

  val collectionName = "sharedAnnotations"
  val formatter = SharedAnnotation.sharedAnnotationFormat

  def finish(id: String)(implicit restrictions: SharedAnnotationRestriction = SharedAnnotationRestriction(allowAccess = "true", allowDownload = "false", allowUpdate = "false", allowFinish = "false"),
                                  ctx: DBAccessContext) = {
    update(
      Json.obj("id" -> id),
      Json.obj("$set" -> Json.obj("restrictions" -> restrictions))
    )
  }

  def getSharedRestrictionsById(id: String)(implicit ctx: DBAccessContext) = {
    find(
      Json.obj(
        "id" -> id
      )
    ).one[SharedAnnotation].map {
      case Some(annotation) => annotation.restrictions
      case _ => SharedAnnotationRestriction("false", "false", "false", "false")
    }
  }

  def isShared(typ: String, id: String)(implicit ctx: DBAccessContext) = {
    find(
      Json.obj(
        "typ" -> typ,
        "id" -> id)).one[SharedAnnotation].map {
      case Some(annotation) => true
      case _ => false
    }
  }

  def removeObj(typ: String, id: String, sharedId: String)(implicit ctx: DBAccessContext) = {
    remove(Json.obj("typ" -> typ, "id" -> id, "sharedId" -> sharedId))
  }

  def getSharedId(typ: String, id: String)(implicit ctx: DBAccessContext) = {
    findOne(
      Json.obj(
        "typ" -> typ,
        "id" -> id)).map {
      case a: SharedAnnotation => a.sharedId
      case _ => ""
    }
  }

  def findOneBySharedId(sharedId: String)(implicit ctx: DBAccessContext) = {
    findOne(Json.obj("sharedId" -> sharedId))
  }
}
