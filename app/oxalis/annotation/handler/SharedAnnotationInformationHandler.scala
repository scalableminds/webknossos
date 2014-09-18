package oxalis.annotation.handler

import net.liftweb.common.Box
import play.api.i18n.Messages
import com.scalableminds.util.tools.TextUtils._
import models.annotation._
import com.scalableminds.util.reactivemongo.{GlobalAccessContext, DBAccessContext}
import reactivemongo.bson.BSONObjectID
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import models.user.User

object SharedAnnotationInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  import com.scalableminds.util.mvc.BoxImplicits._

  type AType = Annotation

  override val cache = false

  override def nameForAnnotation(a: AnnotationLike)(implicit ctx: DBAccessContext): Future[String] = a match {
    case annotation: Annotation =>
      for {
        userName <- annotation.user.toFox.map(_.abreviatedName) getOrElse ""
        dataSetName <- annotation.dataSetName
        task <- annotation.task.map(_.id) getOrElse ("explorational")
      } yield {
        val id = oxalis.view.helpers.formatHash(annotation.id)
        normalize(s"${dataSetName}__${task}__${userName}__${id}")
      }
    case a =>
      Future.successful(a.id)
  }

  def provideAnnotation(annotationId: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] = {
    println("proviceAnnotation SHARE")
    for {
      annotation <- AnnotationDAO.findOneById(annotationId)(GlobalAccessContext) ?~> Messages("annotation.notFound")
      sharedRestrictions <- SharedAnnotationDAO.getSharedRestrictionsById(annotationId)
    } yield {
      println(sharedRestrictions)
      annotation.copy()(_restrictions = Some(sharedRestrictions))
    }
  }

}
