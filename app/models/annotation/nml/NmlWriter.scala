/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.annotation.nml

import java.io.OutputStream
import javax.xml.stream.{XMLOutputFactory, XMLStreamWriter}

import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.util.geometry.Scale
import com.scalableminds.util.xml.Xml
import com.sun.xml.txw2.output.IndentingXMLStreamWriter
import models.annotation.{Annotation, AnnotationDAO}
import org.joda.time.DateTime
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator

object NmlWriter {
  private lazy val outputService = XMLOutputFactory.newInstance()

  def toNmlStream(tracing: Either[SkeletonTracing, VolumeTracing], annotation: Annotation, scale: Scale) = {
    Enumerator.outputStream {os => toNml(tracing, annotation, os, scale); os.close()}
  }

  def toNml(tracing: Either[SkeletonTracing, VolumeTracing], annotation: Annotation, outputStream: OutputStream, scale: Scale) = {
    implicit val writer = new IndentingXMLStreamWriter(outputService.createXMLStreamWriter(outputStream))

    tracing match {
      case Right(volumeTracing) =>
        Xml.withinElementSync("things") {
          writeMetaData(annotation)
          Xml.withinElementSync("parameters")(writeParametersAsXml(volumeTracing, annotation.description, scale))
          Xml.withinElementSync("volume") {
            writer.writeAttribute("id", "1")
            writer.writeAttribute("location", "data.zip")
          }
        }
        writer.writeEndDocument()
        writer.close()
      case Left(skeletonTracing) => {
        Xml.withinElementSync("things") {
          writeMetaData(annotation)
          Xml.withinElementSync("parameters")(writeParametersAsXml(skeletonTracing, annotation.description, scale))
          writeTreesAsXml(skeletonTracing.trees.filterNot(_.nodes.isEmpty))
          Xml.withinElementSync("branchpoints")(writeBranchPointsAsXml(skeletonTracing.trees.flatMap(_.branchPoints).sortBy(-_.createdTimestamp)))
          Xml.withinElementSync("comments")(writeCommentsAsXml(skeletonTracing.trees.flatMap(_.comments)))
        }
        writer.writeEndDocument()
        writer.close()
      }
    }
  }

  def writeParametersAsXml(tracing: SkeletonTracing, description: String, scale: Scale)(implicit writer: XMLStreamWriter) = {
    Xml.withinElementSync("experiment") {
      writer.writeAttribute("name", tracing.dataSetName)
      writer.writeAttribute("description", description)
    }
    Xml.withinElementSync("scale") {
      writer.writeAttribute("x", scale.x.toString)
      writer.writeAttribute("y", scale.y.toString)
      writer.writeAttribute("z", scale.z.toString)
    }
    Xml.withinElementSync("offset") {
      writer.writeAttribute("x", "0")
      writer.writeAttribute("y", "0")
      writer.writeAttribute("z", "0")
    }
    Xml.withinElementSync("time") {
      writer.writeAttribute("ms", tracing.createdTimestamp.toString)
    }
    Xml.withinElementSync("editPosition") {
      writer.writeAttribute("x", tracing.editPosition.x.toString)
      writer.writeAttribute("y", tracing.editPosition.y.toString)
      writer.writeAttribute("z", tracing.editPosition.z.toString)
    }
    Xml.withinElementSync("editRotation") {
      writer.writeAttribute("xRot", tracing.editRotation.x.toString)
      writer.writeAttribute("yRot", tracing.editRotation.y.toString)
      writer.writeAttribute("zRot", tracing.editRotation.z.toString)
    }
    Xml.withinElementSync("zoomLevel") {
      writer.writeAttribute("zoom", tracing.zoomLevel.toString)
    }
    tracing.activeNodeId.map { nodeId =>
      Xml.withinElementSync("activeNode") {
        writer.writeAttribute("id", nodeId.toString)
      }
    }
    tracing.userBoundingBox.map { b =>
      Xml.withinElementSync("userBoundingBox") {
        writer.writeAttribute("topLeftX", b.topLeft.x.toString)
        writer.writeAttribute("topLeftY", b.topLeft.y.toString)
        writer.writeAttribute("topLeftZ", b.topLeft.z.toString)
        writer.writeAttribute("width", b.width.toString)
        writer.writeAttribute("height", b.height.toString)
        writer.writeAttribute("depth", b.depth.toString)
      }
    }
  }

