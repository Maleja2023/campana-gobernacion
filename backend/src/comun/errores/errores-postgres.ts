/** Forma mínima de un error del driver `pg` que nos interesa inspeccionar. */
export interface ErrorPostgres {
  code: string;
  message?: string;
  detail?: string;
  constraint?: string;
}

export function esErrorPostgres(error: unknown): error is ErrorPostgres {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

export function esViolacionSeguridadFila(error: ErrorPostgres): boolean {
  return error.code === '42501' || /row-level security/i.test(error.message ?? '');
}
