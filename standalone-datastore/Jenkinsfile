@Library('jenkins-library@master') _

wrap(repo: "scalableminds/webknossos-datastore") {
  
  env.SBT_VERSION_TAG = "sbt-0.13.15_mongo-3.2.17_node-8.x_jdk-8"
  
  stage("Prepare") {
    checkout scm

    env.DOCKER_CACHE_PREFIX = "~/.webknossos-datastore-cache"
    env.COMPOSE_PROJECT_NAME = "webknossos_datastore_${env.BRANCH_NAME}_${gitCommit()}"
    env.USER_NAME = env.USER
    env.USER_UID = sh(returnStdout: true, script: 'id -u').trim()
    env.USER_GID = sh(returnStdout: true, script: 'id -g').trim()
    env.TZ = readFile('/etc/timezone').trim()
    // env.DOCKER_HOST = 'tcp://localhost:2375'
    sh "mkdir -p ${env.DOCKER_CACHE_PREFIX}"
    sh "docker-compose pull base"
  }
  
  stage("Build") {
    sh "docker-compose run base sbt clean compile stage"
    sh "docker build --pull -t scalableminds/webknossos-datastore:${env.BRANCH_NAME}__${env.BUILD_NUMBER} ."
  }


  stage("Test") {
    sh """
      DOCKER_TAG=${env.BRANCH_NAME}__${env.BUILD_NUMBER} docker-compose up webknossos-datastore &
      sleep 10
      curl --retry 3 --max-time 15 -v http://localhost:9090/data/health
      docker-compose down --volumes --remove-orphans
    """
  }

  dockerPublish(repo: "scalableminds/webknossos-datastore")
}
