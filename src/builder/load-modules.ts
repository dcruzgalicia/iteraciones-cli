import { join } from 'node:path';

/**
 * Carga módulos vía import() dinámico desde un directorio del paquete,
 * con opción de sobrescritura desde un directorio del proyecto.
 *
 * @param pkgDir Ruta absoluta al directorio del paquete.
 * @param names Lista de nombres de módulos (sin extensión).
 * @param cwd Directorio del proyecto para buscar overrides.
 * @param projectSubdir Subdirectorio dentro del proyecto (ej: 'transpilers').
 */
export async function loadModules<T>(pkgDir: string, names: string[], cwd?: string, projectSubdir?: string): Promise<Map<string, T>> {
  const modules = new Map<string, T>();

  for (const name of names) {
    const mod = (await import(join(pkgDir, `${name}.ts`))) as T;
    modules.set(name, mod);
  }

  if (cwd && projectSubdir) {
    for (const name of names) {
      const projectPath = join(cwd, projectSubdir, `${name}.ts`);
      const exists = await Bun.file(projectPath)
        .exists()
        .catch(() => false);
      if (exists) {
        const mod = (await import(projectPath)) as T;
        modules.set(name, mod);
      }
    }
  }

  return modules;
}
