package org.specs2
package mutable

import org.specs2.execute.StandardResults
import org.specs2.main.ArgumentsShortcuts
import org.specs2.matcher.MustThrownMatchers
import org.specs2.specification.AutoExamples
import org.specs2.specification.FormattingFragments
import org.specs2.matcher.ShouldThrownMatchers
import org.specs2.specification.SpecificationStructure
import org.specs2.specification.Outside
import org.specs2.matcher.StandardMatchResults
import org.specs2.control.Debug
import org.specs2.execute.PendingUntilFixed
import org.specs2.specification.Context
import org.specs2.specification.Contexts
import org.specs2.matcher.MatchResult
import org.specs2.execute.Result
import akka.testkit.TestKit
import com.typesafe.config.ConfigFactory
import akka.actor.ActorSystem
import org.specs2.specification.Scope
import com.typesafe.config.Config
import org.specs2.specification.AroundOutside
import akka.testkit.TestActorRef
import akka.actor.ActorRef
import akka.util.Duration
import akka.actor.UnhandledMessage
import org.specs2.matcher.MustMatchers

trait AkkaSpecification extends SpecificationStructure with AkkaSpecificationFeatures {
  def is = specFragments
  sequential

  def akkaTestSystem(config: String) = ActorSystem("testSystem", ConfigFactory.parseString(config).withFallback(ConfigFactory.load()));

  val debugConfig: String = """akka {
  loglevel = DEBUG
  actor {
    debug {
      receive = on
      autoreceive = on
      lifecycle = on
    }
  }
}"""

  val config: String = """akka {
  loglevel = WARNING
  actor {
    debug {
      receive = off
      autoreceive = off
      lifecycle = off
    }
  }
}"""

  /**
   * used to create a specs2 Scope with the akka TestKit
   *
   * Example:
   * val akkaSystem = akkaTestSystem(config)
   *
   * class setup extends AkkaKit(akkaSystem) {
   * system.eventStream.subscribe(testActor, classOf[UnhandledMessage])
   * }
   *
   * "some test" in new setup { test code }
   *
   */
    
  class setup(implicit akkaSystem: ActorSystem) extends AkkaKit(akkaSystem) {
    system.eventStream.subscribe(testActor, classOf[UnhandledMessage])
  }
  
  abstract class AkkaKit(_system: ActorSystem) extends TestKit(_system) with Scope
}

trait DeactivatedTimeConversions extends org.specs2.time.TimeConversions {
  override def intToRichLong(v: Int) = super.intToRichLong(v)
  override def longToRichLong(v: Long) = super.longToRichLong(v)

  //TODO: add implicit conversion from Akka duration to Specs2 duration, once specs2 is version 1.8 and Duration is easier to get at

}

trait AkkaSpecificationFeatures extends FragmentsBuilder
  with mutable.SpecificationInclusion
  with ArgumentsArgs
  with ArgumentsShortcuts
  with MustThrownMatchers
  with ShouldThrownMatchers
  with FormattingFragments
  with StandardResults
  with StandardMatchResults
  with AutoExamples
  with DeactivatedTimeConversions
  with PendingUntilFixed
  with Contexts
  with MustMatchers
  with Debug {

  /** transform a context to a result to allow the implicit passing of a context to each example */
  implicit def contextToResult[T](t: MatchResult[T])(implicit context: Context = defaultContext): Result = context(asResult(t))
  /** use an available outside context to transform a function returning a MatchResult into a result */
  implicit def outsideFunctionToResult[T, S](implicit o: Outside[T]) = (f: T => MatchResult[S]) => { o((t1: T) => f(t1).toResult) }

}