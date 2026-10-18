---
"script-hop": minor
---

Maven builds: `hop` lists lifecycle phases, `clean install`-style combinations and the everyday goals of well-known plugins in your POMs (Micronaut `mn:run`, Spring Boot, Quarkus, exec, Jib, Flyway, Jetty), and runs them through the build's `mvnw`. Multi-module builds work like workspaces: in a module, its tasks run with `-pl <module> -am`, so the modules it depends on are built too.
