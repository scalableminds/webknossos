package models.annotation

import org.bson.types.ObjectId
import models.basics._
import models.task.Task
import models.tracing.Tracing
import models.user.User

case class Annotation(
  _user: ObjectId,
  content: AnnotationContent,
  _task: Option[ObjectId] = None,
  state: AnnotationState = AnnotationState.InProgress,
  review: List[AnnotationReview] = Nil,
  typ: String = AnnotationType.Explorational,
  version: Int = 0,
  override val _name: Option[String] = None,
  _id: ObjectId = new ObjectId)
    extends DAOCaseClass[Annotation] {

  lazy val id = _id.toString

  def task = _task flatMap Task.findOneById

  /**
   * State modifications
   * always return a new instance!
   */
  def unassignReviewer =
    this.copy(
      state = AnnotationState.ReadyForReview,
      review = if (this.review.isEmpty) Nil else review.tail)

  def finishReview(comment: String) = {
    val alteredReview = this.review match {
      case head :: tail =>
        head.copy(comment = Some(comment)) :: tail
      case _ =>
        Nil
    }
    this.copy(review = alteredReview)
  }

  def cancel = {
    task.map(_.update(_.unassigneOnce))
    this.copy(state = AnnotationState.Unassigned)
  }

  def finish = {
    this.copy(state = AnnotationState.Finished)
  }

  def passToReview = {
    this.copy(state = AnnotationState.ReadyForReview)
  }

  def assignReviewer(user: User, reviewAnnotation: Annotation) =
    this.copy(
      state = AnnotationState.InReview,
      review = AnnotationReview(
        user._id,
        reviewAnnotation._id,
        System.currentTimeMillis()) :: this.review)

  def reopen = {
    this.copy(state = AnnotationState.InProgress)
  }

  def removeTask = {
    this.copy(_task = None, typ = AnnotationType.Orphan)
  }
}

object Annotation extends BasicDAO[Annotation]("annotations") {
  this.collection.ensureIndex("_task")
  this.collection.ensureIndex("_user")
}
