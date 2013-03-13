package models.tracing

import models.task.Task

trait ContainsTracingInfo {
  def id: String
  def dataSetName: String
  def tracingType: TracingType.Value
  def isReadOnly: Boolean
  def task: Option[Task]
}

case class TracingInfo(id: String, dataSetName: String, tracingType: TracingType.Value, isReadOnly: Boolean, task: Option[Task] = None) extends ContainsTracingInfo