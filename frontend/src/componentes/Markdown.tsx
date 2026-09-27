import type { ReactNode } from 'react';

/** **negrita**, *cursiva* y "citas" dentro de una línea, como elementos de React (nunca HTML crudo). */
function enLinea(texto: string): ReactNode[] {
  const partes: ReactNode[] = [];
  const patron = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let ultimo = 0;
  for (const m of texto.matchAll(patron)) {
    if (m.index > ultimo) partes.push(texto.slice(ultimo, m.index));
    const t = m[0];
    partes.push(t.startsWith('**') ? <strong key={m.index}>{t.slice(2, -2)}</strong> : <em key={m.index}>{t.slice(1, -1)}</em>);
    ultimo = m.index + t.length;
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return partes;
}

/**
 * Markdown sencillo (títulos, listas, citas, párrafos) para mostrar los
 * informes de la IA. Construye elementos de React: el texto nunca se
 * interpreta como HTML.
 */
export function Markdown({ texto }: { texto: string }) {
  const bloques: ReactNode[] = [];
  let lista: { ordenada: boolean; items: string[] } | null = null;
  const cerrarLista = () => {
    if (!lista) return;
    const items = lista.items.map((it, i) => <li key={i}>{enLinea(it)}</li>);
    bloques.push(lista.ordenada ? <ol key={bloques.length}>{items}</ol> : <ul key={bloques.length}>{items}</ul>);
    lista = null;
  };
  for (const cruda of texto.split('\n')) {
    const linea = cruda.trimEnd();
    const titulo = /^(#{1,4})\s+(.*)$/.exec(linea);
    const vineta = /^\s*[-*]\s+(.*)$/.exec(linea);
    const numero = /^\s*\d+[.)]\s+(.*)$/.exec(linea);
    if (titulo) {
      cerrarLista();
      const nivel = Math.min(4, titulo[1].length + 1);
      const Etiqueta = `h${nivel}` as 'h2' | 'h3' | 'h4';
      bloques.push(<Etiqueta key={bloques.length}>{enLinea(titulo[2])}</Etiqueta>);
    } else if (vineta || numero) {
      const ordenada = Boolean(numero);
      if (!lista || lista.ordenada !== ordenada) {
        cerrarLista();
        lista = { ordenada, items: [] };
      }
      lista.items.push((vineta ?? numero)![1]);
    } else if (linea.startsWith('>')) {
      cerrarLista();
      bloques.push(<blockquote key={bloques.length}>{enLinea(linea.replace(/^>\s?/, ''))}</blockquote>);
    } else if (linea.trim() === '' || /^-{3,}$/.test(linea.trim())) {
      cerrarLista();
    } else {
      cerrarLista();
      bloques.push(<p key={bloques.length}>{enLinea(linea)}</p>);
    }
  }
  cerrarLista();
  return <div className="markdown">{bloques}</div>;
}
