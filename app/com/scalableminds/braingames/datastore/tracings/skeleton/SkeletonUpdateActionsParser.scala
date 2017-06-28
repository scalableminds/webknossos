package com.scalableminds.braingames.datastore.tracings.skeleton

import com.scalableminds.braingames.datastore.tracings.skeleton.elements._
import play.api.libs.json._

/**
  * Created by f on 28.06.17.
  */
object SkeletonUpdateActionsParser {

  def parseList(json: Option[JsValue]): List[SkeletonUpdateAction] = {
    json match {
      case Some(JsArray(jsonUpdates: List[JsValue])) if jsonUpdates.length >= 1 =>
        jsonUpdates.map(updateActionFromJson)
      case t => throw new IllegalArgumentException("Invalid UpdateActions JSON")
    }
  }

  def updateActionFromJson(json: JsValue): SkeletonUpdateAction = {
    val jsonValue = (json \ "value").as[JsObject]
    (json \ "action").as[String] match {
      case "createTree" => deserialize[CreateTreeSkeletonAction](jsonValue)
      case "deleteTree" => deserialize[DeleteTreeSkeletonAction](jsonValue)
      case "updateTree" => deserialize[UpdateTreeSkeletonAction](jsonValue)
      case "mergeTree" => deserialize[MergeTreeSkeletonAction](jsonValue)
      case "moveTreeComponent" => deserialize[MoveTreeComponentSkeletonAction](jsonValue)
      case "createNode" => deserialize[CreateNodeSkeletonAction](jsonValue, shouldTransformPositions = true)
      case "deleteNode" => deserialize[DeleteNodeSkeletonAction](jsonValue)
      case "updateNode" => deserialize[UpdateNodeSkeletonAction](jsonValue, shouldTransformPositions = true)
      case "createEdge" => deserialize[CreateEdgeSkeletonAction](jsonValue)
      case "deleteEdge" => deserialize[DeleteEdgeSkeletonAction](jsonValue)
      case "updateTracing" => deserialize[UpdateTracingSkeletonAction](jsonValue)
    }
  }

  def deserialize[T](json: JsValue, shouldTransformPositions: Boolean = false)(implicit tjs: Reads[T]) = {
    if (shouldTransformPositions)
      unpackJsResult(json.transform(positionTransform).get.validate[T])
    else
      unpackJsResult(json.validate[T])
  }

  def unpackJsResult[T](jsResult: JsResult[T]): T = jsResult match {
    case s: JsSuccess[T] => s.get
    case e: JsError => throw new IllegalArgumentException("Could not deserialize update action: " +
      JsError.toJson(e).toString())
  }

  private val positionTransform = (JsPath \ 'position).json.update(
    JsPath.read[List[Float]].map(position => Json.toJson(position.map(_.toInt))))
}
