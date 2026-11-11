/**
 * Cache des tuiles altimétriques dans IndexedDB : une adresse déjà consultée
 * se recharge sans solliciter l'IGN. Dégradation silencieuse si IndexedDB
 * est indisponible (navigation privée, Node).
 */

const BASE = 'plein-soleil';
const MAGASIN = 'tuiles';
const DUREE_MS = 30 * 86_400_000;
const MAX_ENTREES = 40;

interface Entree {
  cle: string;
  donnees: ArrayBuffer;
  date: number;
}

let ouverture: Promise<IDBDatabase | null> | null = null;

function ouvrir(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  ouverture ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(BASE, 1);
      req.onupgradeneeded = () => {
        const magasin = req.result.createObjectStore(MAGASIN, { keyPath: 'cle' });
        magasin.createIndex('date', 'date');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return ouverture;
}

function attendre<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Borne la durée d'une opération : un cache qui ne répond pas ne doit jamais bloquer le calcul. */
function borner<T>(promesse: Promise<T>, ms: number, defaut: T): Promise<T> {
  return Promise.race([promesse, new Promise<T>((resolve) => setTimeout(() => resolve(defaut), ms))]);
}

export function lire(cle: string): Promise<ArrayBuffer | null> {
  const lecture = (async (): Promise<ArrayBuffer | null> => {
    try {
      const base = await ouvrir();
      if (!base) return null;
      const e = (await attendre(base.transaction(MAGASIN).objectStore(MAGASIN).get(cle))) as Entree | undefined;
      if (!e || Date.now() - e.date > DUREE_MS) return null;
      return e.donnees;
    } catch {
      return null;
    }
  })();
  return borner(lecture, 2500, null);
}

export async function ecrire(cle: string, donnees: ArrayBuffer): Promise<void> {
  try {
    const base = await ouvrir();
    if (!base) return;
    const tx = base.transaction(MAGASIN, 'readwrite');
    const magasin = tx.objectStore(MAGASIN);
    magasin.put({ cle, donnees, date: Date.now() } satisfies Entree);
    // Purge : on ne garde que les entrées les plus récentes.
    const cles = (await attendre(magasin.index('date').getAllKeys())) as string[];
    for (let i = 0; i < cles.length - MAX_ENTREES; i++) magasin.delete(cles[i]);
  } catch {
    /* quota dépassé ou base indisponible : on continue sans cache */
  }
}

export async function vider(): Promise<void> {
  try {
    const base = await ouvrir();
    if (!base) return;
    await attendre(base.transaction(MAGASIN, 'readwrite').objectStore(MAGASIN).clear());
  } catch {
    /* rien */
  }
}
