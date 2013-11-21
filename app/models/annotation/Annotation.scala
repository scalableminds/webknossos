package models.annotation

import org.bson.types.ObjectId
import models.basics._
import models.task.{TaskService, TaskDAO, TaskType, Task}
import models.user.{UserService, UserDAO, User}
import models.security.Role
import com.mongodb.casbah.commons.{MongoDBList, MongoDBObject}
import AnnotationType._
import oxalis.nml.NML
import braingames.binary.models.DataSet
import braingames.geometry.Point3D
import java.util.Date
import play.api.libs.json.{Json, JsValue}
import play.api.Logger
import models.tracing.skeleton.{AnnotationStatistics, SkeletonTracing, TemporarySkeletonTracing}
import models.basics.Implicits._
import braingames.util.{Fox, FoxImplicits}
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future
import reactivemongo.bson.BSONObjectID
import braingames.reactivemongo.{DBAccessContext, GlobalAccessContext}

case class Annotation(
                       _user: ObjectId,
                       _content: ContentReference,
                       _task: Option[ObjectId] = None,
                       state: AnnotationState = AnnotationState.InProgress,
                       typ: String = AnnotationType.Explorational,
                       version: Int = 0,
                       _name: Option[String] = None,
                       override val review: List[AnnotationReview] = Nil,
                       _id: ObjectId = new ObjectId
                     )

  extends DAOCaseClass[Annotation] with AnnotationLike with FoxImplicits {

  lazy val id = _id.toString

  val dao = AnnotationDAO


  /**
   * Easy access methods
   */

  val name = _name getOrElse ""

  lazy val task = _task.toFox.flatMap(id => TaskDAO.findOneById(BSONObjectID.parse(id.toString).get)(GlobalAccessContext))

  lazy val user = UserService.findOneById(_user.toString, useCache = true)

  lazy val content = _content.resolveAs[AnnotationContent].toFox

  lazy val dataSetName = content.map(_.dataSetName) getOrElse ""

  lazy val contentType = _content.contentType

  val restrictions = AnnotationRestrictions.defaultAnnotationRestrictions(this)

  def isReadyToBeFinished = {
    // TODO: RF - rework
    task
    .flatMap(_.annotationBase.toFox.flatMap(SkeletonTracing.statisticsForAnnotation).map(_.numberOfNodes))
    .getOrElse(1L)
    .flatMap { nodesInBase =>
      SkeletonTracing.statisticsForAnnotation(this).map(_.numberOfNodes > nodesInBase) getOrElse true
    }
  }

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

  def incrementVersion =
    this.update(_.copy(version = version + 1))

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
        new ObjectId(user._id.stringify),
        reviewAnnotation._id,
        System.currentTimeMillis()) :: this.review)

  def reopen = {
    this.copy(state = AnnotationState.InProgress)
  }

  def removeTask = {
    this.copy(_task = None, typ = AnnotationType.Orphan)
  }
}

