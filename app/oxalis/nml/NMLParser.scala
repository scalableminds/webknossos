package oxalis.nml

import scala.xml.XML
import braingames.binary.models.DataSet
import models.tracing.Tracing
import braingames.image.Color
import braingames.util.ExtendedTypes.ExtendedString
import braingames.geometry.Point3D
import scala.xml.{ Node => XMLNode }
import scala.xml.NodeSeq
import play.api.Logger
import java.io.File
import braingames.geometry.Scale
import models.user.User
import com.sun.org.apache.xerces.internal.impl.io.MalformedByteSequenceException
import java.io.InputStream
import java.io.FileInputStream
import net.liftweb.common.Box
import net.liftweb.common.Box._
import net.liftweb.common.Box
import net.liftweb.common.Failure
import utils._
import scala.annotation.tailrec

object NMLParser {

  def createUniqueIds(trees: List[Tree]) = {
    trees.foldLeft(List[Tree]()) { (l, t) =>
      if (l.isEmpty || l.find(_.treeId == t.treeId).isEmpty)
        t :: l
      else {
        val alteredId = (l.maxBy(_.treeId).treeId + 1)
        t.copy(treeId = alteredId) :: l
      }
    }
  }
}

class NMLParser(in: InputStream) {
  val DEFAULT_EDIT_POSITION = Point3D(0, 0, 0)
  val DEFAULT_TIME = 0
  val DEFAULT_ACTIVE_NODE_ID = 1
  val DEFAULT_COLOR = Color(1, 0, 0, 0)
  val DEFAULT_VIEWPORT = 0
  val DEFAULT_RESOLUTION = 0
  val DEFAULT_TIMESTAMP = 0

  def this(file: File) =
    this(new FileInputStream(file))

  def parse: Box[NML] = {
    try {
      val data = XML.load(in)
      for {
        parameters <- (data \ "parameters").headOption ?~ "No parameters section found"
        scale <- parseScale(parameters \ "scale") ?~ "Couldn't parse scale"
      } yield {
        val dataSetName = parseDataSetName(parameters \ "experiment")
        val activeNodeId = parseActiveNode(parameters \ "activeNode")
        val editPosition = parseEditPosition(parameters \ "editPosition")
        val time = parseTime(parameters \ "time")
        val (_, parsedTrees, nodeMapping) = parseTrees((data \ "thing"))
        val trees = verifyTrees(parsedTrees)
        val comments = parseComments(data \ "comments", nodeMapping).toList
        val branchPoints = (data \ "branchpoints" \ "branchpoint").flatMap(parseBranchPoint(trees, nodeMapping))
        Logger.debug(s"Parsed NML file. Trees: ${trees.size}")
        NML(dataSetName, trees, branchPoints.toList, time, activeNodeId, scale, editPosition, comments)
      }
    } catch {
      case e: Exception =>
        Logger.error("Failed to parse NML due to " + e)
        Failure("Couldn't parse nml: " + e.toString)
    }
  }

  def verifyTrees(trees: List[Tree]): List[Tree] = {
    NMLParser.createUniqueIds(trees.flatMap(splitIntoComponents))
  }

  def splitIntoComponents(tree: Tree): List[Tree] = {
    def emptyTree = tree.copy(nodes = Set.empty, edges = Set.empty)

    val t = System.currentTimeMillis()

    val nodeMap = tree.nodes.map(n => n.id -> n).toMap

    @tailrec
    def buildTreeFromNode(nodesToProcess: List[Node], treeReminder: Tree, component: Tree = emptyTree): (Tree, Tree) = {
      if (!nodesToProcess.isEmpty) {
        val node = nodesToProcess.head
        val tail = nodesToProcess.tail
        val connectedEdges = treeReminder.edges.filter(e => e.source == node.id || e.target == node.id)
          
        val connectedNodes = connectedEdges.flatMap {
          case Edge(s, t) if s == node.id => nodeMap.get(t)
          case Edge(s, t) if t == node.id => nodeMap.get(s)
        }

        val currentComponent = tree.copy(nodes = connectedNodes + node, edges = connectedEdges)
        val r = (component ++ currentComponent)
        buildTreeFromNode(tail ::: connectedNodes.toList, treeReminder -- currentComponent, r)
      } else
        (treeReminder -> component)
    }

    var treeToProcess = tree

    var components = List[Tree]()

    while (!treeToProcess.nodes.isEmpty) {
      val (treeReminder, component) = buildTreeFromNode(treeToProcess.nodes.head :: Nil, treeToProcess)
      treeToProcess = treeReminder
      components ::= component
    }
    Logger.trace("Connected components calculation: " + (System.currentTimeMillis() - t))
    components.map(
      _.copy(
        color = tree.color,
        treeId = tree.treeId))
  }

  def parseTrees(nodes: NodeSeq) = {
    nodes.foldLeft((1, List[Tree](), new NodeMapping())) {
      case ((nextNodeId, trees, nodeMapping), xml) =>
        parseTree(xml, nextNodeId) match {
          case Some((mapping, tree)) =>
            (nextNodeId + tree.nodes.size, tree :: trees, nodeMapping ++ mapping)
          case _ =>
            (nextNodeId, trees, nodeMapping)
        }
    }
  }

