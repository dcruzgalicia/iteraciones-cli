import { Then, When } from '@cucumber/cucumber';
import { SiteConfigSchema } from '../../config/config-schema.js';
import { parseYamlWithPosition } from '../../lib/frontmatter.js';

let resultado: { valida: boolean; url?: string } = { valida: false };

When('valido esta configuración:', (yaml: string) => {
  const parsed = parseYamlWithPosition(yaml);
  if (parsed.error) throw new Error(`YAML inválido: ${parsed.error}`);
  const config = SiteConfigSchema.safeParse(parsed.value);
  const site = config.success ? (config.data.format?.html?.site as { url?: string } | undefined) : undefined;
  resultado = config.success ? { valida: true, url: site?.url } : { valida: false };
});

Then('la configuración es válida y la URL del sitio es {string}', (esperada: string) => {
  if (!resultado.valida) throw new Error('la configuración debía ser válida');
  if (resultado.url !== esperada) throw new Error(`la URL es ${JSON.stringify(resultado.url)} y debía ser ${JSON.stringify(esperada)}`);
});

Then('la configuración es inválida', () => {
  if (resultado.valida) throw new Error('la configuración debía ser inválida');
});

Then('la configuración es válida sin URL de sitio', () => {
  if (!resultado.valida) throw new Error('la configuración debía ser válida');
  if (resultado.url !== undefined) throw new Error(`la URL debía faltar y es ${JSON.stringify(resultado.url)}`);
});
