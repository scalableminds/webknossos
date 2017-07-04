package com.scalableminds.braingames.datastore.tracings.skeleton

import java.io.OutputStream
import javax.xml.stream.XMLOutputFactory

import com.scalableminds.util.tools.Fox
import com.scalableminds.util.xml.{XMLWrites, Xml}
import com.sun.xml.txw2.output.IndentingXMLStreamWriter
import net.liftweb.common.Box
import play.api.libs.concurrent.Execution.Implicits._

import scala.concurrent.Future

/**
  * Created by f on 04.07.17.
  */
object NMLWriter {
  private lazy val outputService = XMLOutputFactory.newInstance()

  def toNML[T](t: T, outputStream: OutputStream)(implicit w: XMLWrites[T]): Future[Box[Boolean]] = {
    val writer = new IndentingXMLStreamWriter(outputService.createXMLStreamWriter(outputStream))
    Xml.toXML(t)(writer, w).futureBox.map{ result =>
      // Make sure all tags are properly closed
      writer.writeEndDocument()
      writer.close()
      result
    }
  }
}
