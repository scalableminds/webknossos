package backend

import models.annotation.Annotation
import models.user.time.TimeSpan
import org.scalatest.FlatSpec
import utils.ObjectId

class TimeTest {
  private var lastUserActivities: Option[TimeSpan] = None
  val MaxTracingPause = 60000L

  @SuppressWarnings(Array("TraversableHead", "TraversableLast")) // Only functions call this which put at least one timestamp in the seq
  def trackTime(timestamps: Seq[Long], _user: ObjectId) = {
    // Only if the annotation belongs to the user, we are going to log the time on the annotation
    val annotation = None
    val start = timestamps.head

    var timeSpansToInsert: List[TimeSpan] = List()
    var timeSpansToUpdate: List[(TimeSpan, Long)] = List()

    def createNewTimeSpan(timestamp: Long, _user: ObjectId, annotation: Option[Annotation]) = {
      val timeSpan = TimeSpan.createFrom(timestamp, timestamp, _user, annotation.map(_._id))
      timeSpansToInsert = timeSpan :: timeSpansToInsert
      timeSpan
    }

    def updateTimeSpan(timeSpan: TimeSpan, timestamp: Long) = {
      timeSpansToUpdate = (timeSpan, timestamp) :: timeSpansToUpdate

      val duration = timestamp - timeSpan.lastUpdate
      val updated = timeSpan.addTime(duration, timestamp)
      updated
    }

    var current = lastUserActivities
      .flatMap(lastActivity => {
        if (isNotInterrupted(start, lastActivity)) {
          if (belongsToSameTracing(lastActivity, annotation)) {
            Some(lastActivity)
          } else {
            updateTimeSpan(lastActivity, start)
            None
          }
        } else None
      })
      .getOrElse(createNewTimeSpan(start, _user, annotation))

    timestamps.sliding(2).foreach { pair =>
      val start = pair.head
      val end = pair.last
      val duration = end - start
      if (duration >= MaxTracingPause) {
        updateTimeSpan(current, start)
        current = createNewTimeSpan(end, _user, annotation)
      }
    }
    current = updateTimeSpan(current, timestamps.last)
    lastUserActivities = Some(current)

    (timeSpansToInsert, timeSpansToUpdate)
  }

  private def isNotInterrupted(current: Long, last: TimeSpan) = {
    val duration = current - last.lastUpdate
    duration >= 0 && duration < MaxTracingPause
  }

  private def belongsToSameTracing(last: TimeSpan, annotation: Option[Annotation]) =
    true

  def getTotalTracingTime(timespans: List[(TimeSpan, Long)]) =
    timespans.foldLeft(0l)((duration, tuple) => duration + (tuple._2 - tuple._1.lastUpdate))
}

class TimeTrackingUnitTestSuite extends FlatSpec {
  "Timetracking" should "create and update timeSpans correctly" in {
    val timeTest = new TimeTest
    val (toInsert, toUpdate) = timeTest.trackTime(Seq(1000L, 1100L), ObjectId.generate)

    assert(toInsert.size == 1)
    assert(timeTest.getTotalTracingTime(toUpdate) == 100L)

    val (toInsertTwo, toUpdateTwo) = timeTest.trackTime(Seq(59000L, 59100L), ObjectId.generate)

    assert(toInsertTwo.isEmpty)
    assert(timeTest.getTotalTracingTime(toUpdate ::: toUpdateTwo) == 58100L)

    val (toInsertThree, toUpdateThree) = timeTest.trackTime(Seq(120000L, 120100L), ObjectId.generate)

    assert(toInsertThree.size == 1)
    assert(timeTest.getTotalTracingTime(toUpdate ::: toUpdateTwo ::: toUpdateThree) == 58200L)
  }
}
