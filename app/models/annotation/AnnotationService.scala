package models.annotation

import java.io.{BufferedOutputStream, FileOutputStream}

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale, Vector3D}
import com.scalableminds.util.io.{NamedEnumeratorStream, ZipIO}
import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceLike => DataSource, SegmentationLayerLike => SegmentationLayer}
import com.scalableminds.webknossos.datastore.tracings._
import com.scalableminds.webknossos.datastore.tracings.skeleton.{NodeDefaults, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.tracings.volume.VolumeTracingDefaults
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationState._
import models.annotation.AnnotationType.AnnotationType
import models.annotation.handler.SavedTracingInformationHandler
import models.annotation.nml.NmlWriter
import models.binary._
import models.task.Task
import models.team.OrganizationDAO
import models.user.{User, UserDAO}
import utils.ObjectId
import play.api.i18n.Messages
import play.api.Play.current
import play.api.i18n.Messages.Implicits._

import scala.concurrent.Future
import net.liftweb.common.{Box, Full}
import play.api.libs.Files.TemporaryFile
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import oxalis.security.WebknossosSilhouette.UserAwareRequest

object AnnotationService
  extends BoxImplicits
  with FoxImplicits
  with AnnotationInformationProvider
  with TextUtils
  with ProtoGeometryImplicits
  with LazyLogging {

  private def selectSuitableTeam(user: User, dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[ObjectId] = {
    (for {
      userTeamIds <- user.teamIds
      datasetAllowedTeamIds <- dataSet.allowedTeamIds
    } yield {
      val selectedTeamOpt = datasetAllowedTeamIds.intersect(userTeamIds).headOption
      selectedTeamOpt match {
        case Some(selectedTeam) => Fox.successful(selectedTeam)
        case None =>
          for {
            _ <- Fox.assertTrue(user.isTeamManagerOrAdminOfOrg(user._organization))
            organizationTeamId <- OrganizationDAO.findOrganizationTeamId(user._organization)
          } yield organizationTeamId
      }
    }).flatten
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
                              withFallback: Boolean)(implicit ctx: DBAccessContext): Fox[Annotation] = {

    def createTracings(dataSet: DataSet, dataSource: DataSource): Fox[(Option[String], Option[String])] = tracingType match {
      case TracingType.skeleton =>
        for {
          handler <- dataSet.dataStoreHandler
          skeletonTracingId <- handler.saveSkeletonTracing(SkeletonTracingDefaults.createInstance.copy(dataSetName = dataSet.name, editPosition = dataSource.center))
        } yield (Some(skeletonTracingId), None)
      case TracingType.volume =>
        for {
          handler <- dataSet.dataStoreHandler
          volumeTracingId <- handler.saveVolumeTracing(createVolumeTracing(dataSource, withFallback))
        } yield (None, Some(volumeTracingId))
      case TracingType.hybrid =>
        for {
          handler <- dataSet.dataStoreHandler
          skeletonTracingId <- handler.saveSkeletonTracing(SkeletonTracingDefaults.createInstance.copy(dataSetName = dataSet.name, editPosition = dataSource.center))
          volumeTracingId <- handler.saveVolumeTracing(createVolumeTracing(dataSource, withFallback))
        } yield (Some(skeletonTracingId), Some(volumeTracingId))
    }
    for {
      dataSet <- DataSetDAO.findOne(_dataSet)
      dataSource <- dataSet.constructDataSource
      usableDataSource <- dataSource.toUsable ?~> "DataSet is not imported."
      tracingIds <- createTracings(dataSet, usableDataSource)
      teamId <- selectSuitableTeam(user, dataSet)
      annotation = Annotation(
        ObjectId.generate,
        _dataSet,
        None,
        teamId,
        user._id,
        tracingIds._1,
        tracingIds._2
      )
      _ <- AnnotationDAO.insertOne(annotation)
    } yield {
      annotation
    }
  }

  def finish(annotation: Annotation)(implicit ctx: DBAccessContext) = {
    // WARNING: needs to be repeatable, might be called multiple times for an annotation
    AnnotationDAO.updateState(annotation._id, AnnotationState.Finished)
  }

  def baseFor(taskId: ObjectId)(implicit ctx: DBAccessContext): Fox[Annotation] =
    (for {
      list <- AnnotationDAO.findAllByTaskIdAndType(taskId, AnnotationType.TracingBase)
    } yield list.headOption.toFox).flatten

  def annotationsFor(taskId: ObjectId)(implicit ctx: DBAccessContext) =
      AnnotationDAO.findAllByTaskIdAndType(taskId, AnnotationType.Task)

  def countActiveAnnotationsFor(taskId: ObjectId)(implicit ctx: DBAccessContext) =
    AnnotationDAO.countActiveByTask(taskId, AnnotationType.Task)

  def countOpenNonAdminTasks(user: User)(implicit ctx: DBAccessContext) =
    for {
      teamManagerTeamIds <- user.teamManagerTeamIds
      result <- AnnotationDAO.countActiveAnnotationsFor(user._id, AnnotationType.Task, teamManagerTeamIds)
    } yield result

  def tracingFromBase(annotationBase: Annotation, dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[String] = {
    for {
      dataSource <- bool2Fox(dataSet.isUsable) ?~> Messages("dataSet.notImported", dataSet.name)
      dataStoreHandler <- dataSet.dataStoreHandler
      skeletonTracingId <- annotationBase.skeletonTracingId.toFox
      newTracingId <- dataStoreHandler.duplicateSkeletonTracing(skeletonTracingId)
    } yield newTracingId
  }

  def createAnnotationFor(user: User, task: Task, initializingAnnotationId: ObjectId)(implicit messages: Messages, ctx: DBAccessContext): Fox[Annotation] = {
    def useAsTemplateAndInsert(annotation: Annotation) = {
      for {
        dataSetName <- DataSetDAO.getNameById(annotation._dataSet)(GlobalAccessContext) ?~> "dataSet.notFound"
        dataSet <- DataSetDAO.findOne(annotation._dataSet) ?~> ("Could not access DataSet " + dataSetName + ". Does your team have access?")
        newTracingId <- tracingFromBase(annotation, dataSet) ?~> "Failed to use annotation base as template."
        newAnnotation = annotation.copy(
          _id = initializingAnnotationId,
          _user = user._id,
          skeletonTracingId = Some(newTracingId),
          state = Active,
          typ = AnnotationType.Task,
          created = System.currentTimeMillis,
          modified = System.currentTimeMillis)
        _ <- AnnotationDAO.updateInitialized(newAnnotation)
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

  def abortInitializedAnnotationOnFailure(initializingAnnotationId: ObjectId, insertedAnnotationBox: Box[Annotation]) = {
    insertedAnnotationBox match {
      case Full(_) => Fox.successful(())
      case _ => AnnotationDAO.abortInitializingAnnotation(initializingAnnotationId)
    }
  }

  def createAnnotationBase(
                            taskFox: Fox[Task],
                            userId: ObjectId,
                            skeletonTracingIdBox: Box[String],
                            dataSetId: ObjectId,
                            description: Option[String]
    )(implicit ctx: DBAccessContext) = {

    for {
      task <- taskFox
      taskType <- task.taskType
      skeletonTracingId <- skeletonTracingIdBox.toFox
      project <- task.project
      annotationBase = Annotation(
        ObjectId.generate,
        dataSetId,
        Some(task._id),
        project._team,
        userId,
        Some(skeletonTracingId),
        None,
        description.getOrElse(""),
        typ = AnnotationType.TracingBase)
      _ <- AnnotationDAO.insertOne(annotationBase)
    } yield true
  }


  def createFrom(
                  user: User,
                  dataSet: DataSet,
                  skeletonTracingId: Option[String],
                  volumeTracingId: Option[String],
                  annotationType: AnnotationType,
                  name: Option[String],
                  description: String)(implicit messages: Messages, ctx: DBAccessContext): Fox[Annotation] = {
    for {
      teamId <- selectSuitableTeam(user, dataSet)
      annotation = Annotation(
        ObjectId.generate,
        dataSet._id,
        None,
        teamId,
        user._id,
        skeletonTracingId,
        volumeTracingId,
        description,
        name = name.getOrElse(""),
        typ = annotationType)
      _ <- AnnotationDAO.insertOne(annotation)
    } yield annotation
  }

  def zipAnnotations(annotations: List[Annotation], zipFileName: String)(implicit messages: Messages, ctx: DBAccessContext): Fox[TemporaryFile] = {
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

  private def getTracingsScalesAndNamesFor(annotations: List[Annotation])(implicit ctx: DBAccessContext): Fox[List[(List[SkeletonTracing], List[String], List[Option[Scale]], List[Annotation])]] = {

    def getTracings(dataSetId: ObjectId, tracingIds: List[String]) = {
      for {
        dataSet <- DataSetDAO.findOne(dataSetId)
        dataStoreHandler <- dataSet.dataStoreHandler
        tracingContainers <- Fox.serialCombined(tracingIds.grouped(1000).toList)(dataStoreHandler.getSkeletonTracings)
      } yield tracingContainers.flatMap(_.tracings)
    }

    def getDatasetScale(dataSetId: ObjectId) = {
      for {
        dataSet <- DataSetDAO.findOne(dataSetId)
      } yield dataSet.scale
    }

    def getNames(annotations: List[Annotation]) = Fox.combined(annotations.map(a => SavedTracingInformationHandler.nameForAnnotation(a).toFox))

    val annotationsGrouped: Map[ObjectId, List[Annotation]] = annotations.groupBy(_._dataSet)
    val tracings = annotationsGrouped.map {
      case (dataSetId, annotations) => {
        for {
          scale <- getDatasetScale(dataSetId)
          tracings <- getTracings(dataSetId, annotations.flatMap(_.skeletonTracingId))
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

  def transferAnnotationToUser(typ: String, id: String, userId: ObjectId)(implicit request: UserAwareRequest[_]) = {
    for {
      annotation <- provideAnnotation(typ, id)
      newUser <- UserDAO.findOne(userId) ?~> Messages("user.notFound")
      _ <- DataSetDAO.findOne(annotation._dataSet)(AuthorizedAccessContext(newUser)) ?~> Messages("annotation.transferee.noDataSetAccess")
      _ <- annotation.muta.transferToUser(newUser)
      updated <- provideAnnotation(typ, id)
    } yield updated
  }
}