object AnnotationDAO
  extends BasicDAO[Annotation]("annotations")
  with AnnotationStatistics
  with AnnotationContentProviders
  with FoxImplicits {

  this.collection.ensureIndex("_task")
  this.collection.ensureIndex("_user")

  def findTrainingForReviewAnnotation(annotation: AnnotationLike) =
    withValidId(annotation.id) {
      id =>
        findOne(MongoDBObject("review.reviewAnnotation" -> id))
    }

  def countOpenAnnotations(userId: ObjectId, annotationType: AnnotationType) =
    findOpenAnnotationsFor(userId, annotationType).size

  def hasAnOpenAnnotation(userId: ObjectId, annotationType: AnnotationType) =
    countOpenAnnotations(userId, annotationType) > 0

  def findFor(user: User) =
    find(MongoDBObject(
      "_user" -> user._id,
      "state.isAssigned" -> true)).toList

  def findFor(user: User, annotationType: AnnotationType) =
    find(MongoDBObject(
      "_user" -> user._id,
      "state.isAssigned" -> true,
      "typ" -> annotationType)).toList

  def findForWithTypeOtherThan(userId: ObjectId, annotationTypes: List[AnnotationType]) =
    find(MongoDBObject(
      "_user" -> userId,
      "state.isFinished" -> false,
      "state.isAssigned" -> true,
      "typ" -> MongoDBObject("$nin" -> annotationTypes))).toList

  def findOpenAnnotationFor(userId: ObjectId, annotationType: AnnotationType) =
    findOpenAnnotationsFor(userId, annotationType).headOption

  def findOpenAnnotationsFor(userId: ObjectId, annotationType: AnnotationType) =
    find(MongoDBObject(
      "_user" -> userId,
      "state.isFinished" -> false,
      "state.isAssigned" -> true,
      "typ" -> annotationType)).toList

  def findOpen(annotationType: AnnotationType) =
    find(MongoDBObject(
      "state.isFinished" -> false,
      "state.isAssigned" -> true,
      "typ" -> annotationType)).toList


  def removeAllWithTaskId(tid: ObjectId) =
    remove(MongoDBObject("_task" -> tid))

  def findByTaskId(tid: ObjectId) =
    find(MongoDBObject("_task" -> tid)).toList

  def findByTaskIdAndType(tid: ObjectId, annotationType: AnnotationType) =
    find(MongoDBObject(
      "_task" -> tid,
      "typ" -> annotationType,
      "$or" -> MongoDBList(
        "state.isAssigned" -> true,
        "state.isFinished" -> true))).toList

  def unassignAnnotationsOfUser(userId: ObjectId) = {
    update(
      MongoDBObject(
        "_user" -> userId,
        "typ" -> MongoDBObject("$in" -> AnnotationType.UserTracings)),
      MongoDBObject(
        "$set" -> MongoDBObject(
          "state.isAssigned" -> false)))
  }

  def updateState(annotation: Annotation, state: AnnotationState)(implicit ctx: DBAccessContext) = {
    // TODO: uncomment

    //collectionUpdate(
    //  Json.obj("_id" -> annotation._id),
    //  Json.obj("$set" -> Json.obj("state" -> state)))
    Future(List.empty)
  }

  def updateAllUsingNewTaskType(task: Task, settings: AnnotationSettings) = {
    find(
      MongoDBObject(
        "_task" -> task._id)).map {
      annotation =>
        annotation._content.dao.updateSettings(settings, annotation._content._id)
    }
  }

  def createSample(annotation: Annotation, taskId: ObjectId): Future[Annotation] = {
    copyDeepAndInsert(annotation.copy(
      typ = AnnotationType.Sample,
      _task = Some(taskId)))
  }

  def createFrom(userId: ObjectId, content: AnnotationContent, annotationType: AnnotationType, name: Option[String]) = {
    insertOne(Annotation(
      userId,
      ContentReference.createFor(content),
      _name = name,
      typ = annotationType))
  }

  def copyDeepAndInsert(source: Annotation) = {
    val content = source.content.map(_.copyDeepAndInsert)
    content
    .map(_.id)
    .getOrElse(source._content._id)
    .map(contentId =>
      insertOne(source.copy(
        _id = new ObjectId,
        _content = source._content.copy(_id = contentId))))
  }

  def createReviewFor(sample: Annotation, training: Annotation, user: User) = {
    for {
      reviewContent <- training.content.map(_.copyDeepAndInsert)
      sampleContent <- sample.content
    } yield {
      reviewContent.mergeWith(sampleContent)
      insertOne(training.copy(
        _id = new ObjectId,
        _user = new ObjectId(user._id.stringify),
        state = AnnotationState.Assigned,
        typ = AnnotationType.Review,
        _content = training._content.copy(_id = reviewContent.id)
      ))
    }
  }

  def createExplorationalFor(user: User, dataSet: DataSet, contentType: String) = {
    withProviderForContentType(contentType) {
      provider =>
        val content = provider.createFrom(dataSet)
        insertOne(Annotation(
          new ObjectId(user._id.stringify),
          ContentReference.createFor(content),
          typ = AnnotationType.Explorational,
          state = AnnotationState.InProgress
        ))
    }
  }

  def resetToBase(annotation: Annotation) = {
    for {
      task <- annotation.task.toFox
      annotationContent <- annotation.content
      tracingBase <- task.annotationBase.toFox.flatMap(_.content)
    } yield {
      val reseted = tracingBase.copyDeepAndInsert
      annotation.update(
        _.copy(_content = ContentReference.createFor(reseted))
      )
      annotationContent.clearTracingData()
      annotation
    }
  }

  def updateFromJson(js: Seq[JsValue], annotation: AnnotationLike) = {
    annotation.content.flatMap(_.updateFromJson(js)).map(_ =>
      annotation.incrementVersion)
  }

  def assignReviewer(training: Annotation, user: User): Fox[Annotation] = {
    for {
      task <- training.task.toFox
      sampleId <- task.training.map(_.sample).toFox
      sample <- AnnotationDAO.findOneById(sampleId).toFox
      reviewAnnotation <- createReviewFor(sample, training, user)
    } yield {
      training.update(_.assignReviewer(user, reviewAnnotation))
    }
  }
}
