package com.scalableminds.braingames.datastore.tracings.skeleton.elements

import com.scalableminds.util.geometry.{Point3D, Vector3D}
import play.api.libs.json.Json

/**
  * Created by f on 15.06.17.
  */
case class Node(
                 id: Int,
                 position: Point3D,
                 rotation: Vector3D = Node.defaultRotation,
                 radius: Float = Node.defaultRadius,
                 viewport: Int = Node.defaultViewport,
                 resolution: Int = Node.defaultResolution,
                 bitDepth: Int = Node.defaultBitDepth,
                 interpolation: Boolean = Node.defaultInterpolation,
                 timestamp: Long = System.currentTimeMillis)


object Node {

  val defaultRotation = Vector3D(0, 0, 0)
  val defaultRadius = 120
  val defaultViewport = 1
  val defaultResolution = 1
  val defaultBitDepth = 0
  val defaultInterpolation = false

  def fromOptions(id: Int, position: Point3D, rotation: Option[Vector3D], radius: Option[Float],
                  viewport: Option[Int], resolution: Option[Int], bitDepth: Option[Int],
                  interpolation: Option[Boolean]) = {
    Node(
      id,
      position,
      rotation getOrElse defaultRotation,
      radius getOrElse defaultRadius,
      viewport getOrElse defaultViewport,
      resolution getOrElse defaultResolution,
      bitDepth getOrElse defaultBitDepth,
      interpolation getOrElse defaultInterpolation
    )
  }

  implicit val jsonFormat = Json.format[Node]
}

