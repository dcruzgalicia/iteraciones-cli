export interface LicenseDef {
  label: string;
  iconos: readonly string[];
  parrafos: readonly string[];
}

const TEXTO_CC_BY_NC_ND = [
  'Algunos derechos reservados. Esta obra está bajo una Licencia Creative Commons Atribución-NoComercial-SinDerivadas 4.0 Internacional. Usted es libre de compartir, copiar y redistribuir el material en cualquier medio o formato, pero debe dar crédito de manera adecuada, brindar un enlace a la&nbsp;licencia e indicar si se han realizado cambios. No puede hacer uso de esta obra con propósitos comerciales, ni remezclar, transformar o crear obras derivadas, ni distribuir el material modificado.',
] as const;

const TEXTO_PF = [
  'Algunos derechos reservados. Esta obra está bajo una Licencia de Producción Feminista. Usted es libre de compartir, copiar, distribuir y adaptar esta obra en cualquier medio o formato, pero debe dar crédito a todas las personas que hicieron posible su creación, reconocer sus contribuciones e indicar si ha realizado cambios. Si remezcla, transforma o crea a partir de esta obra, debe distribuir la obra derivada bajo esta misma licencia; además, los materiales y archivos necesarios para su creación, modificación y reproducción deben ser de acceso público, de modo que cualquiera pueda consultar, modificar y reutilizar la obra derivada. La explotación comercial solo está permitida a cooperativas, organizaciones, colectivas y redes autogestivas que se identifiquen y organicen bajo principios feministas, anticapitalistas, antirracistas y decoloniales.',
] as const;

export const LICENSE_DEFS = {
  'CC-BY-NC-ND-4.0': { label: 'CC BY-NC-ND 4.0', iconos: ['cc', 'by', 'nc', 'nd'], parrafos: TEXTO_CC_BY_NC_ND },
  'PF-AC-PR-FA-1.0': { label: 'PF-AC-PR-FA-1.0', iconos: ['pf', 'ac', 'pr', 'fa'], parrafos: TEXTO_PF },
} as const satisfies Record<string, LicenseDef>;

export type LicenseId = keyof typeof LICENSE_DEFS;

export const LICENSE_IDS = Object.keys(LICENSE_DEFS) as LicenseId[];

export const DEFAULT_LICENSE: LicenseId = 'CC-BY-NC-ND-4.0';

export function licenseDef(id: string): LicenseDef | undefined {
  return (LICENSE_DEFS as Record<string, LicenseDef>)[id];
}
