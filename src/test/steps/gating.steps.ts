import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';

const RAIZ = join(import.meta.dir, '..', '..', '..');

function parse(fuente: string) {
  return new Parser(new AstBuilder(() => ''), new GherkinClassicTokenMatcher('es')).parse(fuente);
}

function scenariosDe(doc: ReturnType<typeof parse>) {
  const salida = [];
  for (const hijo of doc.feature?.children ?? []) {
    if (hijo.scenario) salida.push(hijo.scenario);
    else for (const c of hijo.rule?.children ?? []) if (c.scenario) salida.push(c.scenario);
  }
  return salida;
}

/**
 * Un `Escenario` sin ningún paso de comprobación no comprueba nada: pasa en
 * verde para siempre.
 *
 * El parsing lo hace `@cucumber/gherkin`, que ya está instalado como dependencia
 * de `@cucumber/cucumber`: docstrings, tablas y scenarios anidados en `Regla de
 * negocio` salen del AST, no de expresiones regulares propias.
 *
 * Lo único que hay que resolver a mano es la herencia de `Y`/`E`, que el parser
 * deja tal cual: muchos features encadenan la aserción con `Y` después de un
 * `Cuando` (`Cuando exporto…` / `Y el markdown declara:`), así que un `Entonces`
 * que venga con `keywordType: 'Conjunction'` cuenta como comprobación.
 */
Then('ningún escenario se queda sin comprobar', () => {
  const sinComprobar: string[] = [];
  for (const archivo of readdirSync(join(RAIZ, 'features'))) {
    if (!archivo.endsWith('.feature')) continue;
    const fuente = readFileSync(join(RAIZ, 'features', archivo), 'utf8');
    for (const scenario of scenariosDe(parse(fuente))) {
      const comprueba = scenario.steps.some((paso) => paso.keywordType !== 'Conjunction' && paso.keyword.trim().startsWith('Entonces'));
      if (!comprueba) sinComprobar.push(scenario.name ?? '');
    }
  }
  if (sinComprobar.length > 0) {
    throw new Error(`estos escenarios no tienen ninguna comprobación (${sinComprobar.length}):\n  ${sinComprobar.join('\n  ')}`);
  }
});

Then('el parser oficial de Gherkin acepta todos los features', () => {
  const errores: string[] = [];
  for (const archivo of readdirSync(join(RAIZ, 'features'))) {
    if (!archivo.endsWith('.feature')) continue;
    try {
      parse(readFileSync(join(RAIZ, 'features', archivo), 'utf8'));
    } catch (err) {
      errores.push(`${archivo}: ${String(err)}`);
    }
  }
  if (errores.length > 0) throw new Error(`features que no parsean:\n  ${errores.join('\n  ')}`);
});
