import { describe, expect, it } from 'vitest';
import { ETENDUES, classerParHauteur, coutAnneaux, etendue, extraireGrille, maillerAnneaux, rayonPromenade } from '../src/moteur/anneaux';
import { creerRaster } from '../src/coeur/raster';
import { Classe } from '../src/coeur/classification';

describe('étendues proposées', () => {
  it('« Standard » reproduit l’ancien maillage, et les étendues vont croissant', () => {
    expect(etendue('standard').anneaux.map((a) => [a.niveau, a.rayon])).toEqual([[0, 150], [1, 460]]);
    const totaux = ETENDUES.map((e) => e.anneaux[e.anneaux.length - 1].rayon);
    for (let i = 1; i < totaux.length; i++) expect(totaux[i]).toBeGreaterThan(totaux[i - 1]);
    // Dans chaque étendue, les anneaux s'éloignent et grossissent.
    for (const e of ETENDUES) for (let i = 1; i < e.anneaux.length; i++) expect(e.anneaux[i].rayon).toBeGreaterThan(e.anneaux[i - 1].rayon);
  });
  it('identifiant inconnu : étendue par défaut', () => {
    expect(etendue('n’importe quoi').id).toBe('standard');
    expect(etendue(null).id).toBe('standard');
  });
  it('la caméra se promène dans les anneaux de 4 m au plus', () => {
    const niveaux = [{ pas: 0.5 }, { pas: 2 }, { pas: 8 }];
    expect(rayonPromenade(etendue('standard').anneaux, niveaux)).toBe(460);
    expect(rayonPromenade(etendue('maximale').anneaux, niveaux)).toBe(1000);
  });
});

describe('regroupement des cellules', () => {
  it('garde la cellule la plus haute et sa classe', () => {
    const dur = creerRaster(0, 4, 1, 4, 4, 10);
    dur.d[0] = 30; // coin nord-ouest
    const classes = new Uint8Array(16).fill(Classe.Sol);
    classes[0] = Classe.Batiment;
    const g = extraireGrille({ dur, arbres: null }, classes, 2, 2, 2, 2);
    expect([g.largeur, g.hauteur, g.pas]).toEqual([2, 2, 2]);
    expect(Array.from(g.h)).toEqual([30, 10, 10, 10]);
    expect(g.cl[0]).toBe(Classe.Batiment);
    expect(g.cl[1]).toBe(Classe.Sol);
    // Centre de la première cellule : 1 m à l'ouest et 1 m au nord du centre de la vue.
    expect([g.ox, g.oz]).toEqual([-1, -1]);
  });
  it('sans carte de classes, toits et sol se distinguent par la hauteur', () => {
    const h = new Float32Array(100).fill(30);
    for (let i = 44; i < 47; i++) h[i] = 52;
    const cl = new Uint8Array(100).fill(Classe.Inconnu);
    classerParHauteur(h, cl, 10, 10, 8);
    expect(cl[45]).toBe(Classe.Batiment);
    expect(cl[0]).toBe(Classe.Sol);
  });
});

describe('anneaux concentriques', () => {
  // Relief plat avec des blocs, à trois résolutions comme dans l'application.
  const blocs = (pas: number, cote: number) => {
    const n = Math.round(cote / pas);
    const r = creerRaster(-cote / 2, cote / 2, pas, n, n, 0);
    for (let l = 0; l < n; l++) for (let c = 0; c < n; c++) if (Math.floor((c * pas) / 40) % 2 === 0 && Math.floor((l * pas) / 40) % 2 === 0) r.d[l * n + c] = 20;
    return r;
  };
  const niveaux = [{ dur: blocs(0.5, 512), arbres: null }, { dur: blocs(2, 2048), arbres: null }, { dur: blocs(8, 8192), arbres: null }];

  it('chaque anneau saute la zone déjà maillée plus finement', () => {
    const a = maillerAnneaux(niveaux, [null, null, null], 0, 0, 0, etendue('maximale').anneaux);
    expect(a.map((x) => x.pas)).toEqual([0.5, 2, 4, 8, 16]);
    // Aucun triangle d'un anneau extérieur au cœur de la zone fine (à 100 m du centre).
    for (const anneau of a.slice(1)) {
      const m = anneau.maillage;
      const idx = [...m.indicesToits, ...m.indicesMurs];
      for (let t = 0; t < idx.length; t += 3) {
        const cx = (m.positions[idx[t] * 3] + m.positions[idx[t + 1] * 3] + m.positions[idx[t + 2] * 3]) / 3;
        const cz = (m.positions[idx[t] * 3 + 2] + m.positions[idx[t + 1] * 3 + 2] + m.positions[idx[t + 2] * 3 + 2]) / 3;
        expect(Math.max(Math.abs(cx), Math.abs(cz))).toBeGreaterThan(100);
      }
    }
    // Le dernier anneau atteint bien 4 km.
    const dernier = a[a.length - 1].maillage.positions;
    let max = 0;
    for (let i = 0; i < dernier.length; i += 3) max = Math.max(max, Math.abs(dernier[i]), Math.abs(dernier[i + 2]));
    expect(max).toBeGreaterThan(3900);
  });

  it('coût raisonnable : la plus grande étendue reste du même ordre que l’étendue standard', () => {
    const standard = coutAnneaux(maillerAnneaux(niveaux, [null, null, null], 0, 0, 0, etendue('standard').anneaux));
    const maximale = coutAnneaux(maillerAnneaux(niveaux, [null, null, null], 0, 0, 0, etendue('maximale').anneaux));
    // Damier synthétique de blocs de 40 m : des murs à toutes les échelles, cas défavorable (× 2,2 mesuré sur Paris et Lyon réels).
    expect(maximale.triangles).toBeLessThan(standard.triangles * 3.5);
  });
});
