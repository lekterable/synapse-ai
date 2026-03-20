import {
  createConfigManager,
  type ConfigManager,
  type ProjectMetadata,
} from './config'
import {
  resolveInitProjectRoot,
  resolveProjectRoot,
} from './utils/project-root'

export type ProjectContext = {
  projectRoot: string
  configManager: ConfigManager
  metadata: ProjectMetadata
}

const createProjectContext = (projectRoot: string): ProjectContext => {
  const configManager = createConfigManager(projectRoot)

  return {
    projectRoot,
    configManager,
    metadata: configManager.getProjectMetadata(),
  }
}

export const resolveProjectContext = (
  rootFlag: string | undefined,
): ProjectContext | undefined => {
  const projectRoot = resolveProjectRoot(rootFlag)
  return projectRoot ? createProjectContext(projectRoot) : undefined
}

export const resolveInitProjectContext = (
  rootFlag: string | undefined,
): ProjectContext => {
  return createProjectContext(resolveInitProjectRoot(rootFlag))
}

export const getCommandFileBasePath = (
  projectRoot: string,
  rootFlag: string | undefined,
): string => {
  return rootFlag ? projectRoot : process.cwd()
}

export const getMissingProjectErrorDetails = (
  rootFlag: string | undefined,
): {
  problem: string
  reason: string
  solution: string
} => {
  return rootFlag
    ? {
        problem: 'No synapse project found',
        reason: `No initialized synapse project exists at: ${resolveInitProjectRoot(rootFlag)}`,
        solution:
          'Run "synapse init --root <path>" first, or point --root at an initialized project',
      }
    : {
        problem: 'No synapse project found',
        reason:
          'Synapse could not find a .synapse.json in this directory or any parent directory',
        solution:
          'Run "synapse init" here, or pass --root <path> to target another project',
      }
}
