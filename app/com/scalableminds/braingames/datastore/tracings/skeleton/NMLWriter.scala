package com.scalableminds.braingames.datastore.tracings.skeleton

import java.io.OutputStream
import javax.xml.stream.{XMLOutputFactory, XMLStreamWriter}
import com.scalableminds.braingames.datastore.tracings.skeleton.elements.SkeletonTracing
import com.scalableminds.util.geometry.Scale
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.xml.Xml
import com.sun.xml.txw2.output.IndentingXMLStreamWriter
import net.liftweb.common.Box
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future

/**
  * Created by f on 04.07.17.
  */
object NMLWriter {
  private lazy val outputService = XMLOutputFactory.newInstance()

  def toNML(t: SkeletonTracing, outputStream: OutputStream, scale: Scale): Future[Box[Boolean]] = {
    implicit val writer = new IndentingXMLStreamWriter(outputService.createXMLStreamWriter(outputStream))

    Xml.withinElement("things") {
      for {
        _ <- Xml.withinElement("parameters")(writeParametersAsXML(t, scale, writer))
        _ <- Xml.toXML(t.trees.filterNot(_.nodes.isEmpty))
        _ <- Xml.withinElement("branchpoints")(Xml.toXML(t.trees.flatMap(_.branchPoints).sortBy(-_.timestamp)))
        _ <- Xml.withinElement("comments")(Xml.toXML(t.trees.flatMap(_.comments)))
      } yield true
    }.futureBox.map { result =>
      writer.writeEndDocument()
      writer.close()
      result
    }
  }

  def writeParametersAsXML(tracing: SkeletonTracing, scale: Scale, writer: XMLStreamWriter): Fox[Boolean] = {
    writer.writeStartElement("experiment")
    writer.writeAttribute("name", tracing.dataSetName)
    writer.writeEndElement()
    writer.writeStartElement("scale")
    writer.writeAttribute("x", scale.x.toString)
    writer.writeAttribute("y", scale.y.toString)
    writer.writeAttribute("z", scale.z.toString)
    writer.writeEndElement()
    writer.writeStartElement("offset")
    writer.writeAttribute("x", "0")
    writer.writeAttribute("y", "0")
    writer.writeAttribute("z", "0")
    writer.writeEndElement()
    writer.writeStartElement("time")
    writer.writeAttribute("ms", tracing.timestamp.toString)
    writer.writeEndElement()
    for {
      editPosition <- tracing.editPosition
    } yield {
      writer.writeStartElement("editPosition")
      writer.writeAttribute("x", editPosition.x.toString)
      writer.writeAttribute("y", editPosition.y.toString)
      writer.writeAttribute("z", editPosition.z.toString)
      writer.writeEndElement()
    }
    for {
      editRotation <- tracing.editRotation
    } yield {
      writer.writeStartElement("editRotation")
      writer.writeAttribute("xRot", editRotation.x.toString)
      writer.writeAttribute("yRot", editRotation.y.toString)
      writer.writeAttribute("zRot", editRotation.z.toString)
      writer.writeEndElement()
    }
    for {
      zoomLevel <- tracing.zoomLevel
    } yield {
      writer.writeStartElement("zoomLevel")
      writer.writeAttribute("zoom", zoomLevel.toString)
      writer.writeEndElement()
    }
    Fox.successful(true)
  }
}