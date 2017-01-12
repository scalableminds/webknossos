FROM java:8-jre

RUN ["mkdir", "-p", "/srv/webknossos-datastore"]
WORKDIR /srv/webknossos-datastore

VOLUME /srv/webknossos-datastore/binaryData /srv/webknossos-datastore/userBinaryData 

COPY target/universal/stage .

RUN groupadd -r webknossos \
  && useradd -r -g webknossos webknossos \
  && mkdir disk \
  && chown -R webknossos .

USER webknossos

ENTRYPOINT ["bin/webknossos-datastore"]
CMD ["-J-Xmx20G", "-J-Xms1G", "-Dconfig.file=conf/application.conf", "-Dlogger.file=conf/logback-docker.xml"]