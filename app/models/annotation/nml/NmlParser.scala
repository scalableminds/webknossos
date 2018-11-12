package models.annotation.nml

import java.io.InputStream

import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.tracingstore.SkeletonTracing._
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.tracings.ProtoGeometryImplicits
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.{
  NodeDefaults,
  SkeletonTracingDefaults,
  TreeValidator
}
import com.scalableminds.webknossos.tracingstore.tracings.volume.Volume
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale, Vector3D}
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box._
import net.liftweb.common.{Box, Empty, Failure, Full}

import scala.xml.{NodeSeq, XML, Node => XMLNode}

object NmlParser extends LazyLogging with ProtoGeometryImplicits {

  val DEFAULT_TIME = 0L

  val DEFAULT_ACTIVE_NODE_ID = 1

  val DEFAULT_COLOR = Color(1, 0, 0, 0)

  val DEFAULT_VIEWPORT = 0

  val DEFAULT_RESOLUTION = 0

  val DEFAULT_BITDEPTH = 0

  val DEFAULT_INTERPOLATION = false

  val DEFAULT_TIMESTAMP = 0L

  @SuppressWarnings(Array("TraversableHead")) //We check if volumes are empty before accessing the head
  def parse(name: String,
            nmlInputStream: InputStream): Box[(Option[SkeletonTracing], Option[(VolumeTracing, String)], String)] =
    try {
      val data = XML.load(nmlInputStream)
      for {
        parameters <- (data \ "parameters").headOption ?~ "No parameters section found"
        scale <- parseScale(parameters \ "scale") ?~ "Couldn't parse scale"
        time = parseTime(parameters \ "time")
        comments = parseComments(data \ "comments")
        branchPoints = parseBranchPoints(data \ "branchpoints", time)
        trees <- extractTrees(data \ "thing", branchPoints, comments)
        treeGroups = extractTreeGroups(data \ "groups")
        volumes = extractVolumes(data \ "volume")
        _ <- TreeValidator.checkNoDuplicateTreeGroupIds(treeGroups)
        _ <- TreeValidator.checkAllTreeGroupIdsUsedExist(trees, treeGroups)
        _ <- TreeValidator.checkAllNodesUsedInBranchPointsExist(trees, branchPoints)
        _ <- TreeValidator.checkAllNodesUsedInCommentsExist(trees, comments)
      } yield {
        val dataSetName = parseDataSetName(parameters \ "experiment")
        val description = parseDescription(parameters \ "experiment")
        val activeNodeId = parseActiveNode(parameters \ "activeNode")
        val editPosition =
          parseEditPosition(parameters \ "editPosition").getOrElse(SkeletonTracingDefaults.editPosition)
        val editRotation =
          parseEditRotation(parameters \ "editRotation").getOrElse(SkeletonTracingDefaults.editRotation)
        val zoomLevel = parseZoomLevel(parameters \ "zoomLevel").getOrElse(SkeletonTracingDefaults.zoomLevel)
        val userBoundingBox = parseBoundingBox(parameters \ "userBoundingBox")
        val taskBoundingBox = parseBoundingBox(parameters \ "taskBoundingBox")

        logger.debug(s"Parsed NML file. Trees: ${trees.size}, Volumes: ${volumes.size}")

        val volumeTracingWithDataLocation =
          if (volumes.isEmpty) None
          else
            Some(
              (VolumeTracing(None,
                             BoundingBox.empty,
                             time,
                             dataSetName,
                             editPosition,
                             editRotation,
                             ElementClass.uint32,
                             volumes.head.fallbackLayer,
                             0,
                             0,
                             zoomLevel),
               volumes.head.location)
            )

        val skeletonTracing =
          if (trees.isEmpty) None
          else
            Some(
              SkeletonTracing(dataSetName,
                              trees,
                              time,
                              taskBoundingBox,
                              activeNodeId,
                              editPosition,
                              editRotation,
                              zoomLevel,
                              version = 0,
                              userBoundingBox,
                              treeGroups)
            )

        (skeletonTracing, volumeTracingWithDataLocation, description)
      }
    } catch {
      case e: org.xml.sax.SAXParseException if e.getMessage.startsWith("Premature end of file") =>
        logger.debug(s"Tried  to parse empty NML file $name.")
        Empty
      case e: org.xml.sax.SAXParseException =>
        logger.debug(s"Failed to parse NML $name due to " + e)
        Failure(
          s"Failed to parse NML '$name'. Error in Line ${e.getLineNumber} " +
            s"(column ${e.getColumnNumber}): ${e.getMessage}")
      case e: Exception =>
        logger.error(s"Failed to parse NML $name due to " + e)
        Failure(s"Failed to parse NML '$name': " + e.toString)
    }

