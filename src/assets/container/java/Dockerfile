FROM public.ecr.aws/docker/library/maven:3.9-amazoncorretto-21 AS build
WORKDIR /build
# Resolve dependencies in their own layer, so a source edit does not download them again.
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B -DskipTests package

FROM public.ecr.aws/amazoncorretto/amazoncorretto:21
WORKDIR /app
RUN yum install -y shadow-utils && useradd -m -u 1000 bedrock_agentcore && yum clean all
COPY --from=build --chown=bedrock_agentcore:bedrock_agentcore /build/target/*.jar /app/app.jar
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
USER bedrock_agentcore
EXPOSE 8080
CMD ["java", "-jar", "/app/app.jar"]
