import type { ToolConfig, ConfigScope } from "./types.ts";
import {
  buildConfigToolDefinitions,
  type ConfigEnvironment,
  type ConfigFileLocation,
  type ConfigToolDefinition,
  type ConfigToolId,
} from "./config-locations.ts";

export interface ConfigFileReadResult {
  exists: boolean;
  content: string;
  loadedMtimeUs?: number | null;
}

export type ConfigFileReader = (path: string) => Promise<ConfigFileReadResult>;
export type ToolVersionMap = Record<ConfigToolId, string>;

interface LoadedLocation {
  spec: ConfigFileLocation;
  scope: ConfigScope;
}

function isEffectiveAlternative(item: LoadedLocation): boolean {
  return item.scope.exists && item.scope.content.trim().length > 0;
}

function selectVisibleLocations(loaded: LoadedLocation[]): LoadedLocation[] {
  const winners = new Map<string, LoadedLocation>();
  for (const item of loaded) {
    const group = item.spec.alternativeGroup;
    if (!group) continue;
    const current = winners.get(group);
    const currentPriority = current?.spec.alternativePriority ?? Number.MAX_SAFE_INTEGER;
    const nextPriority = item.spec.alternativePriority ?? Number.MAX_SAFE_INTEGER;
    if (isEffectiveAlternative(item)
      && (!current || !isEffectiveAlternative(current) || nextPriority < currentPriority)) {
      winners.set(group, item);
    } else if (!current && !item.spec.optional) {
      winners.set(group, item);
    }
  }

  return loaded.filter((item) => {
    if (item.spec.alternativeGroup) {
      return winners.get(item.spec.alternativeGroup) === item;
    }
    return item.scope.exists || !item.spec.optional;
  });
}

export async function loadConfigTool(
  definition: ConfigToolDefinition,
  version: string,
  readFile: ConfigFileReader,
): Promise<ToolConfig> {
  const loaded = await Promise.all(definition.files.map(async (spec): Promise<LoadedLocation> => {
    const result = await readFile(spec.filePath);
    return {
      spec,
      scope: {
        level: spec.level,
        label: spec.label,
        filePath: spec.filePath,
        exists: result.exists,
        format: spec.format,
        content: result.content,
        initialContent: spec.initialContent,
        loadedMtimeUs: result.loadedMtimeUs,
      },
    };
  }));

  return {
    name: definition.name,
    version,
    icon: definition.icon,
    description: definition.description,
    scopes: selectVisibleLocations(loaded).map((item) => item.scope),
  };
}

export async function loadConfigTools(
  env: ConfigEnvironment,
  versions: ToolVersionMap,
  readFile: ConfigFileReader,
): Promise<ToolConfig[]> {
  return Promise.all(
    buildConfigToolDefinitions(env).map((definition) =>
      loadConfigTool(definition, versions[definition.id], readFile)
    ),
  );
}
