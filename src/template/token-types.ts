export enum TokenType {
  VARIABLE = 'VARIABLE',
  IF = 'IF',
  ELSE = 'ELSE',
  ENDIF = 'ENDIF',
  FOR = 'FOR',
  SEP = 'SEP',
  ENDFOR = 'ENDFOR',
  ESCAPE = 'ESCAPE',
  TEXT = 'TEXT',
}

export interface Token {
  type: TokenType;
  /** Texto literal para TEXT; nombre de variable para VARIABLE; condición/clave para IF/FOR. */
  value?: string;
}
