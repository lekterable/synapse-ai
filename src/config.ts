import Conf from 'conf'
import { z } from 'zod'
import { homedir } from 'os'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs'
import { PROJECT_METADATA_FILENAME } from './utils/project-root'

const GlobalConfigSchema = z.object({
  sourcePath: z.string(),
  backupEnabled: z.boolean(),
  backupPath: z.string(),
  ignoredPatterns: z.array(z.string()),
  projects: z.array(z.string()),
})

const ProjectMetadataSchema = z.object({
  version: z.literal(1),
  scope: z.string().optional(),
  syncedFiles: z.record(z.string(), z.string()),
  fileHashes: z.record(z.string(), z.string()),
})

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>
export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>

const defaultGlobalConfig: GlobalConfig = {
  sourcePath: join(homedir(), '.synapse', 'source'),
  backupEnabled: true,
  backupPath: join(homedir(), '.synapse', 'backups'),
  ignoredPatterns: [],
  projects: [],
}

const defaultProjectMetadata: ProjectMetadata = {
  version: 1,
  scope: undefined,
  syncedFiles: {},
  fileHashes: {},
}

const expandPath = (path: string): string =>
  path.startsWith('~') ? path.replace('~', homedir()) : path

const createGlobalConfigStore = (): Conf<GlobalConfig> =>
  new Conf<GlobalConfig>({
    configName: 'config',
    cwd: join(homedir(), '.config', 'synapse'),
    defaults: defaultGlobalConfig,
  })

export const getProjectMetadataPath = (projectRoot: string): string =>
  join(projectRoot, PROJECT_METADATA_FILENAME)

const validateGlobalConfig = (config: unknown): GlobalConfig =>
  GlobalConfigSchema.parse(config)

const validateProjectMetadata = (metadata: unknown): ProjectMetadata =>
  ProjectMetadataSchema.parse(metadata)

const readAndValidateMetadata = (metadataPath: string): ProjectMetadata => {
  if (!existsSync(metadataPath)) {
    return { ...defaultProjectMetadata }
  }

  try {
    return validateProjectMetadata(
      JSON.parse(readFileSync(metadataPath, 'utf-8')),
    )
  } catch {
    return { ...defaultProjectMetadata }
  }
}

const mergeAndValidate = <T extends Record<string, unknown>>(
  current: T,
  updates: Partial<T>,
  validator: (data: unknown) => T,
): T => validator({ ...current, ...updates })

export type ConfigManager = {
  getGlobalConfig: () => GlobalConfig
  setGlobalConfig: (updates: Partial<GlobalConfig>) => void
  getProjectMetadata: () => ProjectMetadata
  setProjectMetadata: (updates: Partial<ProjectMetadata>) => void
  hasProjectMetadata: () => boolean
  deleteProjectMetadata: () => void
  getSourcePath: () => string
  getBackupPath: () => string
}

export const createConfigManager = (
  projectRoot: string = process.cwd(),
): ConfigManager => {
  const globalConfig = createGlobalConfigStore()
  const projectMetadataPath = getProjectMetadataPath(projectRoot)

  const getGlobalConfig = (): GlobalConfig =>
    validateGlobalConfig(globalConfig.store)

  const setGlobalConfig = (updates: Partial<GlobalConfig>): void => {
    const validated = mergeAndValidate(
      getGlobalConfig(),
      updates,
      validateGlobalConfig,
    )
    ;(Object.keys(validated) as Array<keyof GlobalConfig>).forEach((key) => {
      globalConfig.set(key, validated[key])
    })
  }

  const getProjectMetadata = (): ProjectMetadata =>
    readAndValidateMetadata(projectMetadataPath)

  const setProjectMetadata = (updates: Partial<ProjectMetadata>): void => {
    const validated = mergeAndValidate(
      getProjectMetadata(),
      updates,
      validateProjectMetadata,
    )
    writeFileSync(
      projectMetadataPath,
      `${JSON.stringify(validated, undefined, 2)}\n`,
      'utf-8',
    )
  }

  const hasProjectMetadata = (): boolean => existsSync(projectMetadataPath)

  const deleteProjectMetadata = (): void => {
    rmSync(projectMetadataPath, { force: true })
  }

  const getSourcePath = (): string => {
    return expandPath(getGlobalConfig().sourcePath)
  }

  const getBackupPath = (): string => {
    return expandPath(getGlobalConfig().backupPath)
  }

  return {
    getGlobalConfig,
    setGlobalConfig,
    getProjectMetadata,
    setProjectMetadata,
    hasProjectMetadata,
    deleteProjectMetadata,
    getSourcePath,
    getBackupPath,
  }
}
