/**
 * Asigna la contraseña de un usuario del sistema.
 *   npm run usuario:clave -- gerente@demo.co MiClaveSegura2026
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { hashearClave, validarFortaleza } from '../auth/claves.js';
import { DatabaseService } from '../database/database.service.js';

const [login, clave] = process.argv.slice(2);
if (!login || !clave) {
  console.error('Uso: npm run usuario:clave -- <login> <contraseña>');
  process.exit(1);
}
const problema = validarFortaleza(clave);
if (problema) {
  console.error(problema);
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
try {
  const db = app.get(DatabaseService).db;
  const resultado = await db
    .updateTable('acceso.usuarios')
    .set({ password_hash: await hashearClave(clave) })
    .where('login', '=', login.trim().toLowerCase())
    .executeTakeFirst();

  if (Number(resultado.numUpdatedRows) === 0) {
    console.error(`No existe el usuario ${login}`);
    process.exitCode = 1;
  } else {
    console.log(`Contraseña actualizada para ${login}`);
  }
} finally {
  await app.close();
}
