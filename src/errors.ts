export class PandocError extends Error {
  constructor(
    message: string,
    public readonly sourcePath: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = 'PandocError';
  }
}

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly configPath: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}
