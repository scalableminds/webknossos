/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.annotation.nml

import javax.xml.stream.{XMLOutputFactory, XMLStreamWriter}
import com.scalableminds.util.geometry.Scale
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.util.xml.Xml
import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.sun.xml.txw2.output.IndentingXMLStreamWriter
import models.annotation.AnnotationSQL
import net.liftweb.common.Full
import org.joda.time.DateTime
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator

import scala.concurrent.Future

object NmlWriter extends FoxImplicits {
  private lazy val outputService = XMLOutputFactory.newInstance()

  def toNmlStream(tracing: Either[SkeletonTracing, VolumeTracing], annotation: AnnotationSQL, scale: Option[Scale]) = Enumerator.outputStream { os =>
    implicit val writer = new IndentingXMLStreamWriter(outputService.createXMLStreamWriter(os))

    for {
      nml <- toNml(tracing, annotation, scale)
      _ = os.close
    } yield {
      nml
    }
  }

  def toNml(tracing: Either[SkeletonTracing, VolumeTracing], annotation: AnnotationSQL, scale: Option[Scale])(implicit writer: XMLStreamWriter): Fox[Unit] = {
    tracing match {
      case Right(volumeTracing) => {
        for {
          _ <- Xml.withinElement("things") { writeVolumeThings(annotation, volumeTracing, scale)}
          _ = writer.writeEndDocument()
          _ = writer.close()
        } yield ()
      }
      case Left(skeletonTracing) => {
        for {
          _ <- Xml.withinElement("things") { writeSkeletonThings(annotation, skeletonTracing, scale)}
          _ = writer.writeEndDocument()
          _ = writer.close()
        } yield ()
      }
    }
  }

  def writeVolumeThings(annotation: AnnotationSQL, volumeTracing: VolumeTracing, scale: Option[Scale])(implicit writer: XMLStreamWriter): Fox[Unit] = {
    for {
      _ <- writeMetaData(annotation)
      _ = Xml.withinElementSync("parameters")(writeParametersAsXml(volumeTracing, annotation.description, scale))
      _ = Xml.withinElementSync("volume") {
        writer.writeAttribute("id", "1")
        writer.writeAttribute("location", "data.zip")}
    } yield ()
  }

  def writeSkeletonThings(annotation: AnnotationSQL, skeletonTracing: SkeletonTracing, scale: Option[Scale])(implicit writer: XMLStreamWriter): Fox[Unit] = {
    for {
      _ <- writeMetaData(annotation)
      _ = Xml.withinElementSync("parameters")(writeParametersAsXml(skeletonTracing, annotation.description, scale))
      _ = writeTreesAsXml(skeletonTracing.trees.filterNot(_.nodes.isEmpty))
      _ = Xml.withinElementSync("branchpoints")(writeBranchPointsAsXml(skeletonTracing.trees.flatMap(_.branchPoints).sortBy(-_.createdTimestamp)))
      _ = Xml.withinElementSync("comments")(writeCommentsAsXml(skeletonTracing.trees.flatMap(_.comments)))
      _ = Xml.withinElementSync("groups")(writeTreeGroupsAsXml(skeletonTracing.treeGroups))
    } yield ()
  }

  def writeParametersAsXml(tracing: SkeletonTracing, description: String, scale: Option[Scale])(implicit writer: XMLStreamWriter) = {
    Xml.withinElementSync("experiment") {
      writer.writeAttribute("name", tracing.dataSetName)
      writer.writeAttribute("description", description)
    }
    Xml.withinElementSync("scale") {
      writer.writeAttribute("x", scale.map(_.x).getOrElse(-1).toString)
      writer.writeAttribute("y", scale.map(_.y).getOrElse(-1).toString)
      writer.writeAttribute("z", scale.map(_.z).getOrElse(-1).toString)
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

  def writeParametersAsXml(tracing: VolumeTracing, description: String, scale: Option[Scale])(implicit writer: XMLStreamWriter) = {
    Xml.withinElementSync("experiment") {
      writer.writeAttribute("name", tracing.dataSetName)
      writer.writeAttribute("description", description)
    }
    Xml.withinElementSync("scale") {
      writer.writeAttribute("x", scale.map(_.x).getOrElse(-1).toString)
      writer.writeAttribute("y", scale.map(_.y).getOrElse(-1).toString)
      writer.writeAttribute("z", scale.map(_.z).getOrElse(-1).toString)
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
        t.groupId.map(groupId => writer.writeAttribute("groupId", groupId.toString))
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

  def writeTreeGroupsAsXml(treeGroups: Seq[TreeGroup])(implicit writer: XMLStreamWriter): Unit = {
    treeGroups.foreach { t =>
      Xml.withinElementSync("group") {
        writer.writeAttribute("name", t.name)
        writer.writeAttribute("id", t.groupId.toString)
        writeTreeGroupsAsXml(t.children)
      }
    }
  }

  def writeMetaData(annotation: AnnotationSQL)(implicit writer: XMLStreamWriter): Fox[Unit] = {
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
      writer.writeAttribute("content", annotation.id)
    }
    for {
      _ <- writeUser(annotation)
      _ <- writeTask(annotation)
    } yield ()
  }

  def writeUser(annotation: AnnotationSQL)(implicit writer: XMLStreamWriter): Future[Unit] = {
    for {
      userBox <- annotation.user.futureBox
    } yield {
      userBox match {
        case Full(user) => Xml.withinElementSync("meta") {
          writer.writeAttribute("name", "username")
          writer.writeAttribute("content", user.name)
        }
        case _ => ()
      }
    }
  }

  def writeTask(annotation: AnnotationSQL)(implicit writer: XMLStreamWriter): Future[Unit] = {
    for {
      taskBox <- annotation.task.futureBox
    } yield {
      taskBox match {
        case Full(task) => Xml.withinElementSync("meta") {
          writer.writeAttribute("name", "taskId")
          writer.writeAttribute("content", task.id)
        }
        case _ => ()
      }
    }
  }
}
