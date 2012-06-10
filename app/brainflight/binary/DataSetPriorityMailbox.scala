package brainflight.binary

import akka.dispatch.PriorityGenerator
import akka.dispatch.UnboundedPriorityMailbox
import com.typesafe.config.Config
import akka.actor.ActorSystem
import akka.actor.PoisonPill
 
// We inherit, in this case, from UnboundedPriorityMailbox
// and seed it with the priority generator
class DataSetPriorityMailbox(settings: ActorSystem.Settings, config: Config) extends UnboundedPriorityMailbox(
  // Create a new PriorityGenerator, lower prio means more important
  PriorityGenerator {
    // 'highpriority messages should be treated first if possible
    case _ @ CachedFile(_,_,_) => 
      1
    // PoisonPill when no other left
    case PoisonPill    => 3
 
    // We default to 1, which is in between high and low
    case otherwise => 
      2
  })