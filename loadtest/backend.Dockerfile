# The backend image of compose.prod.yaml, from a jar built outside Docker (run.sh does it): the
# same JRE, user and memory flags, for machines where Gradle cannot download inside a build.
FROM eclipse-temurin:25-jre
RUN useradd --system --uid 10001 --no-create-home pulse
WORKDIR /app
COPY pulse-backend.jar ./
USER pulse
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70 -XX:+ExitOnOutOfMemoryError"
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "pulse-backend.jar"]
