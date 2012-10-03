package models.graph

import xml.XMLWrites

case class Edge(source: Int, target: Int)

object Edge {
  implicit object EdgeXMLWrites extends XMLWrites[Edge]{
    def writes(e: Edge) = {
      <edge source={ e.source.toString } target={ e.target.toString }/>
    }
  }
}