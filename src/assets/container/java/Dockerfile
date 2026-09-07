# Java / Spring AI AgentCore agent — container build for `agentcore deploy` (CodeBuild) and
# `agentcore dev`. Mirrors the Python/TS Dockerfiles: public.ecr.aws base, non-root
# bedrock_agentcore (UID 1000), EXPOSE 8080/8000/9000, optional OTel. The runtime contract
# (/invocations + /ping) is served by spring-ai-agentcore-runtime-starter; the Spring Boot jar is
# the entrypoint (the agentcore.json `entrypoint` field is a schema placeholder, not executed).

# --- build stage: Corretto 21 + Maven ---
FROM public.ecr.aws/amazoncorretto/amazoncorretto:21 AS build
ARG MAVEN_VERSION=3.9.9
RUN yum install -y tar gzip && \
    curl -fsSL "https://archive.apache.org/dist/maven/maven-3/${MAVEN_VERSION}/binaries/apache-maven-${MAVEN_VERSION}-bin.tar.gz" -o /tmp/mvn.tgz && \
    tar xzf /tmp/mvn.tgz -C /opt && ln -s "/opt/apache-maven-${MAVEN_VERSION}/bin/mvn" /usr/bin/mvn && \
    rm /tmp/mvn.tgz && yum clean all
WORKDIR /build
# Layer-cache dependencies before copying source.
COPY pom.xml .
RUN mvn -q -B -DskipTests dependency:go-offline
COPY src ./src
RUN mvn -q -B -DskipTests package

# --- runtime stage: Corretto 21, non-root ---
FROM public.ecr.aws/amazoncorretto/amazoncorretto:21
WORKDIR /app

RUN yum install -y shadow-utils && useradd -m -u 1000 bedrock_agentcore && yum clean all

{{#if enableOtel}}
# OpenTelemetry Java agent (non-Python OTel; see aws/agentcore-cli#1270). Exporters default to none
# so a standalone run is quiet; set OTEL_TRACES_EXPORTER=otlp + OTEL_EXPORTER_OTLP_ENDPOINT once a
# collector/sidecar is available.
ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar
RUN chown bedrock_agentcore:bedrock_agentcore /app/opentelemetry-javaagent.jar
{{/if}}

COPY --from=build --chown=bedrock_agentcore:bedrock_agentcore /build/target/*.jar /app/app.jar

USER bedrock_agentcore

# AgentCore Runtime service contract ports: 8080 HTTP / 8000 MCP / 9000 A2A.
EXPOSE 8080 8000 9000

{{#if enableOtel}}
ENV JAVA_TOOL_OPTIONS="-javaagent:/app/opentelemetry-javaagent.jar" \
    OTEL_TRACES_EXPORTER=none \
    OTEL_METRICS_EXPORTER=none \
    OTEL_LOGS_EXPORTER=none \
    OTEL_SERVICE_NAME={{name}}
{{/if}}

CMD ["java", "-jar", "/app/app.jar"]
