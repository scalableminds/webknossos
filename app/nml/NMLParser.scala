package nml

import scala.xml.XML
import models.DataSet
import models.graph.{ Experiment, Tree, Edge }
import models.graph
import models.Color
import brainflight.tools.ExtendedTypes._
import brainflight.tools.geometry.Point3D
import scala.xml.Node
import scala.xml.NodeSeq
import play.api.Logger
import models.graph.Tree
import java.io.File
import models.BranchPoint
import brainflight.tools.geometry.Scale

class NMLParser(file: File) {
  def parse = {
    val data = XML.loadFile(file)
    for {
      parameters <- (data \ "parameters")
      dataSetId <- (parameters \ "experiment" \ "@name")
      editPosition <- parseEditPosition(parameters \ "editPosition")
      scale <- parseScale(parameters \ "scale")
      time <- ((parameters \ "time" \ "@ms").text).toIntOpt
      activeNodeId <- ((parameters \ "activeNode" \ "@id").text).toIntOpt
      dataSet <- DataSet.findOneByName(dataSetId.text)
    } yield {
      val trees = verifyTrees((data \ "thing").flatMap(parseTree).toList)
      val branchPoints = (data \ "branchpoints" \ "branchpoint").flatMap(parseBranchPoint(trees))
      Experiment(dataSet._id, trees, branchPoints.toList, time, activeNodeId, scale, editPosition)
    }
  }
  
  
  

  def verifyTrees(trees: List[Tree]): List[Tree] = {
    trees.flatMap(splitIntoComponents)
    //trees
  }
  
  def splitIntoComponents(tree: Tree): List[Tree] = {
    def buildTreeFromNode(node: models.graph.Node, sourceTree: Tree): Tree = {
        val connectedEdges = sourceTree.edges.filter( e => e.target == node.id || e.source == node.id)
        
        val connectedNodes = connectedEdges.flatMap{
          case Edge(s,t) if s == node.id => sourceTree.nodes.find( _.id == t)
          case Edge(s,t) if t == node.id => sourceTree.nodes.find( _.id == s)
        }
        
        val componentPart = Tree(tree.id, node :: connectedNodes, connectedEdges, tree.color)
        
        //println("node: \n"+ node + "\ncomponentPart: \n" + componentPart + "\ntree: \n" + sourceTree + "\n")
        connectedNodes.foldLeft(componentPart)((tree, n) =>
            tree ++ buildTreeFromNode(n, sourceTree -- componentPart))
    }
    
    var treeToProcess = tree
    
    var components = List[Tree]()
    
    while(!treeToProcess.nodes.isEmpty){
      val component = buildTreeFromNode(treeToProcess.nodes.head, treeToProcess)
      treeToProcess = treeToProcess -- component
      components ::= component
    }
    if(components.size > 1 ) Logger.debug("Splitted tree: " + components)
    components
  }

  def parseEditPosition(node: NodeSeq) = {
    node.headOption.flatMap(parsePoint3D)
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
    for {
      colorRed <- ((node \ "@color.r").text).toFloatOpt
      colorBlue <- ((node \ "@color.g").text).toFloatOpt
      colorGreen <- ((node \ "@color.b").text).toFloatOpt
      colorAlpha <- ((node \ "@color.a").text).toFloatOpt
    } yield {
      Color(colorRed, colorBlue, colorGreen, colorAlpha)
    }
  }

  def parseTree(tree: Node): Option[Tree] = {
    (for {
      id <- ((tree \ "@id").text).toIntOpt
      color <- parseColor(tree)
    } yield {
      Logger.debug("Parsing tree Id: %d".format(id))
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
      //sourceNode <- treeNodes.get(source)
      //targetNode <- treeNodes.get(target)
    } yield {
      Edge(source, target)
    }
  }

  def parseNode(node: Node) = {
    for {
      id <- ((node \ "@id").text).toIntOpt
      radius <- ((node \ "@radius").text).toFloatOpt
      position <- parsePoint3D(node)
      viewport <- ((node \ "@inVp").text).toIntOpt
      resolution <- ((node \ "@inMag").text).toIntOpt
      timestamp <- ((node \ "@time").text).toIntOpt
    } yield {
      (id -> graph.Node(id, radius, position, viewport, resolution, timestamp))
    }
  }
}