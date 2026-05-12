export interface TextNode {
  kind: 'text';
  value: string;
}

export interface VariableNode {
  kind: 'variable';
  /** Nombre de la variable, p.ej. `"title"` o `"site-title"`. */
  key: string;
}

export interface IfNode {
  kind: 'if';
  /** Clave del contexto que se evalúa como truthy/falsy. */
  condition: string;
  consequent: AstNode[];
  alternate: AstNode[];
}

export interface ForNode {
  kind: 'for';
  /** Clave del array en el contexto. */
  key: string;
  body: AstNode[];
  /** Nodos insertados entre iteraciones (contenido de `$sep$`). */
  separator: AstNode[];
}

export type AstNode = TextNode | VariableNode | IfNode | ForNode;
