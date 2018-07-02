package models.annotation

import java.io.{BufferedOutputStream, FileOutputStream}

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale, Vector3D}
import com.scalableminds.util.io.{NamedEnumeratorStream, ZipIO}
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceLike => DataSource, SegmentationLayerLike => SegmentationLayer}
import com.scalableminds.webknossos.datastore.tracings._
import com.scalableminds.webknossos.datastore.tracings.skeleton.{NodeDefaults, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.tracings.volume.VolumeTracingDefaults
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationState._
import models.annotation.AnnotationTypeSQL.AnnotationTypeSQL
import models.annotation.handler.SavedTracingInformationHandler
import models.annotation.nml.NmlWriter
import models.binary.{DataSet, DataSetDAO, DataSetSQLDAO, DataStoreHandlingStrategy}
import models.task.TaskSQL
import models.team.OrganizationSQLDAO
import models.user.User
import utils.ObjectId
import play.api.i18n.Messages
import play.api.Play.current
import play.api.i18n.Messages.Implicits._

import scala.concurrent.Future
import scala.collection.{IterableLike, TraversableLike}
import scala.runtime.Tuple3Zipped
import scala.collection.generic.Growable
import net.liftweb.common.{Box, Full}
import play.api.libs.Files.TemporaryFile
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import reactivemongo.bson.BSONObjectID

object AnnotationService
  extends BoxImplicits
  with FoxImplicits
  with TextUtils
  with ProtoGeometryImplicits
  with LazyLogging {

  private def selectSuitableTeam(user: User, dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[ObjectId] = {
    val selectedTeamOpt = dataSet.allowedTeams.intersect(user.teamIds).headOption
    selectedTeamOpt match {
      case Some(selectedTeam) => Fox.successful(ObjectId.fromBsonId(selectedTeam))
      case None =>
        for {
          _ <- (user.isTeamManagerInOrg(user.organization) || user.isAdmin)
          organization <- OrganizationSQLDAO.findOneByName(user.organization)
          organizationTeamId <- OrganizationSQLDAO.findOrganizationTeamId(organization._id)
        } yield organizationTeamId
    }
  }

  private def createVolumeTracing(dataSource: DataSource, withFallback: Boolean): VolumeTracing = {
    val fallbackLayer = if (withFallback) {
      dataSource.dataLayers.flatMap {
        case layer: SegmentationLayer => Some(layer)
        case _ => None
      }.headOption
    } else None

    VolumeTracing(
      None,
      dataSource.boundingBox,
      System.currentTimeMillis(),
      dataSource.id.name,
      dataSource.center,
      VolumeTracingDefaults.editRotation,
      fallbackLayer.map(layer => elementClassToProto(layer.elementClass)).getOrElse(VolumeTracingDefaults.elementClass),
      fallbackLayer.map(_.name),
      fallbackLayer.map(_.largestSegmentId).getOrElse(VolumeTracingDefaults.largestSegmentId),
      0,
      VolumeTracingDefaults.zoomLevel
    )
  }

  def createExplorationalFor(
    user: User,
    _dataSet: ObjectId,
    tracingType: TracingType.Value,
    withFallback: Boolean)(implicit ctx: DBAccessContext): Fox[AnnotationSQL] = {

    def createTracing(dataSet: DataSet, dataSource: DataSource) = tracingType match {
      case TracingType.skeleton =>
        dataSet.dataStore.saveSkeletonTracing(SkeletonTracingDefaults.createInstance.copy(dataSetName = dataSet.name, editPosition = dataSource.center))
      case TracingType.volume =>
        dataSet.dataStore.saveVolumeTracing(createVolumeTracing(dataSource, withFallback))
    }
    for {
      dataSet <- DataSetDAO.findOneById(_dataSet)
      dataSource <- dataSet.dataSource.toUsable ?~> "DataSet is not imported."
      tracing <- createTracing(dataSet, dataSource)
      teamId <- selectSuitableTeam(user, dataSet)
      annotation = AnnotationSQL(
        ObjectId.generate,
        _dataSet,
        None,
        teamId,
        ObjectId.fromBsonId(user._id),
        tracing
      )
      _ <- AnnotationSQLDAO.insertOne(annotation)
    } yield {
      annotation
    }
  }

  def finish(annotation: AnnotationSQL)(implicit ctx: DBAccessContext) = {
    // WARNING: needs to be repeatable, might be called multiple times for an annotation
    AnnotationSQLDAO.updateState(annotation._id, AnnotationState.Finished)
  }

  def baseFor(taskId: ObjectId)(implicit ctx: DBAccessContext): Fox[AnnotationSQL] =
    (for {
      list <- AnnotationSQLDAO.findAllByTaskIdAndType(taskId, AnnotationTypeSQL.TracingBase)
    } yield list.headOption.toFox).flatten

  def annotationsFor(taskId: ObjectId)(implicit ctx: DBAccessContext) =
      AnnotationSQLDAO.findAllByTaskIdAndType(taskId, AnnotationTypeSQL.Task)

  def countActiveAnnotationsFor(taskId: ObjectId)(implicit ctx: DBAccessContext) =
    AnnotationSQLDAO.countActiveByTask(taskId, AnnotationTypeSQL.Task)

  def countOpenNonAdminTasks(user: User)(implicit ctx: DBAccessContext) =
    AnnotationSQLDAO.countActiveAnnotationsFor(ObjectId.fromBsonId(user._id), AnnotationTypeSQL.Task, user.teamManagerTeamIds.map(ObjectId.fromBsonId(_)))

  def tracingFromBase(annotationBase: AnnotationSQL, dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[TracingReference] = {
    for {
      dataSource <- dataSet.dataSource.toUsable.toFox ?~> Messages("dataSet.notImported", dataSet.name)
      newTracingReference <- dataSet.dataStore.duplicateSkeletonTracing(annotationBase.tracing)
    } yield newTracingReference
  }

  def createAnnotationFor(user: User, task: TaskSQL, initializingAnnotationId: ObjectId)(implicit messages: Messages, ctx: DBAccessContext): Fox[AnnotationSQL] = {
    def useAsTemplateAndInsert(annotation: AnnotationSQL) = {
      for {
        dataSetName <- DataSetSQLDAO.getNameById(annotation._dataSet)(GlobalAccessContext) ?~> "dataSet.notFound"
        dataSet <- DataSetDAO.findOneById(annotation._dataSet) ?~> ("Could not access DataSet " + dataSetName + ". Does your team have access?")
        newTracing <- tracingFromBase(annotation, dataSet) ?~> "Failed to use annotation base as template."
        newAnnotation = annotation.copy(
          _id = initializingAnnotationId,
          _user = ObjectId.fromBsonId(user._id),
          tracing = newTracing,
          state = Active,
          typ = AnnotationTypeSQL.Task,
          created = System.currentTimeMillis,
          modified = System.currentTimeMillis)
        _ <- AnnotationSQLDAO.updateInitialized(newAnnotation)
      } yield {
        newAnnotation
      }
    }

    for {
      annotationBase <- task.annotationBase ?~> "Failed to retrieve annotation base."
      result <- useAsTemplateAndInsert(annotationBase).toFox
    } yield {
      result
    }
  }

  def createTracingBase(dataSetName: String, boundingBox: Option[BoundingBox], startPosition: Point3D, startRotation: Vector3D) = {
    val initialNode = NodeDefaults.createInstance.withId(1).withPosition(startPosition).withRotation(startRotation)
    val initialTree = Tree(
      1,
      Seq(initialNode),
      Seq(),
      Some(Color(1, 0, 0, 1)),
      Seq(BranchPoint(initialNode.id, System.currentTimeMillis())),
      Seq(),
      "",
      System.currentTimeMillis()
    )
    SkeletonTracingDefaults.createInstance.copy(
      dataSetName = dataSetName,
      boundingBox = boundingBox.flatMap { box => if (box.isEmpty) None else Some(box) },
      editPosition = startPosition,
      editRotation = startRotation,
      activeNodeId = Some(1),
      trees = Seq(initialTree))
  }

  def abortInitializedAnnotationOnFailure(initializingAnnotationId: ObjectId, insertedAnnotationBox: Box[AnnotationSQL]) = {
    insertedAnnotationBox match {
      case Full(_) => Fox.successful(())
      case _ => AnnotationSQLDAO.abortInitializingAnnotation(initializingAnnotationId)
    }
  }

  def createAnnotationBase(
    taskFox: Fox[TaskSQL],
    userId: BSONObjectID,
    tracingReferenceBox: Box[TracingReference],
    dataSetId: ObjectId,
    description: Option[String]
    )(implicit ctx: DBAccessContext) = {

    for {
      task <- taskFox
      taskType <- task.taskType
      tracingReference <- tracingReferenceBox.toFox
      project <- task.project
      annotationBase = AnnotationSQL(
        ObjectId.generate,
        dataSetId,
        Some(task._id),
        project._team,
        ObjectId.fromBsonId(userId),
        tracingReference,
        description.getOrElse(""),
        typ = AnnotationTypeSQL.TracingBase)
      _ <- AnnotationSQLDAO.insertOne(annotationBase)
    } yield true
  }


  def createFrom(
                user: User,
                dataSetId: ObjectId,
                dataSet: DataSet,
                tracingReference: TracingReference,
                annotationType: AnnotationTypeSQL,
                name: Option[String],
                description: String)(implicit messages: Messages, ctx: DBAccessContext): Fox[AnnotationSQL] = {
    for {
      teamId <- selectSuitableTeam(user, dataSet)
      annotation = AnnotationSQL(
        ObjectId.generate,
        dataSetId,
        None,
        teamId,
        ObjectId.fromBsonId(user._id),
        tracingReference,
        description,
        name = name.getOrElse(""),
        typ = annotationType)
      _ <- AnnotationSQLDAO.insertOne(annotation)
    } yield annotation
  }

  def zipAnnotations(annotations: List[AnnotationSQL], zipFileName: String)(implicit messages: Messages, ctx: DBAccessContext): Fox[TemporaryFile] = {
    for {
      tracingsNamesAndScalesAsTuples <- getTracingsScalesAndNamesFor(annotations)
      tracingsAndNamesFlattened = flattenTupledLists(tracingsNamesAndScalesAsTuples)
      nmlsAndNames = tracingsAndNamesFlattened.map(tuple => (NmlWriter.toNmlStream(Left(tuple._1), tuple._4, tuple._3), tuple._2))
      zip <- createZip(nmlsAndNames, zipFileName)
    } yield zip
  }

  private def flattenTupledLists[A,B,C,D](tupledLists: List[(List[A], List[B], List[C], List[D])]) = {
    tupledLists.map(tuple => zippedFourLists(tuple._1, tuple._2, tuple._3, tuple._4)).flatten
  }

  private def zippedFourLists[A,B,C,D](l1: List[A], l2: List[B], l3: List[C], l4: List[D]): List[(A, B, C, D)] = {
    ((l1, l2, l3).zipped.toList, l4).zipped.toList.map( tuple => (tuple._1._1, tuple._1._2, tuple._1._3, tuple._2))
  }

  private def getTracingsScalesAndNamesFor(annotations: List[AnnotationSQL])(implicit ctx: DBAccessContext): Fox[List[(List[SkeletonTracing], List[String], List[Option[Scale]], List[AnnotationSQL])]] = {

    def getTracings(dataSetId: ObjectId, tracingReferences: List[TracingReference]) = {
      for {
        dataSet <- DataSetDAO.findOneById(dataSetId)
        tracingContainers <- Fox.serialCombined(tracingReferences.grouped(1000).toList)(dataSet.dataStore.getSkeletonTracings)
      } yield tracingContainers.flatMap(_.tracings)
    }

    def getDatasetScale(dataSetId: ObjectId) = {
      for {
        dataSet <- DataSetDAO.findOneById(dataSetId)
      } yield dataSet.dataSource.scaleOpt
    }

    def getNames(annotations: List[AnnotationSQL]) = Fox.combined(annotations.map(a => SavedTracingInformationHandler.nameForAnnotation(a).toFox))

    val annotationsGrouped: Map[ObjectId, List[AnnotationSQL]] = annotations.groupBy(_._dataSet)
    val tracings = annotationsGrouped.map {
      case (dataSetId, annotations) => {
        for {
          scale <- getDatasetScale(dataSetId)
          tracings <- getTracings(dataSetId, annotations.map(_.tracing))
          names <- getNames(annotations)
        } yield (tracings, names, annotations.map(a => scale), annotations)
      }
    }
    Fox.combined(tracings.toList)
  }

  private def createZip(nmls: List[(Enumerator[Array[Byte]],String)], zipFileName: String): Future[TemporaryFile] = {
    val zipped = TemporaryFile(normalize(zipFileName), ".zip")
    val zipper = ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(zipped.file)))

    def addToZip(nmls: List[(Enumerator[Array[Byte]],String)]): Future[Boolean] = {
      nmls match {
        case head :: tail =>
          zipper.withFile(head._2 + ".nml")(NamedEnumeratorStream("", head._1).writeTo).flatMap(_ => addToZip(tail))
        case _            =>
          Future.successful(true)
      }
    }

    addToZip(nmls).map { _ =>
      zipper.close()
      zipped
    }
  }
}
