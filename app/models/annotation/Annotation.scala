package models.annotation

import org.bson.types.ObjectId
import models.basics._
import models.task.{TaskType, Task}
import models.user.User
import models.security.Role
import com.mongodb.casbah.commons.{MongoDBList, MongoDBObject}
import AnnotationType._
import oxalis.nml.NML
import braingames.binary.models.DataSet
import braingames.geometry.Point3D
import java.util.Date
import play.api.libs.json.JsValue
import play.api.Logger
import models.tracing.skeleton.{AnnotationStatistics, SkeletonTracing, TemporarySkeletonTracing}

case class Annotation(
  _user: ObjectId,
  _content: ContentReference,
  _task: Option[ObjectId] = None,
  state: AnnotationState = AnnotationState.InProgress,
  typ: String = AnnotationType.Explorational,
  version: Int = 0,
  _name: Option[String] = None,
  override val review: List[AnnotationReview] = Nil,
  _id: ObjectId = new ObjectId)

  extends DAOCaseClass[Annotation] with AnnotationLike {

  lazy val id = _id.toString

  val dao = AnnotationDAO


  /**
   * Easy access methods
   */

  val name = _name getOrElse ""

  def task = _task flatMap Task.findOneById

  lazy val user = User.findOneById(_user)

  lazy val content: Option[AnnotationContent] = _content.resolveAs[AnnotationContent]

  def dataSetName = content.map(_.dataSetName) getOrElse ""

  def contentType = _content.contentType

  val restrictions = AnnotationRestrictions.defaultAnnotationRestrictions(this)

  def isReadyToBeFinished = {
    // TODO: RF - rework
    val nodesInBase =
      task.flatMap(_.annotationBase.flatMap(SkeletonTracing.statisticsForAnnotation).map(_.numberOfNodes)).getOrElse(1L)
    SkeletonTracing.statisticsForAnnotation(this).map(_.numberOfNodes > nodesInBase) getOrElse true
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

object AnnotationDAO extends BasicDAO[Annotation]("annotations") with AnnotationStatistics with AnnotationContentProviders {
  this.collection.ensureIndex("_task")
  this.collection.ensureIndex("_user")

  def findTrainingForReviewAnnotation(annotation: AnnotationLike) =
    withValidId(annotation.id) {
      id =>
        findOne(MongoDBObject("review.reviewAnnotation" -> id))
    }

  def countOpenAnnotations(user: User, annotationType: AnnotationType) =
    findOpenAnnotationsFor(user, annotationType).size

  def hasAnOpenAnnotation(user: User, annotationType: AnnotationType) =
    countOpenAnnotations(user, annotationType) > 0

  def findFor(u: User) =
    find(MongoDBObject(
      "_user" -> u._id,
      "state.isAssigned" -> true)).toList

  def findFor(u: User, annotationType: AnnotationType) =
    find(MongoDBObject(
      "_user" -> u._id,
      "state.isAssigned" -> true,
      "typ" -> annotationType)).toList

  def findOpenAnnotationFor(user: User, annotationType: AnnotationType) =
    findOpenAnnotationsFor(user, annotationType).headOption

  def findOpenAnnotationsFor(user: User, annotationType: AnnotationType) =
    find(MongoDBObject(
      "_user" -> user._id,
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

  def createSample(annotation: Annotation, taskId: ObjectId): Annotation = {
    copyDeepAndInsert(annotation.copy(
      typ = AnnotationType.Sample,
      _task = Some(taskId)))
  }

  def createAnnotationBase(task: Task, userId: ObjectId, settings: AnnotationSettings, nml: NML) = {
    val tracing = SkeletonTracing.createFromNML(settings, nml)
    val content = ContentReference.createFor(tracing)
    insertOne(Annotation(userId, content, typ = AnnotationType.TracingBase, _task = Some(task._id)))
  }

  def createAnnotationBase(task: Task, userId: ObjectId, settings: AnnotationSettings, dataSetName: String, start: Point3D) = {
    val tracing = SkeletonTracing.createFromStart(settings, dataSetName, start)
    val content = ContentReference.createFor(tracing)
    insertOne(Annotation(userId, content, typ = AnnotationType.TracingBase, _task = Some(task._id)))
  }

  def copyDeepAndInsert(source: Annotation) = {
    val content = source.content.map(_.copyDeepAndInsert)
    val contentId = content.map(_.id) getOrElse source._content._id
    insertOne(source.copy(
      _id = new ObjectId,
      _content = source._content.copy(_id = contentId)))
  }

  def createReviewFor(sample: Annotation, training: Annotation, user: User) = {
    for {
      reviewContent <- training.content.map(_.copyDeepAndInsert)
      sampleContent <- sample.content
    } yield {
      reviewContent.mergeWith(sampleContent)
      insertOne(training.copy(
        _id = new ObjectId,
        _user = user._id,
        state = AnnotationState.Assigned,
        typ = AnnotationType.Review,
        _content = training._content.copy(_id = reviewContent.id)
      ))
    }
  }

  def createAnnotationFor(user: User, task: Task) = {
    Logger.warn("reached createAnnotationFor: " + task.annotationBase + " Task " + task)
    task.annotationBase.map {
      annotationBase =>
        task.update(_.assigneOnce)

        copyDeepAndInsert(annotationBase.copy(
          _user = user._id,
          state = AnnotationState.InProgress,
          typ = AnnotationType.Task))
    }
  }

  def createExplorationalFor(user: User, dataSet: DataSet, contentType: String) = {
    withProviderForContentType(contentType) {
      provider =>
        val content = provider.createForDataSet(dataSet)
        insertOne(Annotation(
          user._id,
          ContentReference.createFor(content),
          typ = AnnotationType.Explorational,
          state = AnnotationState.InProgress
        ))
    }
  }

  def resetToBase(annotation: Annotation) = {
    for {
      task <- annotation.task
      annotationContent <- annotation.content
      tracingBase <- task.annotationBase.flatMap(_.content)
    } yield {
      val resetted = tracingBase.copyDeepAndInsert
      annotation.update(
        _.copy(_content = ContentReference.createFor(resetted))
      )
      //TODO: RF - remove annotationContent from DB
      annotationContent.clearTracingData()
      annotation
    }
  }

  def updateAllUsingNewTaskType(task: Task, taskType: TaskType) = {
    find(
      MongoDBObject(
        "_task" -> task._id)).map {
      annotation =>
        annotation._content.dao.updateSettings(task.settings, annotation._content._id)
    }
  }

  def updateFromJson(js: Seq[JsValue], annotation: AnnotationLike) = {
    annotation.content.flatMap(_.updateFromJson(js)).map(_ =>
      annotation.incrementVersion)
  }

  def assignReviewer(training: Annotation, user: User): Option[Annotation] = {
    for {
      task <- training.task
      sampleId <- task.training.map(_.sample)
      sample <- AnnotationDAO.findOneById(sampleId)
      reviewAnnotation <- createReviewFor(sample, training, user)
    } yield {
      training.update(_.assignReviewer(user, reviewAnnotation))
    }
  }

  def freeAnnotationsOfUser(userId: ObjectId) = {
    find(MongoDBObject(
      "_user" -> userId,
      "state.isFinished" -> false,
      "typ" -> AnnotationType.Task.toString))
      .toList
      .foreach(_.update(_.cancel))

    update(
      MongoDBObject(
        "_user" -> userId,
        "typ" -> MongoDBObject("$in" -> AnnotationType.UserTracings)),
      MongoDBObject(
        "$set" -> MongoDBObject(
          "state.isAssigned" -> false)))
  }

  def createFromNML(userId: ObjectId, nml: NML, annotationType: AnnotationType, name: Option[String]) = {
    val content = SkeletonTracing.createFromNML(AnnotationSettings.default, nml)

    insertOne(Annotation(
      userId,
      ContentReference.createFor(content),
      _name = name,
      typ = annotationType))
  }

  def createFromNMLs(userId: ObjectId, nmls: List[NML], annotationType: AnnotationType, name: Option[String]): Option[Annotation] = {
    nmls match {
      case head :: tail =>
        val startAnnotation = createFromNML(
          userId,
          head,
          AnnotationType.Explorational,
          name)

        startAnnotation.content.map {
          c =>
            tail.foldLeft(c) {
              case (t, s) =>
                t.mergeWith(TemporarySkeletonTracing.createFrom(s, s.timeStamp.toString))
            }
        }
        Some(startAnnotation)
      case _ =>
        None
    }
  }
}
