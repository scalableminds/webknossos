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
import oxalis.nml._
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json._
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.api.commands.WriteResult
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
    isFirstBranchPoint: Boolean,
    settings: AnnotationSettings = AnnotationSettings.skeletonDefault)
    (implicit ctx: DBAccessContext): Fox[SkeletonTracing] = {

    val trees =
      if (insertStartAsNode) {
        val node = Node(1, start, rotation)
        val branchPoints = if (isFirstBranchPoint) List(BranchPoint(node.id, System.currentTimeMillis)) else Nil
        List(Tree.createFrom(node).copy(branchPoints = branchPoints))
      } else
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
        System.currentTimeMillis(),
        if(insertStartAsNode) Some(1) else None,
        start,
        rotation,
        SkeletonTracing.defaultZoomLevel,
        box,
        settings))
  }

  def createFrom(tracingLike: SkeletonTracingLike)(implicit ctx: DBAccessContext): Fox[SkeletonTracing] = {
    val tracing = SkeletonTracing.from(tracingLike)
    for {
      _ <- SkeletonTracingDAO.insert(tracing)
      trees <- tracingLike.trees
      _ <- Fox.serialSequence(trees)(tree => DBTreeService.insert(tracing._id, tree))
    } yield tracing
  }

  def createFrom(nmls: List[NML], boundingBox: Option[BoundingBox], settings: AnnotationSettings)(implicit ctx: DBAccessContext): Fox[SkeletonTracing] = {
    TemporarySkeletonTracingService.createFrom(nmls, boundingBox, Some(settings)).flatMap { temporary =>
      createFrom(temporary)
    }
  }

  def createFrom(nml: NML, boundingBox: Option[BoundingBox], settings: AnnotationSettings)(implicit ctx: DBAccessContext): Fox[SkeletonTracing] = {
    createFrom(List(nml), boundingBox, settings)
  }

  def createFrom(dataSet: DataSet, withFallback: Boolean)(implicit ctx: DBAccessContext): Fox[SkeletonTracing] =
    createFrom(
      dataSet.name,
      dataSet.defaultStart,
      dataSet.defaultRotation,
      None,
      insertStartAsNode = false,
      isFirstBranchPoint = false)

  def clearAndRemove(skeletonId: String)(implicit ctx: DBAccessContext) =
    SkeletonTracingDAO.withValidId(skeletonId) { _id =>
      for {
        _ <- DBTreeService.removeByTracing(_id)
        _ <- SkeletonTracingDAO.removeById(_id)
      } yield true
    }

  def findOneById(tracingId: String)(implicit ctx: DBAccessContext) =
    SkeletonTracingDAO.findOneById(tracingId)

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

  def update(id: BSONObjectID, skeleton: SkeletonTracing)(implicit ctx: DBAccessContext): Fox[WriteResult] = {
    SkeletonTracingDAO.update(id, skeleton).map { r =>
      SkeletonTracingDAO.update(Json.obj("_id" -> id), Json.obj("$unset" -> Json.obj("notUpdated" -> true)))
      r
    }
  }
}