  def extractTrees(treeNodes: NodeSeq, branchPoints: Seq[BranchPoint], comments: Seq[Comment]): Box[Seq[Tree]] = {
    val trees = parseTrees(treeNodes, branchPoints, comments)
    TreeValidator.validateTrees(trees).map(_ => trees)
  }

  def extractTreeGroups(treeGroupContainerNodes: NodeSeq): Seq[TreeGroup] = {
    val treeGroupNodes = treeGroupContainerNodes.flatMap(_ \ "group")
    treeGroupNodes.map(parseTreeGroup)
  }

  def parseTreeGroup(node: XMLNode): TreeGroup = {
    val name = (node \ "@name").text
    val id = (node \ "@id").text.toInt
    val children = (node \ "group").map(parseTreeGroup)
    TreeGroup(name, id, children)
  }

  def extractVolumes(volumeNodes: NodeSeq) =
    volumeNodes.map(node => Volume((node \ "@location").text, (node \ "@fallbackLayer").map(_.text).headOption))

  private def parseTrees(treeNodes: NodeSeq, branchPoints: Seq[BranchPoint], comments: Seq[Comment]) =
    treeNodes.flatMap(treeNode => parseTree(treeNode, branchPoints, comments))

  private def parseBoundingBox(node: NodeSeq) =
    node.headOption.flatMap(bb =>
      for {
        topLeftX <- (node \ "@topLeftX").text.toIntOpt
        topLeftY <- (node \ "@topLeftY").text.toIntOpt
        topLeftZ <- (node \ "@topLeftZ").text.toIntOpt
        width <- (node \ "@width").text.toIntOpt
        height <- (node \ "@height").text.toIntOpt
        depth <- (node \ "@depth").text.toIntOpt
      } yield BoundingBox(Point3D(topLeftX, topLeftY, topLeftZ), width, height, depth))

  private def parseDataSetName(node: NodeSeq) =
    (node \ "@name").text

  private def parseDescription(node: NodeSeq) =
    (node \ "@description").text

  private def parseActiveNode(node: NodeSeq) =
    (node \ "@id").text.toIntOpt

  private def parseTime(node: NodeSeq) =
    (node \ "@ms").text.toLongOpt.getOrElse(DEFAULT_TIME)

  private def parseEditPosition(node: NodeSeq) =
    node.headOption.flatMap(parsePoint3D)

  private def parseEditRotation(node: NodeSeq) =
    node.headOption.flatMap(parseRotationForParams)

  private def parseZoomLevel(node: NodeSeq) =
    (node \ "@zoom").text.toDoubleOpt

  private def parseBranchPoints(branchPoints: NodeSeq, defaultTimestamp: Long) =
    (branchPoints \ "branchpoint").zipWithIndex.flatMap {
      case (branchPoint, index) =>
        (branchPoint \ "@id").text.toIntOpt.map { nodeId =>
          val parsedTimestamp = (branchPoint \ "@time").text.toLongOpt
          val timestamp = parsedTimestamp.getOrElse(defaultTimestamp - index)
          BranchPoint(nodeId, timestamp)
        }
    }

  private def parsePoint3D(node: XMLNode) =
    for {
      x <- (node \ "@x").text.toIntOpt
      y <- (node \ "@y").text.toIntOpt
      z <- (node \ "@z").text.toIntOpt
    } yield Point3D(x, y, z)

  private def parseRotationForParams(node: XMLNode) =
    for {
      rotX <- (node \ "@xRot").text.toDoubleOpt
      rotY <- (node \ "@yRot").text.toDoubleOpt
      rotZ <- (node \ "@zRot").text.toDoubleOpt
    } yield Vector3D(rotX, rotY, rotZ)

