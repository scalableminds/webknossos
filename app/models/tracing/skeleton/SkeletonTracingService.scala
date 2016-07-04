/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.tracing.skeleton

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import models.annotation.CompoundAnnotation._
import models.annotation.{AnnotationContentService, AnnotationSettings}
import models.binary.DataSet
import models.task.Task
import models.tracing.CommonTracingService
import models.tracing.skeleton.temporary.{TemporarySkeletonTracing, TemporarySkeletonTracingService}
import models.user.{UsedAnnotationDAO, User}
import oxalis.nml.{NML, Tree, TreeLike}
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import play.api.libs.concurrent.Execution.Implicits._
import play.modules.reactivemongo.json.BSONFormats._
import reactivemongo.core.commands.LastError

object SkeletonTracingService extends AnnotationContentService with CommonTracingService {
  val dao = SkeletonTracingDAO

  type AType = SkeletonTracing

  def createFrom(
    dataSetName: String,
    start: Point3D,
    rotation: Vector3D,
    boundingBox: Option[BoundingBox],
    insertStartAsNode: Boolean,
    settings: AnnotationSettings = AnnotationSettings.skeletonDefault)
    (implicit ctx: DBAccessContext): Fox[SkeletonTracing] = {

    val trees =
      if (insertStartAsNode)
        List(Tree.createFrom(start, rotation))
      else
        Nil

    val box: Option[BoundingBox] = boundingBox.flatMap {
      box =>
        if (box.isEmpty)
          None
        else
          Some(box)
    }

    createFrom(
      TemporarySkeletonTracing(
        "",
        dataSetName,
        trees,
        Nil,
        System.currentTimeMillis(),
        if(insertStartAsNode) Some(1) else None,
        start,
        rotation,
        SkeletonTracing.defaultZoomLevel,
        box,
        Nil,
        settings))
  }

  def clearTracingData(tracingId: String)(implicit ctx: DBAccessContext) = {
    SkeletonTracingDAO.withValidId(tracingId) { _tracing =>
      for {
        _ <- DBTreeService.removeByTracing(_tracing)
        - <- SkeletonTracingDAO.resetBranchPoints(_tracing)
        - <- SkeletonTracingDAO.resetComments(_tracing)
        tracing <- SkeletonTracingDAO.findOneById(_tracing)
      } yield tracing
    }
  }

  def createFrom(tracingLike: SkeletonTracingLike)(implicit ctx: DBAccessContext): Fox[SkeletonTracing] = {
    val tracing = SkeletonTracing.from(tracingLike)
    for {
      _ <- SkeletonTracingDAO.insert(tracing)
      trees <- tracingLike.trees
      - <- Fox.sequence(trees.map(tree => DBTreeService.insert(tracing._id, tree)))
    } yield tracing
  }

  def createFrom(nmls: List[NML], boundingBox: Option[BoundingBox], settings: AnnotationSettings)(implicit ctx: DBAccessContext): Fox[SkeletonTracing] = {
    TemporarySkeletonTracingService.createFrom(nmls, boundingBox, settings).flatMap { temporary =>
      createFrom(temporary)
    }
  }

  def createFrom(nml: NML, boundingBox: Option[BoundingBox], settings: AnnotationSettings)(implicit ctx: DBAccessContext): Fox[SkeletonTracing] = {
    createFrom(List(nml), boundingBox, settings)
  }

  def createFrom(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[SkeletonTracing] =
    createFrom(dataSet.name, dataSet.defaultStart, dataSet.defaultRotation, None, insertStartAsNode = false)

  def removeById(_skeleton: BSONObjectID)(implicit ctx: DBAccessContext) =
    for {
      _ <- UsedAnnotationDAO.removeAll(_skeleton.stringify)
      _ <- DBTreeService.removeByTracing(_skeleton)
      _ <- SkeletonTracingDAO.removeById(_skeleton)
    } yield true


  def findOneById(tracingId: String)(implicit ctx: DBAccessContext) =
    SkeletonTracingDAO.findOneById(tracingId)

  def uniqueTreePrefix(tracing: SkeletonTracingLike, user: Option[User], task: Option[Task])(tree: TreeLike): String = {
    val userName = user.map(_.abreviatedName) getOrElse ""
    val taskName = task.map(_.id) getOrElse ""
    formatHash(taskName) + "_" + userName + "_" + "tree%03d".format(tree.treeId)
  }

  def renameTreesOfTracing(tracing: SkeletonTracing, user: Fox[User], task: Fox[Task])(implicit ctx: DBAccessContext): Fox[TemporarySkeletonTracing] = {
    for {
      t <- task.futureBox
      u <- user.futureBox
      temp <- tracing.toTemporary.futureBox
    } yield
      temp.map(_.renameTrees(uniqueTreePrefix(tracing, u, t)))
  }

  def saveToDB(skeleton: SkeletonTracing)(implicit ctx: DBAccessContext): Fox[SkeletonTracing] = {
    SkeletonTracingDAO.update(
      Json.obj("_id" -> skeleton._id),
      Json.obj(
        "$set" -> SkeletonTracingDAO.formatWithoutId(skeleton),
        "$unset" -> Json.obj("notUpdated" -> true),
        "$setOnInsert" -> Json.obj("_id" -> skeleton._id)
      ),
      upsert = true).map { _ =>
      skeleton
    }
  }

  def update(id: BSONObjectID, skeleton: SkeletonTracing)(implicit ctx: DBAccessContext): Fox[LastError] = {
    SkeletonTracingDAO.update(id, skeleton).map { r =>
      SkeletonTracingDAO.update(Json.obj("_id" -> id), Json.obj("$unset" -> Json.obj("notUpdated" -> true)))
      r
    }
  }
}
