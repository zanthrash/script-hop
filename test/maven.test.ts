import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mavenSource } from '../src/sources/maven.ts'
import type { Task } from '../src/types.ts'
import { makeProject } from './helpers.ts'

/** A minimal POM: packaging, modules, build plugins (artifactIds), optional parent and extras. */
function pom(opts: {
  artifactId: string
  packaging?: string
  modules?: string[]
  subprojects?: string[]
  plugins?: string[]
  managed?: string[]
  parent?: string
}): string {
  const plugins = (ids: string[] = []) => ids.map((id) => `<plugin><groupId>x</groupId><artifactId>${id}</artifactId></plugin>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <!-- <modules><module>commented-out</module></modules> -->
  ${opts.parent ? `<parent><groupId>demo</groupId><artifactId>${opts.parent}</artifactId><version>1</version></parent>` : ''}
  <groupId>demo</groupId>
  <artifactId>${opts.artifactId}</artifactId>
  <version>1</version>
  ${opts.packaging ? `<packaging>${opts.packaging}</packaging>` : ''}
  ${opts.modules ? `<modules>${opts.modules.map((m) => `<module>${m}</module>`).join('')}</modules>` : ''}
  ${opts.subprojects ? `<subprojects>${opts.subprojects.map((m) => `<subproject>${m}</subproject>`).join('')}</subprojects>` : ''}
  <build>
    <pluginManagement><plugins>${plugins(opts.managed)}</plugins></pluginManagement>
    <plugins>${plugins(opts.plugins)}</plugins>
  </build>
</project>
`
}

const PHASES = ['clean', 'validate', 'compile', 'test', 'package', 'verify', 'install', 'deploy', 'site']
const COMBOS = ['clean install', 'clean verify', 'clean package']

const summary = (tasks: Task[]) =>
  tasks.map((t) => [t.name, t.scope, t.package, t.command]).sort((a, b) => String(a).localeCompare(String(b)))

const micronautApp = () => pom({ artifactId: 'app', plugins: ['micronaut-maven-plugin', 'maven-compiler-plugin'] })

/** Aggregator root with lib and a Micronaut app depending on it. */
const multiModule = (extra: Record<string, unknown> = {}) =>
  makeProject({
    'pom.xml': pom({ artifactId: 'demo-parent', packaging: 'pom', modules: ['lib', 'app'] }),
    'lib/pom.xml': pom({ artifactId: 'lib', parent: 'demo-parent' }),
    'lib/src/main/java/.keep': '',
    'app/pom.xml': pom({ artifactId: 'app', parent: 'demo-parent', plugins: ['micronaut-maven-plugin'] }),
    'app/src/main/java/.keep': '',
    mvnw: '',
    ...extra,
  })

describe('Maven source', () => {
  it('does nothing outside a Maven build', async () => {
    expect(await mavenSource.load(await makeProject({ 'package.json': {} }), {})).toBeUndefined()
  })

  it('lists lifecycle phases, common combinations and known plugin goals', async () => {
    const dir = await makeProject({ 'pom.xml': micronautApp(), mvnw: '' })
    const found = await mavenSource.load(dir, {})
    expect(found?.dir).toBe(dir)
    expect(found?.tasks.map((t) => t.name).sort()).toEqual([...PHASES, ...COMBOS, 'mn:dockerfile', 'mn:run'].sort())
    expect(found?.tasks.every((t) => t.scope === 'local' && t.runner === 'maven' && t.cwd === dir)).toBe(true)

    const run = found?.tasks.find((t) => t.name === 'mn:run')
    expect(run).toMatchObject({
      command: 'mn:run',
      description: 'Run the app in development mode, restarting on changes (Micronaut)',
      source: 'maven',
      maven: { goals: ['mn:run'], wrapper: true },
    })
    expect(found?.tasks.find((t) => t.name === 'clean install')?.maven).toEqual({ goals: ['clean', 'install'], wrapper: true })
  })

  it('uses mvn from PATH when the build has no wrapper', async () => {
    const dir = await makeProject({ 'pom.xml': micronautApp() })
    expect((await mavenSource.load(dir, {}))?.tasks[0]?.maven?.wrapper).toBe(false)
  })

  it.each([
    ['spring-boot-maven-plugin', ['spring-boot:build-image', 'spring-boot:run', 'spring-boot:test-run']],
    ['quarkus-maven-plugin', ['quarkus:build', 'quarkus:dev', 'quarkus:image-build', 'quarkus:test']],
    ['exec-maven-plugin', ['exec:exec', 'exec:java']],
    ['jib-maven-plugin', ['jib:build', 'jib:buildTar', 'jib:dockerBuild']],
    // not flyway:clean, which drops every database object, nor undo
    ['flyway-maven-plugin', ['flyway:baseline', 'flyway:info', 'flyway:migrate', 'flyway:repair', 'flyway:validate']],
    ['jetty-maven-plugin', ['jetty:run', 'jetty:run-war']],
    ['jetty-ee10-maven-plugin', ['jetty:run', 'jetty:run-war']],
  ])('knows the goals of %s', async (plugin, goals) => {
    const dir = await makeProject({ 'pom.xml': pom({ artifactId: 'x', plugins: [plugin] }) })
    const names = (await mavenSource.load(dir, {}))!.tasks.map((t) => t.name)
    expect(names.filter((n) => n.includes(':')).sort()).toEqual(goals)
  })

  it('ignores plugins that are only managed, not used', async () => {
    const dir = await makeProject({ 'pom.xml': pom({ artifactId: 'x', managed: ['micronaut-maven-plugin'] }) })
    expect((await mavenSource.load(dir, {}))!.tasks.some((t) => t.name.includes(':'))).toBe(false)
  })

  describe('multi-module builds', () => {
    it("at the root: the build's phases, and each module's plugin goals by module", async () => {
      const root = await multiModule()
      const found = await mavenSource.load(root, {})
      expect(found?.dir).toBe(root)
      const goals = found!.tasks.filter((t) => t.name.includes(':'))
      expect(summary(goals)).toEqual([
        ['mn:dockerfile', 'package', 'app', '-pl :app -am mn:dockerfile'],
        ['mn:run', 'package', 'app', '-pl :app -am mn:run'],
      ])
      expect(goals.find((t) => t.name === 'mn:run')?.maven).toEqual({ goals: ['mn:run'], module: ':app', alsoMake: true, wrapper: true })
      expect(found!.tasks.filter((t) => t.scope === 'local').map((t) => t.command).sort()).toEqual([...PHASES, ...COMBOS].sort())
    })

    it("in a module: that module's phases and goals, built with what it depends on", async () => {
      const root = await multiModule()
      const found = await mavenSource.load(join(root, 'app/src/main/java'), {})
      expect(found?.dir).toBe(join(root, 'app'))
      expect(found?.root).toBe(root)
      expect(found!.tasks.every((t) => t.scope === 'local' && t.cwd === root)).toBe(true)
      expect(found!.tasks.find((t) => t.name === 'mn:run')?.command).toBe('-pl :app -am mn:run')
      expect(found!.tasks.find((t) => t.name === 'test')?.maven).toEqual({ goals: ['test'], module: ':app', alsoMake: true, wrapper: true })
    })

    it("in a module without a goal: other modules' goals", async () => {
      const root = await multiModule()
      const found = await mavenSource.load(join(root, 'lib'), {})
      expect(summary(found!.tasks.filter((t) => t.scope !== 'local'))).toEqual([
        ['mn:dockerfile', 'package', 'app', '-pl :app -am mn:dockerfile'],
        ['mn:run', 'package', 'app', '-pl :app -am mn:run'],
      ])
    })

    it("with all: the root's phases and every module's tasks", async () => {
      const root = await multiModule()
      const found = await mavenSource.load(join(root, 'lib'), { all: true })
      expect(found!.tasks.filter((t) => t.scope === 'root').map((t) => t.command).sort()).toEqual([...PHASES, ...COMBOS].sort())
      expect(found!.tasks.filter((t) => t.package === 'app')).toHaveLength(PHASES.length + COMBOS.length + 2)
    })

    it('inherits plugins declared in a parent POM of the build', async () => {
      const root = await multiModule({
        'pom.xml': pom({ artifactId: 'demo-parent', packaging: 'pom', modules: ['lib', 'app'], plugins: ['flyway-maven-plugin'] }),
      })
      const found = await mavenSource.load(join(root, 'lib'), {})
      expect(found!.tasks.find((t) => t.name === 'flyway:migrate')?.command).toBe('-pl :lib flyway:migrate')
    })

    it("runs other plugins' goals without -am, which would run them in every upstream module", async () => {
      const root = await multiModule({ 'app/pom.xml': pom({ artifactId: 'app', parent: 'demo-parent', plugins: ['exec-maven-plugin'] }) })
      const run = (await mavenSource.load(join(root, 'app'), {}))!.tasks.find((t) => t.name === 'exec:java')
      expect(run?.command).toBe('-pl :app exec:java')
      expect(run?.maven).toEqual({ goals: ['exec:java'], module: ':app', wrapper: true })
    })

    it('finds nested modules and Maven 4 subprojects', async () => {
      const root = await makeProject({
        'pom.xml': pom({ artifactId: 'root', packaging: 'pom', subprojects: ['services'] }),
        'services/pom.xml': pom({ artifactId: 'services', packaging: 'pom', modules: ['api'], parent: 'root' }),
        'services/api/pom.xml': pom({ artifactId: 'api', parent: 'services', plugins: ['micronaut-maven-plugin'] }),
      })
      const atRoot = await mavenSource.load(root, {})
      expect(atRoot!.tasks.find((t) => t.name === 'mn:run')?.command).toBe('-pl :api -am mn:run')
      const inApi = await mavenSource.load(join(root, 'services/api'), {})
      expect(inApi?.dir).toBe(join(root, 'services/api'))
      expect(inApi!.tasks.find((t) => t.name === 'mn:run')?.scope).toBe('local')
    })

    it("selects a module by its path when its artifactId isn't plain text", async () => {
      const root = await multiModule({ 'app/pom.xml': pom({ artifactId: '${app.name}', parent: 'demo-parent', plugins: ['micronaut-maven-plugin'] }) })
      expect((await mavenSource.load(root, {}))!.tasks.find((t) => t.name === 'mn:run')?.command).toBe('-pl app -am mn:run')
    })

    it('treats a POM its parent folder does not list as its own build', async () => {
      const root = await makeProject({
        'pom.xml': pom({ artifactId: 'root', packaging: 'pom', modules: ['app'] }),
        'app/pom.xml': micronautApp(),
        'tools/pom.xml': pom({ artifactId: 'tools', plugins: ['exec-maven-plugin'] }),
      })
      const found = await mavenSource.load(join(root, 'tools'), {})
      expect(found?.dir).toBe(join(root, 'tools'))
      expect(found?.root).toBeUndefined()
      expect(found!.tasks.find((t) => t.name === 'exec:java')).toMatchObject({ scope: 'local', command: 'exec:java', cwd: join(root, 'tools') })
    })
  })

  it("explains a POM it can't read, without failing", async () => {
    const dir = await makeProject({ 'pom.xml': '<project><build><plugins><plugin>' })
    const found = await mavenSource.load(dir, {})
    expect(found?.tasks).toEqual([])
    expect(found?.warnings?.[0]).toMatch(/^couldn't read .*pom\.xml: /)
  })
})