  private def parseRotationForNode(node: XMLNode) =
    for {
      rotX <- (node \ "@rotX").text.toDoubleOpt
      rotY <- (node \ "@rotY").text.toDoubleOpt
      rotZ <- (node \ "@rotZ").text.toDoubleOpt
    } yield Vector3D(rotX, rotY, rotZ)

  private def parseScale(nodes: NodeSeq) =
    nodes.headOption.flatMap(node =>
      for {
        x <- (node \ "@x").text.toFloatOpt
        y <- (node \ "@y").text.toFloatOpt
        z <- (node \ "@z").text.toFloatOpt
      } yield Scale(x, y, z))

  private def parseColorOpt(node: XMLNode) =
    for {
      colorRed <- (node \ "@color.r").text.toFloatOpt
      colorBlue <- (node \ "@color.g").text.toFloatOpt
      colorGreen <- (node \ "@color.b").text.toFloatOpt
      colorAlpha <- (node \ "@color.a").text.toFloatOpt
    } yield {
      Color(colorRed, colorBlue, colorGreen, colorAlpha)
    }

  private def parseColor(node: XMLNode) =
    parseColorOpt(node)

  private def parseName(node: XMLNode) =
    (node \ "@name").text

  private def parseGroupId(node: XMLNode) =
    (node \ "@groupId").text.toIntOpt

  private def parseTree(tree: XMLNode, branchPoints: Seq[BranchPoint], comments: Seq[Comment]): Option[Tree] =
    (tree \ "@id").text.toIntOpt.flatMap { id =>
      val color = parseColor(tree)
      val name = parseName(tree)
      val groupId = parseGroupId(tree)
      logger.trace("Parsing tree Id: %d".format(id))
      (tree \ "nodes" \ "node").flatMap(parseNode) match {
        case parsedNodes if parsedNodes.nonEmpty =>
          val edges = (tree \ "edges" \ "edge").flatMap(parseEdge)
          val nodes = parsedNodes
          val nodeIds = nodes.map(_.id)
          val treeBP = branchPoints.filter(bp => nodeIds.contains(bp.nodeId)).toList
          val treeComments = comments.filter(bp => nodeIds.contains(bp.nodeId)).toList
          val createdTimestamp =
            if (nodes.isEmpty) System.currentTimeMillis() else parsedNodes.minBy(_.createdTimestamp).createdTimestamp
          Some(Tree(id, nodes, edges, color, treeBP, treeComments, name, createdTimestamp, groupId))
        case _ =>
          None
      }
    }

  private def parseComments(comments: NodeSeq) =
    for {
      comment <- comments \ "comment"
      nodeId <- (comment \ "@node").text.toIntOpt
    } yield {
      val content = (comment \ "@content").text
      Comment(nodeId, content)
    }

  private def parseEdge(edge: XMLNode) =
    for {
      source <- (edge \ "@source").text.toIntOpt
      target <- (edge \ "@target").text.toIntOpt
    } yield {
      Edge(source, target)
    }

  private def parseViewport(node: NodeSeq) =
    (node \ "@inVp").text.toIntOpt.getOrElse(DEFAULT_VIEWPORT)

  private def parseResolution(node: NodeSeq) =
    (node \ "@inMag").text.toIntOpt.getOrElse(DEFAULT_RESOLUTION)

  private def parseBitDepth(node: NodeSeq) =
    (node \ "@bitDepth").text.toIntOpt.getOrElse(DEFAULT_BITDEPTH)

  private def parseInterpolation(node: NodeSeq) =
    (node \ "@interpolation").text.toBooleanOpt.getOrElse(DEFAULT_INTERPOLATION)

  private def parseTimestamp(node: NodeSeq) =
    (node \ "@time").text.toLongOpt.getOrElse(DEFAULT_TIMESTAMP)

  private def parseNode(node: XMLNode) =
    for {
      id <- (node \ "@id").text.toIntOpt
      radius <- (node \ "@radius").text.toFloatOpt
      position <- parsePoint3D(node)
    } yield {
      val viewport = parseViewport(node)
      val resolution = parseResolution(node)
      val timestamp = parseTimestamp(node)
      val bitDepth = parseBitDepth(node)
      val interpolation = parseInterpolation(node)
      val rotation = parseRotationForNode(node).getOrElse(NodeDefaults.rotation)
      Node(id, position, rotation, radius, viewport, resolution, bitDepth, interpolation, timestamp)
    }

}
