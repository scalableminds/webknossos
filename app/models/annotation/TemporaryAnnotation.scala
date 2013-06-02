package models.annotation

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 03:05
 */

import oxalis.nml.TreeLike
import oxalis.nml.BranchPoint
import braingames.geometry.Scale
import braingames.geometry.Point3D
import oxalis.nml.Comment
import oxalis.nml.NML
import models.user.User
import models.user.User
import models.task.Task
import models.annotation.AnnotationType._
import org.bson.types.ObjectId
import models.tracing.skeleton.{SkeletonTracingLike, TemporarySkeletonTracing}

case class TemporaryAnnotation(
                                id: String,
                                _content: () => Option[AnnotationContent],
                                typ: AnnotationType = AnnotationType.CompoundProject,
                                restrictions: AnnotationRestrictions = AnnotationRestrictions.restrictEverything,
                                state: AnnotationState = AnnotationState.Finished,
                                _name: Option[String] = None,
                                version: Int = 0) extends AnnotationLike {

  def _user = new ObjectId

  def user = None

  def incrementVersion = this.copy(version = version + 1)

  type Self = TemporaryAnnotation

  lazy val content = _content()

  def task = None
}