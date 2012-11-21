package nml

import scala.xml.XML
import models.binary.DataSet
import models.graph.{ Tree, Edge }
import models.tracing.Tracing
import models.graph
import models.Color
import brainflight.tools.ExtendedTypes._
import brainflight.tools.geometry.Point3D
import scala.xml.Node
import scala.xml.NodeSeq
import play.api.Logger
import models.graph.Tree
import java.io.File
import models.graph.BranchPoint
import brainflight.tools.geometry.Scale
import models.user.User

case class NMLContext(user: User)

object NMLParser {
  def createUniqueIds(trees: List[Tree]) = {
    trees.foldLeft(List[Tree]()) { (l, t) =>
      if (l.isEmpty || l.find(_.id == t.id).isEmpty)
        t :: l
      else {
        val alteredId = (l.maxBy(_.id).id + 1)
        t.copy(id = alteredId) :: l
      }
    }
  }
}

class NMLParser(file: File)(implicit ctx: NMLContext) {
  val DEFAULT_EDIT_POSITION = Point3D(0, 0, 0)
  val DEFAULT_TIME = 0
  val DEFAULT_ACTIVE_NODE_ID = 1
  val DEFAULT_COLOR = Color(1, 0, 0, 0)
  val DEFAULT_VIEWPORT = 0
  val DEFAULT_RESOLUTION = 0
  val DEFAULT_TIMESTAMP = 0

  def parse = {
    val data = XML.loadFile(file)
    for {
      parameters <- (data \ "parameters")
      scale <- parseScale(parameters \ "scale")
    } yield {
      val dataSetName = parseDataSetName(parameters \ "tracing")
      val activeNodeId = parseActiveNode(parameters \ "activeNode")
      val editPosition = parseEditPosition(parameters \ "editPosition")
      val time = parseTime(parameters \ "time")
      val trees = verifyTrees((data \ "thing").flatMap(parseTree).toList)
      val branchPoints = (data \ "branchpoints" \ "branchpoint").flatMap(parseBranchPoint(trees))
      Tracing(ctx.user._id, dataSetName, trees, branchPoints.toList, time, activeNodeId, scale, editPosition)
    }
  }

  def verifyTrees(trees: List[Tree]): List[Tree] = {
    NMLParser.createUniqueIds(trees.flatMap(splitIntoComponents))
  }

  def splitIntoComponents(tree: Tree): List[Tree] = {
    def buildTreeFromNode(node: models.graph.Node, sourceTree: Tree): Tree = {
      val connectedEdges = sourceTree.edges.filter(e => e.target == node.id || e.source == node.id)

      val connectedNodes = connectedEdges.flatMap {
        case Edge(s, t) if s == node.id => sourceTree.nodes.find(_.id == t)
        case Edge(s, t) if t == node.id => sourceTree.nodes.find(_.id == s)
      }

      val componentPart = Tree(tree.id, node :: connectedNodes, connectedEdges, tree.color)

      connectedNodes.foldLeft(componentPart)((tree, n) =>
        tree ++ buildTreeFromNode(n, sourceTree -- componentPart))
    }

    var treeToProcess = tree

    var components = List[Tree]()

    while (!treeToProcess.nodes.isEmpty) {
      val component = buildTreeFromNode(treeToProcess.nodes.head, treeToProcess)
      treeToProcess = treeToProcess -- component
      components ::= component
    }
    components
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

  def parseBranchPoint(trees: List[Tree])(node: Node) = {
    ((node \ "@id").text).toIntOpt.map(id =>
      BranchPoint(id))
  }

  def parsePoint3D(node: Node) = {
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

  def parseColor(node: Node) = {
    (for {
      colorRed <- ((node \ "@color.r").text).toFloatOpt
      colorBlue <- ((node \ "@color.g").text).toFloatOpt
      colorGreen <- ((node \ "@color.b").text).toFloatOpt
      colorAlpha <- ((node \ "@color.a").text).toFloatOpt
    } yield {
      Color(colorRed, colorBlue, colorGreen, colorAlpha)
    }) getOrElse (DEFAULT_COLOR)
  }

  def parseTree(tree: Node): Option[Tree] = {
    (for {
      id <- ((tree \ "@id").text).toIntOpt
    } yield {
      val color = parseColor(tree)
      Logger.trace("Parsing tree Id: %d".format(id))
      val nodes = (tree \ "nodes" \ "node").flatMap(parseNode).toMap

      val edges = (tree \ "edges" \ "edge").flatMap(parseEdge(nodes)).toList

      if (nodes.size > 0)
        Some(Tree(id, nodes.values.toList, edges, color))
      else
        None
    }).flatMap(x => x)
  }

  def findRootNode(treeNodes: Map[Int, Node], edges: List[Edge]) = {
    val childNodes = edges.map(_.target)
    treeNodes.filter {
      case (id, node) => !childNodes.contains(node)
    }.foreach(println)
    treeNodes.find(node => !childNodes.contains(node)).map(_._2)
  }

  def parseEdge(treeNodes: Map[Int, graph.Node])(edge: Node) = {
    for {
      source <- ((edge \ "@source").text).toIntOpt
      target <- ((edge \ "@target").text).toIntOpt
    } yield {
      Edge(source, target)
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

  def parseNode(node: Node) = {
    for {
      id <- ((node \ "@id").text).toIntOpt
      radius <- ((node \ "@radius").text).toFloatOpt
      position <- parsePoint3D(node)
    } yield {
      val viewport = parseViewport(node)
      val resolution = parseResolution(node)
      val timestamp = parseTimestamp(node)
      (id -> graph.Node(id, radius, position, viewport, resolution, timestamp))
    }
  }
}