package models.annotation

import play.api.libs.concurrent.Execution.Implicits._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 03:05
 */

import models.annotation.AnnotationType._
import org.bson.types.ObjectId
import scala.concurrent.Future
import braingames.util.Fox

case class TemporaryAnnotation(
                                id: String,
                                _content: () => Fox[AnnotationContent],
                                typ: AnnotationType = AnnotationType.CompoundProject,
                                restrictions: AnnotationRestrictions = AnnotationRestrictions.restrictEverything,
                                state: AnnotationState = AnnotationState.Finished,
                                _name: Option[String] = None,
                                version: Int = 0
                              ) extends AnnotationLike {

  def _user = new ObjectId

  def user = Future.successful(None)

  def incrementVersion = this.copy(version = version + 1)

  type Self = TemporaryAnnotation

  lazy val content = _content()

  def task = None
}