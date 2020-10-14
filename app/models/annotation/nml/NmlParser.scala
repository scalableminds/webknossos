package models.annotation.nml

import java.io.InputStream

import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.tracingstore.SkeletonTracing._
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.geometry.{Color, NamedBoundingBox}
import com.scalableminds.webknossos.tracingstore.tracings.{ColorGenerator, ProtoGeometryImplicits}
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.{MultiComponentTreeSplitter, NodeDefaults, SkeletonTracingDefaults, TreeValidator}
import com.scalableminds.webknossos.tracingstore.tracings.volume.Volume
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale, Vector3D}
import com.scalableminds.util.tools.ExtendedTypes.{ExtendedDouble, ExtendedString}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box._
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.i18n.{Messages, MessagesProvider}

import scala.collection.mutable
import scala.xml.{NodeSeq, XML, Node => XMLNode}

object NmlParser extends LazyLogging with ProtoGeometryImplicits with ColorGenerator {

  val DEFAULT_TIME = 0L

  val DEFAULT_ACTIVE_NODE_ID = 1

  val DEFAULT_COLOR = Color(1, 0, 0, 0)

  val DEFAULT_VIEWPORT = 0

  val DEFAULT_RESOLUTION = 0

  val DEFAULT_BITDEPTH = 0

  val DEFAULT_INTERPOLATION = false

  val DEFAULT_TIMESTAMP = 0L

  def time[R](silent: Boolean, label: String)(block: => R): R = {
    val t0 = System.nanoTime()
    val result = block    // call-by-name
    val t1 = System.nanoTime()
    val duration = (t1 - t0)/1000000
    if (!silent && t1 - t0 > 5000000) {println(f"$duration ms " + label)}
    result
  }

