package nml

import scala.collection.immutable.HashMap

object utils {
  type NodeMapping = HashMap[Int, Node]
  
  type TreeMapping = HashMap[Int, (Int, NodeMapping)]
}