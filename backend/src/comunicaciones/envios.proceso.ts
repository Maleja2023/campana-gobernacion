import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CifradoService } from '../cifrado/cifrado.service.js';
import { DatabaseService } from '../database/database.service.js';
import { ComunicacionesRepositorio } from './comunicaciones.repositorio.js';
import { crearTokenBaja } from './enlace-baja.js';
import { EnvioFallidoError, ProveedoresService, type Canal } from './proveedores.service.js';

const LOTE = 50;
/** Tope por minuto, para no saturar al proveedor ni tener corridas largas. */
const MAXIMO_POR_CORRIDA = 600;

/**
 * Envía los mensajes programados. Corre cada minuto sin usuario: las
 * funciones de la base solo aceptan este contexto, y vuelven a revisar
 * autorización y bajas antes de entregar cada lote.
 */
@Injectable()
export class EnviosProceso {
  private readonly log = new Logger('Envios');
  private enCurso = false;
  private readonly urlBase: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly cifrado: CifradoService,
    private readonly proveedores: ProveedoresService,
    private readonly repo: ComunicacionesRepositorio,
    config: ConfigService,
  ) {
    this.urlBase = new URL(config.getOrThrow<string>('URL_REGISTRO_BASE')).origin;
  }

  enlaceBaja(personaId: string, canal: Canal) {
    return `${this.urlBase}/baja/${crearTokenBaja(this.cifrado, personaId, canal)}`;
  }

  /** Arma el texto final: {nombre} y el enlace para darse de baja. */
  componer(canal: Canal, contenido: string, nombre: string, enlace: string) {
    const texto = contenido.replaceAll('{nombre}', nombre || 'hola');
    return canal === 'SMS'
      ? `${texto} No mas mensajes: ${enlace}`
      : `${texto}\n\n—\nRecibes este correo porque autorizaste comunicaciones de la campaña. Para no recibir más: ${enlace}`;
  }

  private descifrarCelular(cifrado: Buffer) {
    try {
      return this.cifrado.descifrar(cifrado);
    } catch {
      throw new EnvioFallidoError('No se pudo leer el celular guardado');
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async ejecutar(): Promise<void> {
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      await this.procesar();
    } catch (causa) {
      this.log.error(`Falló el proceso de envíos: ${causa instanceof Error ? causa.message : String(causa)}`);
    } finally {
      this.enCurso = false;
    }
  }

  async procesar(): Promise<number> {
    const envios = await this.database.comoUsuario(null, (trx) => this.repo.enviosListos(trx));
    let procesados = 0;
    for (const envio of envios) {
      if (envio.canal === 'TELEGRAM') {
        const texto = envio.contenido.replaceAll('{nombre}', '').replace(/\s{2,}/g, ' ').trim();
        let resultado = 'Publicado en el canal de Telegram';
        try {
          await this.proveedores.telegram(texto);
        } catch (causa) {
          resultado = `No se pudo publicar en Telegram: ${causa instanceof Error ? causa.message : 'error'}`;
        }
        await this.database.comoUsuario(null, (trx) => this.repo.cerrarEnvio(trx, envio.id, resultado));
        continue;
      }
      while (procesados < MAXIMO_POR_CORRIDA) {
        const lote = await this.database.comoUsuario(null, (trx) => this.repo.lote(trx, envio.id, LOTE));
        if (!lote.length) break;
        for (const d of lote) {
          const enlace = this.enlaceBaja(d.persona_id, envio.canal);
          const texto = this.componer(envio.canal, envio.contenido, d.nombre, enlace);
          let error: string | null = null;
          try {
            if (envio.canal === 'SMS') {
              if (!d.telefono_cifrado) throw new EnvioFallidoError('Sin celular');
              await this.proveedores.sms(this.descifrarCelular(d.telefono_cifrado), texto);
            } else {
              if (!d.correo) throw new EnvioFallidoError('Sin correo');
              await this.proveedores.correo(d.correo, envio.asunto ?? 'Campaña', texto, enlace);
            }
          } catch (causa) {
            error = causa instanceof EnvioFallidoError ? causa.message : 'Error inesperado al enviar';
          }
          await this.database.comoUsuario(null, (trx) => this.repo.marcarDestinatario(trx, envio.id, d.persona_id, error ? 'FALLIDO' : 'ENVIADO', error));
          procesados++;
        }
      }
      const cerrado = await this.database.comoUsuario(null, (trx) => this.repo.cerrarEnvio(trx, envio.id));
      if (!cerrado) break; // quedan pendientes: siguen en la próxima corrida
    }
    if (procesados) this.log.log(`${procesados} mensajes procesados`);
    return procesados;
  }
}
