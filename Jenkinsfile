@Library('jenkins-library@master') _

wrap(repo: "scalableminds/webknossos-datastore") {
  
  env.SBT_VERSION_TAG = "sbt-0.13.9_mongo-3.2.1_node-7.x_jdk-8"
  
  stage("Prepare") {
    // sh "sudo /var/lib/jenkins/fix_workspace.sh webknossos-datastore"

    checkout scm

    env.DOCKER_CACHE_PREFIX = "~/.webknossos-datastore-build-cache"
    env.COMPOSE_PROJECT_NAME = "webknossos_datastore_${env.BRANCH_NAME}_${gitCommit()}"
    // env.DOCKER_HOST = 'tcp://localhost:2375'
    sh "mkdir -p ${env.DOCKER_CACHE_PREFIX}"
    sh "docker-compose pull sbt"
  }
  
  stage("Build") {
    sh "docker-compose run sbt clean compile stage"
    sh "docker build -t scalableminds/webknossos-datastore:${env.BRANCH_NAME}__${env.BUILD_NUMBER} ."
  }


  stage("Test") {
    sh """
      DOCKER_TAG=${env.BRANCH_NAME}__${env.BUILD_NUMBER} docker-compose up webknossos-datastore &
      sleep 10
      curl -v http://localhost:9090/data/health
      docker-compose down --volumes --remove-orphans
    """
  }

  dockerPublish { repo = "scalableminds/webknossos-datastore" }
}