  def writeParametersAsXml(tracing: VolumeTracing, description: String, scale: Scale)(implicit writer: XMLStreamWriter) = {
    Xml.withinElementSync("experiment") {
      writer.writeAttribute("name", tracing.dataSetName)
      writer.writeAttribute("description", description)
    }
    Xml.withinElementSync("scale") {
      writer.writeAttribute("x", scale.x.toString)
      writer.writeAttribute("y", scale.y.toString)
      writer.writeAttribute("z", scale.z.toString)
    }
    Xml.withinElementSync("offset") {
      writer.writeAttribute("x", "0")
      writer.writeAttribute("y", "0")
      writer.writeAttribute("z", "0")
    }
    Xml.withinElementSync("time") {
      writer.writeAttribute("ms", tracing.createdTimestamp.toString)
    }
    Xml.withinElementSync("editPosition") {
      writer.writeAttribute("x", tracing.editPosition.x.toString)
      writer.writeAttribute("y", tracing.editPosition.y.toString)
      writer.writeAttribute("z", tracing.editPosition.z.toString)
    }
    Xml.withinElementSync("editRotation") {
      writer.writeAttribute("xRot", tracing.editRotation.x.toString)
      writer.writeAttribute("yRot", tracing.editRotation.y.toString)
      writer.writeAttribute("zRot", tracing.editRotation.z.toString)
    }
    Xml.withinElementSync("zoomLevel") {
      writer.writeAttribute("zoom", tracing.zoomLevel.toString)
    }
  }

  def writeTreesAsXml(trees: Seq[Tree])(implicit writer: XMLStreamWriter) = {
    trees.foreach { t =>
      Xml.withinElementSync("thing") {
        writer.writeAttribute("id", t.treeId.toString)
        writer.writeAttribute("color.r", t.color.map(_.r.toString).getOrElse(""))
        writer.writeAttribute("color.g", t.color.map(_.g.toString).getOrElse(""))
        writer.writeAttribute("color.b", t.color.map(_.b.toString).getOrElse(""))
        writer.writeAttribute("color.a", t.color.map(_.a.toString).getOrElse(""))
        writer.writeAttribute("name", t.name)
        Xml.withinElementSync("nodes")(writeNodesAsXml(t.nodes.sortBy(_.id)))
        Xml.withinElementSync("edges")(writeEdgesAsXml(t.edges))
      }
    }
  }

  def writeNodesAsXml(nodes: Seq[Node])(implicit writer: XMLStreamWriter) = {
    nodes.toSet.foreach { n: Node => //TODO 2017: once the tracings with duplicate nodes are fixed in the DB, remove the toSet workaround
      Xml.withinElementSync("node") {
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
        writer.writeAttribute("time", n.createdTimestamp.toString)
      }
    }
  }

  def writeEdgesAsXml(edges: Seq[Edge])(implicit writer: XMLStreamWriter) = {
    edges.foreach { e =>
      Xml.withinElementSync("edge") {
        writer.writeAttribute("source", e.source.toString)
        writer.writeAttribute("target", e.target.toString)
      }
    }
  }

  def writeBranchPointsAsXml(branchPoints: Seq[BranchPoint])(implicit writer: XMLStreamWriter) = {
    branchPoints.foreach { b =>
      Xml.withinElementSync("branchpoint") {
        writer.writeAttribute("id", b.nodeId.toString)
        writer.writeAttribute("time", b.createdTimestamp.toString)
      }
    }
  }

  def writeCommentsAsXml(comments: Seq[Comment])(implicit writer: XMLStreamWriter) = {
    comments.foreach { c =>
      Xml.withinElementSync("comment") {
        writer.writeAttribute("node", c.nodeId.toString)
        writer.writeAttribute("content", c.content)
      }
    }
  }

  def writeMetaData(annotation: Annotation)(implicit writer: XMLStreamWriter) = {
    val test =
    Xml.withinElementSync("meta") {
      writer.writeAttribute("name", "writer")
      writer.writeAttribute("content", "NmlWriter.scala")
    }
    Xml.withinElementSync("meta") {
      writer.writeAttribute("name", "writerGitCommit")
      writer.writeAttribute("content", webknossos.BuildInfo.commitHash)
    }
    Xml.withinElementSync("meta") {
      writer.writeAttribute("name", "timestamp")
      writer.writeAttribute("content", DateTime.now().getMillis.toString)
    }
    Xml.withinElementSync("meta") {
      writer.writeAttribute("name", "annotationId")
      writer.writeAttribute("content", annotation._id.stringify)
    }
    Xml.withinElementSync("meta") {
      writer.writeAttribute("name", "username")
      writer.writeAttribute("content", annotation._user.get.stringify)
    }
    Xml.withinElementSync("meta") {
      writer.writeAttribute("name", "taskId")
      writer.writeAttribute("content", annotation._task.get.stringify)
    }
    /*
 * <meta name="writer" content="nml_helpers.js" />␊
   <meta name="writerGitCommit" content="fc0ea6432ec7107e8f9b5b308ee0e90eae0e7b17" />
   <meta name="timestamp" content="123456789" />
                                   1517149384139
   <meta name="annotationId" content="5a5f6110410000ad00bf208f" />
   <meta name="username" content="SCM Boy" />
   <meta name="taskId" content="5a5f63474100001201bf2097" />
   <parameters>
 * */
  }
}