  def parseDataSetName(node: NodeSeq) = {
    val rawDataSetName = (node \ "@name").text
    val magRx = "_mag[0-9]*$".r
    magRx.replaceAllIn(rawDataSetName, "")
  }

  def parseActiveNode(node: NodeSeq) = {
    (node \ "@id").text.toIntOpt.getOrElse(DEFAULT_ACTIVE_NODE_ID)
  }

  def parseTime(node: NodeSeq) = {
    (node \ "@ms").text.toIntOpt.getOrElse(DEFAULT_TIME)
  }
  def parseEditPosition(node: NodeSeq) = {
    node.headOption.flatMap(parsePoint3D).getOrElse(DEFAULT_EDIT_POSITION)
  }

  def parseBranchPoint(trees: List[Tree], nodeMapping: Map[Int, Node])(node: XMLNode) = {
    for {
      nodeId <- ((node \ "@id").text).toIntOpt
      node <- nodeMapping.get(nodeId)
    } yield BranchPoint(node.id)
  }

  def parsePoint3D(node: XMLNode) = {
    for {
      x <- ((node \ "@x").text).toIntOpt
      y <- ((node \ "@y").text).toIntOpt
      z <- ((node \ "@z").text).toIntOpt
    } yield Point3D(x, y, z)
  }

  def parseScale(nodes: NodeSeq) = {
    nodes.headOption.flatMap(node =>
      for {
        x <- ((node \ "@x").text).toFloatOpt
        y <- ((node \ "@y").text).toFloatOpt
        z <- ((node \ "@z").text).toFloatOpt
      } yield Scale(x, y, z))
  }

  def parseColor(node: XMLNode) = {
    (for {
      colorRed <- ((node \ "@color.r").text).toFloatOpt
      colorBlue <- ((node \ "@color.g").text).toFloatOpt
      colorGreen <- ((node \ "@color.b").text).toFloatOpt
      colorAlpha <- ((node \ "@color.a").text).toFloatOpt
    } yield {
      Color(colorRed, colorBlue, colorGreen, colorAlpha)
    }) getOrElse (DEFAULT_COLOR)
  }
  
  def parseName(node: XMLNode) = {
    (node \ "@name").text
  }

  def parseTree(tree: XMLNode, nextNodeId: Int): Option[(NodeMapping, Tree)] = {
    ((tree \ "@id").text).toIntOpt.flatMap { id =>
      val color = parseColor(tree)
      val name = parseName(tree)
      Logger.trace("Parsing tree Id: %d".format(id))
      val (_, nodeMapping) = (tree \ "nodes" \ "node").foldLeft((nextNodeId, new NodeMapping())) {
        case ((nextNodeId, nodeMapping), nodeXml) =>
          parseNode(nextNodeId)(nodeXml) match {
            case Some(mapping) =>
              (nextNodeId + 1, nodeMapping + mapping)
            case _ =>
              (nextNodeId, nodeMapping)
          }
      }

      val edges = (tree \ "edges" \ "edge").flatMap(parseEdge(nodeMapping)).toSet

      if (nodeMapping.size > 0)
        Some(nodeMapping -> Tree(id, nodeMapping.values.toSet, edges, color, name))
      else
        None
    }
  }

  def parseComments(comments: NodeSeq, nodeMapping: Map[Int, Node]) = {
    for {
      comment <- comments \ "comment"
      nodeId <- ((comment \ "@node").text).toIntOpt
      node <- nodeMapping.get(nodeId)
    } yield {
      val content = (comment \ "@content").text
      Comment(node.id, content)
    }
  }

  def findRootNode(treeNodes: Map[Int, XMLNode], edges: List[Edge]) = {
    val childNodes = edges.map(_.target)
    treeNodes.filter {
      case (id, node) => !childNodes.contains(node)
    }.foreach(println)
    treeNodes.find(node => !childNodes.contains(node)).map(_._2)
  }

  def parseEdge(nodeMapping: Map[Int, Node])(edge: XMLNode) = {
    for {
      source <- ((edge \ "@source").text).toIntOpt
      target <- ((edge \ "@target").text).toIntOpt
      mappedSource <- nodeMapping.get(source)
      mappedTarget <- nodeMapping.get(target)
    } yield {
      Edge(mappedSource.id, mappedTarget.id)
    }
  }

  def parseViewport(node: NodeSeq) = {
    ((node \ "@inVp").text).toIntOpt.getOrElse(DEFAULT_VIEWPORT)
  }

  def parseResolution(node: NodeSeq) = {
    ((node \ "@inMag").text).toIntOpt.getOrElse(DEFAULT_RESOLUTION)
  }

  def parseTimestamp(node: NodeSeq) = {
    ((node \ "@time").text).toIntOpt.getOrElse(DEFAULT_TIMESTAMP)
  }

  def parseNode(nextNodeId: Int)(node: XMLNode) = {
    for {
      id <- ((node \ "@id").text).toIntOpt
      radius <- ((node \ "@radius").text).toFloatOpt
      position <- parsePoint3D(node)
    } yield {
      val viewport = parseViewport(node)
      val resolution = parseResolution(node)
      val timestamp = parseTimestamp(node)
      (id -> Node(nextNodeId, position, radius, viewport, resolution, timestamp))
    }
  }
}