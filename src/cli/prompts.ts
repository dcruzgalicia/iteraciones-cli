import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

export interface Prompter {
  ask(question: string, fallback?: string): Promise<string>;
  yesNo(question: string, fallback?: boolean): Promise<boolean>;
  choice(question: string, options: string[], fallbackIndex?: number): Promise<number>;
  close(): void;
}

export function isInteractive(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

export function createPrompter(): Prompter {
  const rl = createInterface({ input: stdin, output: stdout });
  return {
    async ask(question, fallback = '') {
      const suffix = fallback === '' ? '' : ` [${fallback}]`;
      const answer = (await rl.question(`${question}${suffix}: `)).trim();
      return answer === '' ? fallback : answer;
    },
    async yesNo(question, fallback = false) {
      const answer = (await rl.question(`${question} [${fallback ? 'S/n' : 's/N'}]: `)).trim().toLowerCase();
      if (answer === '') return fallback;
      return ['s', 'si', 'sí', 'y', 'yes'].includes(answer);
    },
    async choice(question, options, fallbackIndex = 0) {
      for (const [index, option] of options.entries()) stdout.write(`  ${index + 1}. ${option}\n`);
      const answer = (await rl.question(`${question} [${fallbackIndex + 1}]: `)).trim();
      const index = answer === '' ? fallbackIndex : Number.parseInt(answer, 10) - 1;
      return Number.isInteger(index) && index >= 0 && index < options.length ? index : fallbackIndex;
    },
    close() {
      rl.close();
    },
  };
}
