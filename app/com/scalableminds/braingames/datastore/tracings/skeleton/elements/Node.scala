/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.skeleton.elements

import javax.xml.stream.XMLStreamWriter

import com.scalableminds.util.geometry.{Point3D, Vector3D}
import com.scalableminds.util.xml.SynchronousXMLWrites
import play.api.libs.json.Json

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

  implicit object NodeXMLWrites extends SynchronousXMLWrites[Node] {
    def synchronousWrites(n: Node)(implicit writer: XMLStreamWriter): Boolean = {
      writer.writeStartElement("node")
      writer.writeAttribute("id", n.id.toString)
      writer.writeAttribute("radius", n.radius.toString)
      writer.writeAttribute("x", n.position.x.toString)
      writer.writeAttribute("y", n.position.y.toString)
      writer.writeAttribute("z", n.position.z.toString)
      writer.writeAttribute("rotX", n.rotation.x.toString)
      writer.writeAttribute("rotY", n.rotation.y.toString)
      writer.writeAttribute("rotZ", n.rotation.z.toString)
      writer.writeAttribute("inVp", n.viewport.toString)
      writer.writeAttribute("inMag", n.resolution.toString)
      writer.writeAttribute("bitDepth", n.bitDepth.toString)
      writer.writeAttribute("interpolation", n.interpolation.toString)
      writer.writeAttribute("time", n.timestamp.toString)
      writer.writeEndElement()
      true
    }
  }
}

