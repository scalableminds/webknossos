package models.annotation

import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import com.scalableminds.util.reactivemongo.DBAccessContext
import play.api.libs.json.JsValue
import oxalis.view.ResourceActionCollection
import models.user.User

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 03:05
 */

import models.annotation.AnnotationType._

import scala.concurrent.Future
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.io.NamedFileStream

case class TemporaryAnnotation(
                                id: String,
                                team: String,
                                _content: () => Fox[AnnotationContent],
                                typ: AnnotationType = AnnotationType.CompoundProject,
                                restrictions: AnnotationRestrictions = AnnotationRestrictions.restrictEverything,
                                state: AnnotationState = AnnotationState.Finished,
                                _name: Option[String] = None,
                                version: Int = 0,
                                created : Long = System.currentTimeMillis
                              ) extends AnnotationLike {

  def _user = BSONObjectID.generate

  def user = Future.successful(None)

  def incrementVersion = this.copy(version = version + 1)

  type Self = TemporaryAnnotation

  lazy val content = _content()

  def task = None

  def muta = new TemporaryAnnotationMutations(this)

  def actions(user: Option[User]) = ResourceActionCollection()
}

class TemporaryAnnotationMutations(annotation: TemporaryAnnotation) extends AnnotationMutationsLike{
  type AType = TemporaryAnnotation

  def resetToBase()(implicit ctx: DBAccessContext): Fox[TemporaryAnnotationMutations#AType] = ???

  def reopen()(implicit ctx: DBAccessContext): Fox[TemporaryAnnotationMutations#AType] = ???

  def updateFromJson(js: Seq[JsValue])(implicit ctx: DBAccessContext): Fox[TemporaryAnnotationMutations#AType] = ???

  def cancelTask()(implicit ctx: DBAccessContext): Fox[TemporaryAnnotationMutations#AType] = ???

  def loadAnnotationContent()(implicit ctx: DBAccessContext): Fox[NamedFileStream] = ???

  def unassignReviewer()(implicit ctx: DBAccessContext): Fox[TemporaryAnnotationMutations#AType] = ???
}
