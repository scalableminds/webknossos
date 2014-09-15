package models.annotation

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.FoxImplicits
import models.basics.SecuredBaseDAO
import play.api.libs.json.{Reads, OFormat, Json, JsObject}
import reactivemongo.bson.BSONObjectID
import play.api.libs.functional.syntax._
import play.api.libs.json._

/**
 * Company: scalableminds
 * User: speedcom
 * Date: 14.09.14
 * Time: 12:39
 */

case class SharedAnnotationData(val sharedLink: String, val restrictions: SharedAnnotationRestriction)

object SharedAnnotationData {

  implicit val sharedAnnotationDataFormatter = Json.format[SharedAnnotationData]

  implicit def restrictionsWrites: Writes[SharedAnnotationData] = (
    (__ \ "sharedLink").write[String] and
    (__ \ "restrictions").write[SharedAnnotationRestriction]
    )(unlift(SharedAnnotationData.unapply))



  implicit def restrictionsReads: Reads[SharedAnnotationData] = (
      (__ \ "sharedLink").read[String] and
      (__ \ "restrictions").read[SharedAnnotationRestriction]
    )(SharedAnnotationData.apply _)
}

case class SharedAnnotationRestriction(val allowAccess: String,
                                  val allowUpdate: String,
                                  val allowDownload: String,
                                  val allowFinish: String) extends AnnotationBaseRestrictions

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
                       val sharedLink: String,
                       val restrictions: SharedAnnotationRestriction)

object SharedAnnotation {

  implicit val sharedAnnotationFormat = Json.format[SharedAnnotation]

  implicit def sharedAnnotationWrites(sharedAnnotation: SharedAnnotation): JsObject = {
    Json.obj(
      "typ" -> sharedAnnotation.typ,
      "id" -> sharedAnnotation.id,
      "sharedLink" -> sharedAnnotation.sharedLink,
      "restrictions" -> sharedAnnotation.restrictions
    )
  }

  implicit def sharedAnnotationReads(): Reads[SharedAnnotation] = (
    (__ \ "typ").read[String] and
     (__ \ "id").read[String] and
     (__ \ "sharedLink").read[String] and
     (__ \ "restrictions").read[SharedAnnotationRestriction]
    )(SharedAnnotation.apply _)

}

object SharedAnnotationDAO
  extends SecuredBaseDAO[SharedAnnotation]
  with FoxImplicits {

  import play.api.libs.concurrent.Execution.Implicits._

  val collectionName = "sharedAnnotations"
  val formatter = SharedAnnotation.sharedAnnotationFormat

  def isShared(typ: String, id: String)(implicit ctx: DBAccessContext) = {
    find(
      Json.obj(
        "typ" -> typ,
        "id" -> id)).one[SharedAnnotation].map {
      case Some(annotation) => true
      case _ => false
    }
  }
}