  @SuppressWarnings(Array("TraversableHead")) //We check if volumes are empty before accessing the head
  def parse(name: String, nmlInputStream: InputStream, overwritingDataSetName: Option[String], isTaskUpload: Boolean)(
      implicit m: MessagesProvider)
    : Box[(Option[SkeletonTracing], Option[(VolumeTracing, String)], String, Option[String])] =
    try {
      val data = time(silent=false, "load xml from input stream")(XML.load(nmlInputStream))
      for {
        parameters <- (data \ "parameters").headOption ?~ Messages("nml.parameters.notFound")
        scale <- parseScale(parameters \ "scale") ?~ Messages("nml.scale.invalid")
        timestamp = parseTime(parameters \ "time")
        comments <- parseComments(data \ "comments")
        branchPoints <- parseBranchPoints(data \ "branchpoints", timestamp)
        trees <- time(silent=false, "parse trees")(parseTrees(data \ "thing", buildBranchPointMap(branchPoints), buildCommentMap(comments)))
        treeGroups <- extractTreeGroups(data \ "groups")
        volumes = extractVolumes(data \ "volume")
        treesAndGroupsAfterSplitting = time(silent=false, "splitMultiComponentTrees")(MultiComponentTreeSplitter.splitMulticomponentTrees(trees, treeGroups))
        treesSplit = treesAndGroupsAfterSplitting._1
        treeGroupsAfterSplit = treesAndGroupsAfterSplitting._2
        _ <- time(silent=false, "validateTrees")(TreeValidator.validateTrees(treesSplit, treeGroupsAfterSplit, branchPoints, comments))
      } yield {
        val dataSetName = overwritingDataSetName.getOrElse(parseDataSetName(parameters \ "experiment"))
        val description = parseDescription(parameters \ "experiment")
        val organizationName =
          if (overwritingDataSetName.isDefined) None else parseOrganizationName(parameters \ "experiment")
        val activeNodeId = parseActiveNode(parameters \ "activeNode")
        val editPosition =
          parseEditPosition(parameters \ "editPosition").getOrElse(SkeletonTracingDefaults.editPosition)
        val editRotation =
          parseEditRotation(parameters \ "editRotation").getOrElse(SkeletonTracingDefaults.editRotation)
        val zoomLevel = parseZoomLevel(parameters \ "zoomLevel").getOrElse(SkeletonTracingDefaults.zoomLevel)
        var userBoundingBoxes = parseBoundingBoxes(parameters \ "userBoundingBox")
        var taskBoundingBox: Option[BoundingBox] = None
        parseTaskBoundingBox(parameters \ "taskBoundingBox", isTaskUpload, userBoundingBoxes).foreach {
          case Left(value)  => taskBoundingBox = Some(value)
          case Right(value) => userBoundingBoxes = userBoundingBoxes :+ value
        }

        logger.debug(s"Parsed NML file. Trees: ${treesSplit.size}, Volumes: ${volumes.size}")

        val volumeTracingWithDataLocation =
          if (volumes.isEmpty) None
          else
            Some(
              (VolumeTracing(
                 None,
                 boundingBoxToProto(taskBoundingBox.getOrElse(BoundingBox.empty)),
                 timestamp,
                 dataSetName,
                 editPosition,
                 editRotation,
                 ElementClass.uint32,
                 volumes.head.fallbackLayer,
                 0,
                 0,
                 zoomLevel,
                 None,
                 userBoundingBoxes
               ),
               volumes.head.location)
            )

        val skeletonTracing =
          if (treesSplit.isEmpty) None
          else
            Some(
              SkeletonTracing(dataSetName,
                              treesSplit,
                              timestamp,
                              taskBoundingBox,
                              activeNodeId,
                              editPosition,
                              editRotation,
                              zoomLevel,
                              version = 0,
                              None,
                              treeGroupsAfterSplit,
                              userBoundingBoxes)
            )

        (skeletonTracing, volumeTracingWithDataLocation, description, organizationName)
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

  def extractTreeGroups(treeGroupContainerNodes: NodeSeq)(implicit m: MessagesProvider): Box[List[TreeGroup]] = {
    val treeGroupNodes = treeGroupContainerNodes.flatMap(_ \ "group")
    treeGroupNodes.map(parseTreeGroup).toList.toSingleBox(Messages("nml.element.invalid", "tree groups"))
  }

  def parseTreeGroup(node: XMLNode)(implicit m: MessagesProvider): Box[TreeGroup] =
    for {
      id <- (node \ "@id").text.toIntOpt ?~ Messages("nml.treegroup.id.invalid", (node \ "@id").text)
      children <- (node \ "group").map(parseTreeGroup).toList.toSingleBox("")
      name = (node \ "@name").text
    } yield TreeGroup(name, id, children)

  def extractVolumes(volumeNodes: NodeSeq) =
    volumeNodes.map(node => Volume((node \ "@location").text, (node \ "@fallbackLayer").map(_.text).headOption))

  private def parseTrees(treeNodes: NodeSeq, branchPoints: Map[Int, List[BranchPoint]], comments: Map[Int, List[Comment]])(
      implicit m: MessagesProvider) =
    treeNodes
      .map(treeNode => parseTree(treeNode, branchPoints, comments))
      .toList
      .toSingleBox(Messages("nml.element.invalid", "trees"))

  private def parseBoundingBoxes(boundingBoxNodes: NodeSeq)(implicit m: MessagesProvider): Seq[NamedBoundingBox] =
    if (boundingBoxNodes.size == 1 && (boundingBoxNodes \ "@id").text.isEmpty) {
      Seq.empty ++ parseBoundingBox(boundingBoxNodes).map(NamedBoundingBox(0, None, None, None, _))
    } else {
      boundingBoxNodes.flatMap(node =>
        for {
          id <- (node \ "@id").text.toIntOpt ?~ Messages("nml.boundingbox.id.invalid", (node \ "@id").text)
          name = (node \ "@name").text
          isVisible = (node \ "@isVisible").text.toBooleanOpt
          color = parseColor(node)
          boundingBox <- parseBoundingBox(node)
          nameOpt = if (name.isEmpty) None else Some(name)
        } yield NamedBoundingBox(id, nameOpt, isVisible, color, boundingBox))
    }

  private def parseTaskBoundingBox(
      node: NodeSeq,
      isTask: Boolean,
      userBoundingBoxes: Seq[NamedBoundingBox]): Option[Either[BoundingBox, NamedBoundingBox]] =
    parseBoundingBox(node).map { bb =>
      if (isTask) {
        Left(bb)
      } else {
        val newId = if (userBoundingBoxes.isEmpty) 0 else userBoundingBoxes.map(_.id).max + 1
        Right(NamedBoundingBox(newId, Some("task bounding box"), None, Some(getRandomColor()), bb))
      }
    }

  private def parseBoundingBox(node: NodeSeq) =
    for {
      topLeftX <- (node \ "@topLeftX").text.toIntOpt
      topLeftY <- (node \ "@topLeftY").text.toIntOpt
      topLeftZ <- (node \ "@topLeftZ").text.toIntOpt
      width <- (node \ "@width").text.toIntOpt
      height <- (node \ "@height").text.toIntOpt
      depth <- (node \ "@depth").text.toIntOpt
    } yield BoundingBox(Point3D(topLeftX, topLeftY, topLeftZ), width, height, depth)

  private def parseDataSetName(node: NodeSeq) =
    (node \ "@name").text

  private def parseDescription(node: NodeSeq) =
    (node \ "@description").text

  private def parseOrganizationName(node: NodeSeq) =
    (node \ "@organization").headOption.map(_.text)

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

  private def parseBranchPoints(branchPoints: NodeSeq, defaultTimestamp: Long)(
      implicit m: MessagesProvider): Box[List[BranchPoint]] =
    (branchPoints \ "branchpoint").zipWithIndex.map {
      case (branchPoint, index) =>
        (branchPoint \ "@id").text.toIntOpt.map { nodeId =>
          val parsedTimestamp = (branchPoint \ "@time").text.toLongOpt
          val timestamp = parsedTimestamp.getOrElse(defaultTimestamp - index)
          BranchPoint(nodeId, timestamp)
        } ?~ Messages("nml.node.id.invalid", "branchpoint", (branchPoint \ "@id").text)
    }.toList.toSingleBox(Messages("nml.element.invalid", "branchpoints"))

  private def parsePoint3D(node: XMLNode) = {
    val xText = getSingleAttribute(node, "x")
    val yText = getSingleAttribute(node, "y")
    val zText = getSingleAttribute(node, "z")
    for {
      x <- xText.toIntOpt.orElse(xText.toFloatOpt.map(math.round))
      y <- yText.toIntOpt.orElse(yText.toFloatOpt.map(math.round))
      z <- zText.toIntOpt.orElse(zText.toFloatOpt.map(math.round))
    } yield Point3D(x, y, z)
  }

  private def parseRotationForParams(node: XMLNode) =
    for {
      rotX <- (node \ "@xRot").text.toDoubleOpt
      rotY <- (node \ "@yRot").text.toDoubleOpt
      rotZ <- (node \ "@zRot").text.toDoubleOpt
    } yield Vector3D(rotX, rotY, rotZ)

  private def parseRotationForNode(node: XMLNode) =
    for {
      rotX <- getSingleAttribute(node, "rotX").toDoubleOpt
      rotY <- getSingleAttribute(node, "rotY").toDoubleOpt
      rotZ <- getSingleAttribute(node, "rotZ").toDoubleOpt
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

  private def parseVisibility(node: XMLNode, color: Option[Color]): Option[Boolean] =
    (node \ "@isVisible").text.toBooleanOpt match {
      case Some(isVisible) => Some(isVisible)
      case None            => color.map(c => !c.a.isNearZero)
    }

  private def parseTree(tree: XMLNode, branchPoints: Map[Int, List[BranchPoint]], comments: Map[Int, List[Comment]])(
      implicit m: MessagesProvider): Box[Tree] = {
    for {
      id <- getSingleAttribute(tree, "id").toIntOpt ?~ Messages("nml.tree.id.invalid", (tree \ "@id").text)
      color = parseColor(tree)
      name = parseName(tree)
      groupId = parseGroupId(tree)
      isVisible = parseVisibility(tree, color)
      nodes <- (tree \ "nodes" \ "node").map(parseNode).toList.toSingleBox(Messages("nml.tree.elements.invalid", "nodes", id))
      edges <- (tree \ "edges" \ "edge").map(parseEdge).toList.toSingleBox(Messages("nml.tree.elements.invalid", "edges", id))
      nodeIds = nodes.map(_.id)
      treeBranchPoints = nodeIds.flatMap(nodeId => branchPoints.getOrElse(nodeId, List()))
      treeComments = nodeIds.flatMap(nodeId => comments.getOrElse(nodeId, List()))
      createdTimestamp = if (nodes.isEmpty) System.currentTimeMillis() else nodes.minBy(_.createdTimestamp).createdTimestamp
    } yield Tree(id, nodes, edges, color, treeBranchPoints, treeComments, name, createdTimestamp, groupId, isVisible)
  }

  private def parseComments(comments: NodeSeq)(implicit m: MessagesProvider): Box[List[Comment]] =
    (for {
      commentNode <- comments \ "comment"
    } yield {
      for {
        nodeId <- getSingleAttribute(commentNode, "node").toIntOpt ?~ Messages("nml.comment.node.invalid", getSingleAttribute(commentNode, "node"))
      } yield {
        val content = getSingleAttribute(commentNode, "content")
        Comment(nodeId, content)
      }
    }).toList.toSingleBox(Messages("nml.element.invalid", "comments"))

  private def buildCommentMap(comments: List[Comment]): Map[Int, List[Comment]] = {
    val commentMap = new mutable.HashMap[Int, List[Comment]]()
    comments.foreach { c =>
      if (commentMap.contains(c.nodeId)) {
        commentMap(c.nodeId) = c :: commentMap(c.nodeId)
      } else {
        commentMap(c.nodeId) = List(c)
      }
    }
    commentMap.toMap
  }

  private def buildBranchPointMap(branchPoints: List[BranchPoint]): Map[Int, List[BranchPoint]] = {
    val branchPointMap = new mutable.HashMap[Int, List[BranchPoint]]()
    branchPoints.foreach { b =>
      if (branchPointMap.contains(b.nodeId)) {
        branchPointMap(b.nodeId) = b :: branchPointMap(b.nodeId)
      } else {
        branchPointMap(b.nodeId) = List(b)
      }
    }
    branchPointMap.toMap
  }

  private def getSingleAttribute(xmlNode: XMLNode, attribute: String): String = {
    xmlNode.attribute(attribute).flatMap(_.headOption.map(_.text)).getOrElse("")
  }

  private def parseEdge(edge: XMLNode)(implicit m: MessagesProvider): Box[Edge] = {
    val sourceStr = getSingleAttribute(edge, "source")
    val targetStr = getSingleAttribute(edge, "target")
    for {
      source <- sourceStr.toIntOpt ?~ Messages("nml.edge.invalid", sourceStr)
      target <- targetStr.toIntOpt ?~ Messages("nml.edge.invalid", targetStr)
    } yield {
      Edge(source, target)
    }
  }

  private def parseViewport(node: XMLNode) =
    getSingleAttribute(node, "inVp").toIntOpt.getOrElse(DEFAULT_VIEWPORT)

  private def parseResolution(node: XMLNode) =
    getSingleAttribute(node, "inMag").toIntOpt.getOrElse(DEFAULT_RESOLUTION)

  private def parseBitDepth(node: XMLNode) =
    getSingleAttribute(node, "bitDepth").toIntOpt.getOrElse(DEFAULT_BITDEPTH)

  private def parseInterpolation(node: XMLNode) =
    getSingleAttribute(node, "interpolation").toBooleanOpt.getOrElse(DEFAULT_INTERPOLATION)

  private def parseTimestamp(node: XMLNode) =
    getSingleAttribute(node, "time").toLongOpt.getOrElse(DEFAULT_TIMESTAMP)

  private def parseNode(node: XMLNode)(implicit m: MessagesProvider): Box[Node] =
    for {
      id <- getSingleAttribute(node, "id").toIntOpt ?~ Messages("nml.node.id.invalid", "", (node \ "@id").text)
      radius <- getSingleAttribute(node, "radius").toFloatOpt ?~ Messages("nml.node.attribute.invalid", "radius", id)
      position <- parsePoint3D(node) ?~ Messages("nml.node.attribute.invalid", "position", id)
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
