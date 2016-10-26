_          = require("lodash")
Marionette = require("backbone.marionette")
routes     = require("routes")

class CreditsView extends Marionette.View

  className : "well"
  id : "credits"
  template : _.template("""
    <div class="container">
      <h3>webKnossos Credits</h3>
      <section class="row">
        <div class="col-sm-4">
          <h4>Max Planck Institute for Brain Research</h4>
          <p>
            Department of Connectomics<br />
            <a href="http://www.brain.mpg.de/connectomics">http://www.brain.mpg.de/connectomics</a>
          </p>
          <ul>
            <li>Moritz Helmstaedter</li>
            <li>Manuel Berning</li>
            <li>Kevin Boergens</li>
            <li>Heiko Wissler</li>
          </ul>
        </div>
        <div class="col-sm-4">
          <h4>scalable minds</h4>
          <p><a href="http://scm.io">http://scm.io</a></p>
          <ul>
            <li>Tom Bocklisch</li>
            <li>Dominic Bräunlein</li>
            <li>Johannes Frohnhofen</li>
            <li>Tom Herold</li>
            <li>Philipp Otto</li>
            <li>Norman Rzepka</li>
            <li>Thomas Werkmeister</li>
            <li>Daniel Werner</li>
            <li>Georg Wiese</li>
            <li>Sven Mischkewitz</li>
            <li>Nico Ring</li>
          </ul>
        </div>
        <div class="col-sm-3">
          <a href="http://www.brain.mpg.de/connectomics">
            <img class="img-50" src="assets/images/Max-Planck-Gesellschaft.svg">
          </a>
          <a href="http://www.brain.mpg.de/connectomics">
            <img class="img-50" src="assets/images/MPI-brain-research.svg">
          </a>
          <a href="http://www.scm.io">
            <img class="img-responsive" src="assets/images/scalableminds_logo.svg">
          </a>
        </div>
      </section>
      <section>
        <p>webKnossos is using Brainflight technology for real time data delivery, implemented by <em>scalable minds</em></p>
      </section>
      <section>
        <p>
          The webKnossos frontend was inspired by Knossos:
        </p>
        <p>
          Helmstaedter, M., K.L. Briggman, and W. Denk,<br />
          High-accuracy neurite reconstruction for high-throughput neuroanatomy. <br/>
          Nat. Neurosci. 14, 1081–1088, 2011.<br />
          <a href="http://www.knossostool.org">http://www.knossostool.org</a>
        </p>
      </section>
      <section>
        <p>
          For more information about our project, visit <a href="http://www.brainflight.net">http://www.brainflight.net</a> and
          <a href="http://www.brain.mpg.de/connectomics">http://www.brain.mpg.de/connectomics</a>
        </p>

        <p>&copy; Max Planck Institut for Brain Research</p>
      </section>
        <p>
          <a href="/impressum">Legal notice</a>
        </p>
    </div>
  """)


module.exports = CreditsView
