/** Côté interface : appels asynchrones au moteur de calcul. */
import { type InfoScene, type Reponse, type Requete, type ResultatCalcul, type ResultatMaillage } from './protocole';

export class ErreurMoteur extends Error {
  constructor(
    message: string,
    public statut: number | null,
  ) {
    super(message);
  }
}

export class Moteur {
  private worker: Worker;
  private suivant = 1;
  private attentes = new Map<number, { resoudre: (v: unknown) => void; rejeter: (e: Error) => void }>();
  surProgression: (message: string) => void = () => {};

  constructor() {
    this.worker = new Worker(new URL('./moteur.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<Reponse>) => {
      const r = ev.data;
      if ('progression' in r) {
        this.surProgression(r.progression);
        return;
      }
      const a = this.attentes.get(r.id);
      if (!a) return;
      this.attentes.delete(r.id);
      if (r.ok) a.resoudre(r.resultat);
      else a.rejeter(new ErreurMoteur(r.message, r.statut));
    };
    this.worker.onerror = (ev) => {
      for (const a of this.attentes.values()) a.rejeter(new ErreurMoteur(`Le moteur de calcul s’est arrêté : ${ev.message}`, null));
      this.attentes.clear();
    };
  }

  private appeler<T>(requete: Requete): Promise<T> {
    const id = this.suivant++;
    return new Promise<T>((resoudre, rejeter) => {
      this.attentes.set(id, { resoudre: resoudre as (v: unknown) => void, rejeter });
      this.worker.postMessage({ id, requete });
    });
  }

  charger(r: Omit<Extract<Requete, { type: 'charger' }>, 'type'>): Promise<InfoScene> {
    return this.appeler({ type: 'charger', ...r });
  }
  calculer(r: Omit<Extract<Requete, { type: 'calculer' }>, 'type'>): Promise<ResultatCalcul> {
    return this.appeler({ type: 'calculer', ...r });
  }
  maillage(r: Omit<Extract<Requete, { type: 'maillage' }>, 'type'>): Promise<ResultatMaillage> {
    return this.appeler({ type: 'maillage', ...r });
  }
  viderCache(): Promise<null> {
    return this.appeler({ type: 'viderCache' });
  }
}
