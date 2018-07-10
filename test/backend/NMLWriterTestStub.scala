package backend

import javax.xml.stream.{XMLOutputFactory, XMLStreamWriter}

import com.scalableminds.util.geometry.Scale
import com.scalableminds.util.xml.Xml
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.sun.xml.txw2.output.IndentingXMLStreamWriter
import models.annotation.nml.NmlWriter._
import play.api.libs.iteratee.Enumerator
import scala.concurrent.ExecutionContext.Implicits.global

object NMLWriterTestStub {
  private lazy val outputService = XMLOutputFactory.newInstance()

  def toNmlStream(tracing: SkeletonTracing, scale: Option[Scale]) = Enumerator.outputStream { os =>
    implicit val writer = new IndentingXMLStreamWriter(outputService.createXMLStreamWriter(os))

      val nml = Xml.withinElementSync("things") { writeTestSkeletonThings(tracing, scale)}
      writer.writeEndDocument()
      writer.close()
      os.close
    nml
  }

  def writeTestSkeletonThings(tracing: SkeletonTracing, maybeScale: Option[Scale])(implicit writer: XMLStreamWriter): Unit = {
      Xml.withinElementSync("parameters")(writeParametersAsXml(tracing, "", maybeScale))
      writeTreesAsXml(tracing.trees.filterNot(_.nodes.isEmpty))
      Xml.withinElementSync("branchpoints")(writeBranchPointsAsXml(tracing.trees.flatMap(_.branchPoints).sortBy(-_.createdTimestamp)))
      Xml.withinElementSync("comments")(writeCommentsAsXml(tracing.trees.flatMap(_.comments)))
      Xml.withinElementSync("groups")(writeTreeGroupsAsXml(tracing.treeGroups))
  }
}
