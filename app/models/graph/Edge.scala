package models.graph

import xml.XMLWrites

case class Edge(source: Node, target: Node)

object Edge {
  implicit object EdgeXMLWrites extends XMLWrites[Edge]{
    def writes(e: Edge) = {
      <edge source={ e.source.id.toString } target={ e.target.id.toString }/>
    }
  }
}