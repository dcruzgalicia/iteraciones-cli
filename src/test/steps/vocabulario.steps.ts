import { After, Before, Given, Then } from '@cucumber/cucumber';
import { looseColonLines } from '../../builder/project-validator.js';

interface VocabularioWorld {
  cuerpo: string;
}

const world: VocabularioWorld = { cuerpo: '' };

Before(() => {
  world.cuerpo = '';
});

After(() => {
  world.cuerpo = '';
});

Given('un cuerpo:', (cuerpo: string) => {
  world.cuerpo = cuerpo;
});

Then('las líneas reportadas son {string}', (expected: string) => {
  const expectedLines: number[] = JSON.parse(expected);
  const actual = looseColonLines(world.cuerpo);
  if (JSON.stringify(actual) !== JSON.stringify(expectedLines)) {
    throw new Error(`esperaba ${expected} y obtuve ${JSON.stringify(actual)} para el cuerpo:\n${JSON.stringify(world.cuerpo)}`);
  }
});
